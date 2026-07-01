from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import (
    DownloadRecord,
    ExecutionStatus,
    MediaStatus,
    MediaType,
    Subscription,
    SubscriptionSource,
)
from app.core.database import async_session_maker
from app.services.butailing_service import butailing_service
from app.services.media_postprocess_service import media_postprocess_service
from app.services.operation_log_service import operation_log_service
from app.services.emby_service import emby_service
from app.services.feiniu_service import feiniu_service
from app.services.feiniu_sync_index_service import feiniu_sync_index_service
from app.services.hdhive_service import hdhive_service
from app.services.pan115_service import Pan115Service
from app.services.pansou_service import pansou_service
from app.services.resource_search import (
    normalize_pansou_pan115_list as _normalize_pansou_pan115_list,
    search_pansou_pan115_resources as _search_pansou_pan115_resources,
)
from app.services.subscriptions.resource_candidates import (
    extract_resource_url,
    filter_resources_excluding_urls,
    normalize_share_url,
)
from app.services.subscriptions.link_fallback_flow import (
    LinkFallbackDependencies,
    auto_save_records_with_link_fallback as auto_save_records_with_link_fallback_flow,
)
from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url,
    select_retryable_records,
)
from app.services.subscriptions.resource_metadata import (
    is_video_filename,
    normalize_hdhive_subscription_items,
)
from app.services.subscriptions.resource_fetchers import (
    fetch_from_hdhive as fetch_from_hdhive_flow,
    fetch_from_pansou as fetch_from_pansou_flow,
    fetch_from_tg as fetch_from_tg_flow,
    fetch_offline_magnets as fetch_offline_magnets_flow,
)
from app.services.subscriptions.resource_fetcher_adapter import (
    ResourceFetcherAdapterDependencies,
    fetch_from_hdhive_with_adapter,
    fetch_from_pansou_with_adapter,
    fetch_from_tg_with_adapter,
    fetch_offline_magnets_with_adapter,
)
from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
    resolve_source_order,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot
from app.services.subscriptions.execution_logs import (
    create_execution_log as create_subscription_execution_log,
    create_step_log as create_subscription_step_log,
    prune_step_logs as prune_subscription_step_logs,
)
from app.services.subscriptions.completed_cleanup import (
    CompletedCleanupDependencies,
    cleanup_completed_subscriptions as cleanup_completed_subscriptions_flow,
    cleanup_single_subscription as cleanup_single_subscription_flow,
)
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
from app.services.subscriptions.pre_scan_cleanup_run_flow import (
    PreScanCleanupRunDependencies,
    run_pre_scan_cleanup_for_subscription,
)
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status as apply_postprocess_status_flow,
)
from app.services.subscriptions.quality_filter import (
    SubscriptionQualityPreferences,
    build_subscription_quality_filter,
)
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription as scan_fixed_sources_flow,
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
from app.services.subscriptions.item_outcome_run_flow import (
    SubscriptionItemOutcomeDependencies,
    complete_subscription_item_success,
    handle_subscription_item_failure,
)
from app.services.subscriptions.resource_resolver import (
    resolve_subscription_resources,
)
from app.services.subscriptions.resource_resolver_adapter import (
    ResourceResolverAdapterDependencies,
    fetch_subscription_resources_with_adapter,
)
from app.services.subscriptions.resource_storage import (
    store_new_resources as store_new_resources_flow,
)
from app.services.subscriptions.resource_storage_db_adapter import (
    ResourceStorageDbAdapterDependencies,
    store_new_resources_with_db_adapter,
)
from app.services.subscriptions.resource_ingest_run_flow import (
    ResourceIngestRunDependencies,
    run_resource_ingest_for_subscription,
)
from app.services.subscriptions.run_summary import (
    normalize_subscription_channel,
)
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
from app.services.subscriptions.run_counters import (
    apply_auto_transfer_stats,
    apply_cleanup_stats,
    apply_fixed_source_transfer_stats,
    apply_resource_store_stats,
    apply_subscription_failure,
    increment_processed_count,
    set_checked_count,
)
from app.services.subscriptions.run_state import (
    build_initial_run_result,
    build_processing_progress_payload,
    build_start_progress_payload,
)
from app.services.subscriptions.run_loader import load_active_subscription_snapshots
from app.services.subscriptions.run_lifecycle_logs import (
    build_subscription_start_step,
)
from app.services.subscriptions.transfer_phase_run_flow import (
    SubscriptionTransferPhaseDependencies,
    run_subscription_transfer_phase,
)
from app.services.subscriptions.auto_save_resources_adapter import (
    AutoSaveResourcesAdapterDependencies,
    auto_save_resources_with_adapter,
)
from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchStatuses,
    auto_save_resources_batch,
)
from app.services.subscriptions.hdhive_unlock import (
    allow_unlock_by_threshold,
    build_hdhive_unlock_context,
    prepare_hdhive_locked_resources,
    safe_int,
    should_stop_unlocking_on_message,
)
from app.services.subscriptions.tv_episode_selection import (
    select_missing_episode_files as select_tv_missing_episode_files,
)
from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success as notify_transfer_success_flow,
)
from app.services.runtime_settings_service import runtime_settings_service
from app.services.seedhub_service import seedhub_service
from app.services.subscription_source_service import (
    MANUAL_PAN115_SOURCE,
    subscription_source_service,
)
from app.services.tg_service import tg_service
from app.services.subscription_delete_service import subscription_delete_service
from app.services.subscription_cleanup_policy import (
    has_upcoming_episodes_in_subscription_scope,
)
from app.services.tv_missing_service import tv_missing_service

logger = logging.getLogger(__name__)

# 单轮订阅内，链接失效后最多补充搜索并转存的轮次
MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS = 6
_SUBSCRIPTION_SCAN_CONCURRENCY = 3


class SubscriptionService:
    async def run_channel_check(
        self,
        db: AsyncSession,
        channel: str,
        force_auto_download: bool = False,
        progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        normalized_channel = normalize_subscription_channel(channel)
        run_id = uuid4().hex
        started_at = beijing_now()
        await operation_log_service.log_background_event(
            source_type="background_task",
            module="subscriptions",
            action="subscription.check.start",
            status="info",
            message=f"订阅检查任务启动（频道：{normalized_channel}）",
            trace_id=run_id,
            extra={
                "channel": normalized_channel,
                "force_auto_download": force_auto_download,
            },
        )

        result = build_initial_run_result(normalized_channel, run_id, started_at)
        hdhive_unlock_context = self._build_hdhive_unlock_context()
        source_order = self._resolve_source_order(normalized_channel)

        subscriptions = await load_active_subscription_snapshots(db)
        set_checked_count(result, len(subscriptions))
        await self._create_step_log(
            db,
            run_id=run_id,
            channel=normalized_channel,
            step="run_start",
            status="info",
            message=f"开始本轮检查，共有 {len(subscriptions)} 个订阅需要处理",
            payload={
                "checked_count": len(subscriptions),
                "source_order": source_order,
                "scope": {
                    "is_active": True,
                    "exclude_transferred_success": False,
                    "cleanup_enabled": True,
                },
            },
        )
        if progress_callback:
            await progress_callback(build_start_progress_payload(result))

        scan_semaphore = asyncio.Semaphore(_SUBSCRIPTION_SCAN_CONCURRENCY)
        result_lock = asyncio.Lock()

        async def _process_subscription(sub: SubscriptionSnapshot) -> None:
                sub_id = sub.id
                sub_title = sub.title
                async with async_session_maker() as inner_db:
                    async def apply_subscription_failure_for_run(
                        subscription_id: int,
                        title: str,
                        error: BaseException,
                    ) -> None:
                        async with result_lock:
                            apply_subscription_failure(
                                result,
                                subscription_id=subscription_id,
                                title=title,
                                error=error,
                            )

                    item_outcome_dependencies = (
                        SubscriptionItemOutcomeDependencies(
                            create_step_log=self._create_step_log,
                            log_background_event=(
                                operation_log_service.log_background_event
                            ),
                            apply_subscription_failure=(
                                apply_subscription_failure_for_run
                            ),
                        )
                    )

                    try:
                        await self._create_step_log(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            **build_subscription_start_step(sub_title),
                        )

                        async def apply_pre_scan_cleanup_stats_for_run(
                            media_type: Any,
                        ) -> None:
                            async with result_lock:
                                apply_cleanup_stats(
                                    result,
                                    media_type,
                                    tv_media_type=MediaType.TV,
                                )

                        pre_scan_cleanup_result = (
                            await run_pre_scan_cleanup_for_subscription(
                                db=inner_db,
                                run_id=run_id,
                                channel=normalized_channel,
                                sub=sub,
                                dependencies=PreScanCleanupRunDependencies(
                                    evaluate_pre_scan_cleanup=(
                                        self._evaluate_pre_scan_cleanup
                                    ),
                                    create_step_log=self._create_step_log,
                                    log_background_event=(
                                        operation_log_service.log_background_event
                                    ),
                                    apply_cleanup_stats=(
                                        apply_pre_scan_cleanup_stats_for_run
                                    ),
                                ),
                            )
                        )
                        if pre_scan_cleanup_result.deleted:
                            return

                        tv_missing_snapshot = (
                            pre_scan_cleanup_result.tv_missing_snapshot
                        )

                        async def apply_resource_store_stats_for_run(
                            store_stats: dict[str, Any],
                        ) -> None:
                            async with result_lock:
                                apply_resource_store_stats(result, store_stats)

                        resource_ingest_result = (
                            await run_resource_ingest_for_subscription(
                                db=inner_db,
                                run_id=run_id,
                                channel=normalized_channel,
                                sub=sub,
                                hdhive_unlock_context=hdhive_unlock_context,
                                source_order=source_order,
                                dependencies=ResourceIngestRunDependencies(
                                    fetch_resources=self._fetch_resources,
                                    store_new_resources=self._store_new_resources,
                                    create_step_log=self._create_step_log,
                                    log_background_event=(
                                        operation_log_service.log_background_event
                                    ),
                                    apply_resource_store_stats=(
                                        apply_resource_store_stats_for_run
                                    ),
                                ),
                            )
                        )
                        created_records = resource_ingest_result.created_records
                        duplicate_urls = resource_ingest_result.duplicate_urls

                        async def apply_auto_transfer_stats_for_run(
                            stats: dict[str, Any],
                            transfer_source: str,
                        ) -> None:
                            async with result_lock:
                                apply_auto_transfer_stats(
                                    result,
                                    stats,
                                    transfer_source=transfer_source,
                                )

                        async def apply_transfer_cleanup_stats_for_run(
                            media_type: Any,
                        ) -> None:
                            async with result_lock:
                                apply_cleanup_stats(
                                    result,
                                    media_type,
                                    tv_media_type=MediaType.TV,
                                )

                        async def apply_fixed_source_stats_for_run(
                            saved: int,
                            failed: int,
                        ) -> None:
                            async with result_lock:
                                apply_fixed_source_transfer_stats(
                                    result,
                                    saved=saved,
                                    failed=failed,
                                )

                        transfer_phase_result = await run_subscription_transfer_phase(
                            db=inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            sub=sub,
                            force_auto_download=force_auto_download,
                            duplicate_urls=duplicate_urls,
                            created_records=created_records,
                            tv_missing_snapshot=tv_missing_snapshot,
                            hdhive_unlock_context=hdhive_unlock_context,
                            source_order=source_order,
                            dependencies=SubscriptionTransferPhaseDependencies(
                                load_retryable_records=self._load_retryable_records,
                                load_force_retry_records=(
                                    self._load_force_retry_records
                                ),
                                auto_save_records_with_link_fallback=(
                                    self._auto_save_records_with_link_fallback
                                ),
                                should_scan_fixed_sources=self._should_scan_fixed_sources,
                                scan_fixed_sources_for_subscription=(
                                    self._scan_fixed_sources_for_subscription
                                ),
                                create_step_log=self._create_step_log,
                                log_background_event=(
                                    operation_log_service.log_background_event
                                ),
                                delete_subscription_with_records=(
                                    self._delete_subscription_with_records
                                ),
                                apply_auto_transfer_stats=(
                                    apply_auto_transfer_stats_for_run
                                ),
                                apply_fixed_source_transfer_stats=(
                                    apply_fixed_source_stats_for_run
                                ),
                                apply_cleanup_stats=(
                                    apply_transfer_cleanup_stats_for_run
                                ),
                            ),
                        )
                        should_auto_download = (
                            transfer_phase_result.should_auto_download
                        )
                        sub_saved_count = transfer_phase_result.sub_saved_count
                        sub_failed_transfer_count = (
                            transfer_phase_result.sub_failed_transfer_count
                        )

                        await complete_subscription_item_success(
                            db=inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            new_record_count=len(created_records),
                            should_auto_download=should_auto_download,
                            sub_saved_count=sub_saved_count,
                            sub_failed_transfer_count=(
                                sub_failed_transfer_count
                            ),
                            dependencies=item_outcome_dependencies,
                        )
                    except Exception as exc:
                        await handle_subscription_item_failure(
                            db=inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            error=exc,
                            dependencies=item_outcome_dependencies,
                        )
                    finally:
                        async with result_lock:
                            increment_processed_count(result)
                            progress_payload = build_processing_progress_payload(result)
                        if progress_callback:
                            await progress_callback(progress_payload)


        async def _bounded_subscription(sub: SubscriptionSnapshot) -> None:
            async with scan_semaphore:
                await _process_subscription(sub)

        if subscriptions:
            await asyncio.gather(*(_bounded_subscription(sub) for sub in subscriptions))

        await finalize_subscription_run(
            db=db,
            channel=normalized_channel,
            run_id=run_id,
            result=result,
            started_at=started_at,
            hdhive_unlock_context=hdhive_unlock_context,
            success_status=ExecutionStatus.SUCCESS,
            failed_status=ExecutionStatus.FAILED,
            partial_status=ExecutionStatus.PARTIAL,
            dependencies=RunFinalizeDependencies(
                log_background_event=operation_log_service.log_background_event,
                create_execution_log=self._create_execution_log,
                create_step_log=self._create_step_log,
                prune_step_logs=self._prune_step_logs,
                now=beijing_now,
            ),
        )
        return result

    async def _create_step_log(
        self,
        db: AsyncSession,
        run_id: str,
        channel: str,
        step: str,
        status: str,
        message: str,
        subscription_id: int | None = None,
        subscription_title: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        await create_subscription_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            step=step,
            status=status,
            message=message,
            payload=payload,
        )

    async def _prune_step_logs(self, db: AsyncSession) -> None:
        await prune_subscription_step_logs(db)

    async def _evaluate_pre_scan_cleanup(
        self,
        db: AsyncSession,
        *,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
    ) -> dict[str, Any]:
        dependencies = PreScanCleanupDependencies(
            delete_subscription_with_records=self._delete_subscription_with_records,
            create_step_log=self._create_step_log,
            log_background_event=operation_log_service.log_background_event,
            get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
            check_feiniu_movie_status=self._check_feiniu_movie_status,
            get_tv_missing_status=tv_missing_service.get_tv_missing_status,
            has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
        )
        return await evaluate_pre_scan_cleanup_flow(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=dependencies,
        )

    async def _delete_subscription_with_records(
        self, db: AsyncSession, subscription_id: int
    ) -> None:
        await subscription_delete_service.delete_local_subscriptions(
            db,
            [subscription_id],
        )

    async def _apply_precise_transfer_postprocess_status(
        self,
        record: DownloadRecord,
    ) -> dict[str, Any]:
        return await apply_postprocess_status_flow(
            record,
            dependencies=PostprocessStatusDependencies(
                trigger_archive_after_transfer=(
                    media_postprocess_service.trigger_archive_after_transfer
                ),
                archiving_status=MediaStatus.ARCHIVING,
                completed_status=MediaStatus.COMPLETED,
                now=beijing_now,
            ),
        )

    def _completed_cleanup_dependencies(self) -> CompletedCleanupDependencies:
        return CompletedCleanupDependencies(
            delete_subscription_with_records=self._delete_subscription_with_records,
            log_background_event=operation_log_service.log_background_event,
            get_movie_status_by_tmdb=emby_service.get_movie_status_by_tmdb,
            check_feiniu_movie_status=self._check_feiniu_movie_status,
            get_tv_missing_status=tv_missing_service.get_tv_missing_status,
            has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
            sleep=asyncio.sleep,
        )

    async def cleanup_completed_subscriptions(
        self, db: AsyncSession
    ) -> dict[str, Any]:
        """离线下载完成后检查并清理已完成的订阅（电影已转存或剧集不缺集）"""
        return await cleanup_completed_subscriptions_flow(
            db,
            dependencies=self._completed_cleanup_dependencies(),
        )

    async def _check_feiniu_movie_status(
        self, tmdb_id: int
    ) -> dict[str, Any]:
        """检查电影在飞牛中是否已存在，返回 {"checked": bool, "exists": bool, "item_ids": list}"""
        if not runtime_settings_service.get_feiniu_url().strip():
            return {"checked": False}
        try:
            indexed_result = await feiniu_sync_index_service.get_movie_status(tmdb_id)
            if indexed_result is not None:
                if str(indexed_result.get("status") or "") == "ok" and bool(
                    indexed_result.get("exists")
                ):
                    return {
                        "checked": True,
                        "exists": True,
                        "item_ids": indexed_result.get("item_ids") or [],
                    }
                return {
                    "checked": True,
                    "exists": False,
                    "item_ids": [],
                }
            live_result = await feiniu_service.get_movie_status_by_tmdb(tmdb_id)
            if str(live_result.get("status") or "") == "ok" and bool(
                live_result.get("exists")
            ):
                return {
                    "checked": True,
                    "exists": True,
                    "item_ids": live_result.get("item_ids") or [],
                }
            if str(live_result.get("status") or "") == "not_logged_in":
                return {"checked": False}
            return {
                "checked": str(live_result.get("status") or "") == "ok",
                "exists": False,
                "item_ids": [],
            }
        except Exception:
            logger.exception("飞牛电影状态查询失败: tmdb_id=%s", tmdb_id)
            return {"checked": False}

    async def _check_feiniu_tv_missing_status(
        self, tmdb_id: int
    ) -> dict[str, Any]:
        """检查剧集在飞牛中的缺集状态，返回 {"checked": bool, "missing_count": int}"""
        if not runtime_settings_service.get_feiniu_url().strip():
            return {"checked": False}
        try:
            from app.services.tmdb_service import tmdb_service as _tmdb

            indexed_result = (
                await feiniu_sync_index_service.get_tv_existing_episodes(tmdb_id)
            )
            feiniu_result = (
                indexed_result
                if indexed_result is not None
                else await feiniu_service.get_tv_episode_status_by_tmdb(tmdb_id)
            )
            status_text = str(feiniu_result.get("status") or "")
            if status_text not in ("ok",):
                return {"checked": False}

            feiniu_existing = feiniu_result.get("existing_episodes") or set()
            feiniu_existing_pairs = {
                (int(p[0]), int(p[1]))
                for p in feiniu_existing
                if isinstance(p, (list, tuple)) and len(p) == 2
            } if isinstance(feiniu_existing, (list, set)) else feiniu_existing

            tmdb_detail = await _tmdb.get_tv_detail(tmdb_id)
            seasons = (
                tmdb_detail.get("seasons")
                if isinstance(tmdb_detail, dict)
                else []
            )
            if not isinstance(seasons, list):
                seasons = []
            tmdb_pairs: set[tuple[int, int]] = set()
            for season in seasons:
                if not isinstance(season, dict):
                    continue
                sn = season.get("season_number")
                ec = season.get("episode_count")
                if sn is None or ec is None:
                    continue
                sn = int(sn)
                ec = int(ec)
                if sn == 0:
                    continue
                for ep in range(1, ec + 1):
                    tmdb_pairs.add((sn, ep))

            if not tmdb_pairs:
                return {"checked": False}

            missing = tmdb_pairs - feiniu_existing_pairs
            return {"checked": True, "missing_count": len(missing)}
        except Exception:
            logger.exception("飞牛剧集缺集状态查询失败: tmdb_id=%s", tmdb_id)
            return {"checked": False}

    async def cleanup_single_subscription(
        self, db: AsyncSession, subscription_id: int
    ) -> dict[str, Any]:
        """检查并清理单个订阅（电影已转存/已在库 或 剧集不缺集）"""
        return await cleanup_single_subscription_flow(
            db,
            subscription_id,
            dependencies=self._completed_cleanup_dependencies(),
        )

    async def _fetch_resources(
        self,
        channel: str,
        sub: "SubscriptionSnapshot",
        hdhive_unlock_context: dict[str, Any] | None = None,
        source_order: list[str] | None = None,
        exclude_urls: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        def emit_source_attempt_event(
            subscription_id: int,
            data: dict[str, Any],
        ) -> None:
            from app.analytics import kafka_producer

            if kafka_producer._enabled:
                kafka_producer.send(
                    event_type="source_attempt",
                    data=data,
                    key=str(subscription_id),
                )

        return await fetch_subscription_resources_with_adapter(
            channel=channel,
            sub=sub,
            dependencies=ResourceResolverAdapterDependencies(
                fetch_from_hdhive=self._fetch_from_hdhive,
                fetch_from_tg=self._fetch_from_tg,
                fetch_from_pansou=self._fetch_from_pansou,
                fetch_offline_magnets=self._fetch_offline_magnets,
                resolve_source_order=self._resolve_source_order,
                resolve_subscription_resolutions=(
                    self._resolve_subscription_resolutions
                ),
                resolve_subscription_quality_filter=(
                    self._resolve_subscription_quality_filter
                ),
                prepare_hdhive_locked_resources=(
                    self._prepare_hdhive_locked_resources
                ),
                build_hdhive_unlock_context=self._build_hdhive_unlock_context,
                filter_resources_excluding_urls=filter_resources_excluding_urls,
                log_background_event=operation_log_service.log_background_event,
                emit_source_attempt_event=emit_source_attempt_event,
                run_resolver=resolve_subscription_resources,
            ),
            hdhive_unlock_context=hdhive_unlock_context,
            source_order=source_order,
            exclude_urls=exclude_urls,
        )

    def _build_source_attempt_summary(
        self, attempts: list[dict[str, Any]], source_order: list[str]
    ) -> str:
        """构建来源尝试链路的中文摘要"""
        return build_source_attempt_summary(attempts, source_order)

    def _resolve_source_order(self, channel: str) -> list[str]:
        _ = channel
        priority = runtime_settings_service.get_subscription_resource_priority()
        tg_ready = bool(
            runtime_settings_service.get_tg_api_id().strip()
            and runtime_settings_service.get_tg_api_hash().strip()
            and runtime_settings_service.get_tg_session().strip()
            and runtime_settings_service.get_tg_channel_usernames()
        )
        return resolve_source_order(priority, tg_ready=tg_ready)

    def _resource_fetcher_adapter_dependencies(
        self,
    ) -> ResourceFetcherAdapterDependencies:
        return ResourceFetcherAdapterDependencies(
            search_pansou_by_tmdb=_search_pansou_pan115_resources,
            search_pansou_keyword=pansou_service.search_115,
            normalize_pansou_resources=_normalize_pansou_pan115_list,
            get_hdhive_tv_pan115=hdhive_service.get_tv_pan115,
            get_hdhive_movie_pan115=hdhive_service.get_movie_pan115,
            get_hdhive_by_keyword=hdhive_service.get_pan115_by_keyword,
            normalize_hdhive_items=normalize_hdhive_subscription_items,
            prefer_hdhive_free=runtime_settings_service.get_subscription_hdhive_prefer_free,
            sort_hdhive_free_first=hdhive_service.sort_free_first,
            search_tg_by_keyword=tg_service.search_115_by_keyword,
            offline_transfer_enabled=(
                runtime_settings_service.get_subscription_offline_transfer_enabled
            ),
            search_seedhub_magnets=seedhub_service.search_magnets_by_keyword,
            search_butailing_magnets=butailing_service.search_magnets,
            log_background_event=operation_log_service.log_background_event,
            run_fetch_from_pansou=fetch_from_pansou_flow,
            run_fetch_from_hdhive=fetch_from_hdhive_flow,
            run_fetch_from_tg=fetch_from_tg_flow,
            run_fetch_offline_magnets=fetch_offline_magnets_flow,
        )

    async def _fetch_from_pansou(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_from_pansou_with_adapter(
            sub,
            dependencies=self._resource_fetcher_adapter_dependencies(),
        )

    async def _fetch_from_hdhive(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_from_hdhive_with_adapter(
            sub,
            dependencies=self._resource_fetcher_adapter_dependencies(),
        )

    async def _fetch_from_tg(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_from_tg_with_adapter(
            sub,
            dependencies=self._resource_fetcher_adapter_dependencies(),
        )

    async def _fetch_offline_magnets(
        self,
        sub: "SubscriptionSnapshot",
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_offline_magnets_with_adapter(
            sub,
            dependencies=self._resource_fetcher_adapter_dependencies(),
        )

    def _build_hdhive_unlock_context(self) -> dict[str, Any]:
        budget_total = runtime_settings_service.get_subscription_hdhive_unlock_budget_points_per_run()
        return build_hdhive_unlock_context(
            enabled=runtime_settings_service.get_subscription_hdhive_auto_unlock_enabled(),
            max_points_per_item=runtime_settings_service.get_subscription_hdhive_unlock_max_points_per_item(),
            budget_total=budget_total,
            threshold_inclusive=runtime_settings_service.get_subscription_hdhive_unlock_threshold_inclusive(),
        )

    async def _prepare_hdhive_locked_resources(
        self,
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return await prepare_hdhive_locked_resources(
            resources,
            context,
            traces,
            normalize_items=normalize_hdhive_subscription_items,
            extract_resource_url=extract_resource_url,
            normalize_share_url=normalize_share_url,
            unlock_resource=hdhive_service.unlock_resource,
        )

    @staticmethod
    def _allow_unlock_by_threshold(
        unlock_points: int, threshold: int, inclusive: bool
    ) -> bool:
        return allow_unlock_by_threshold(unlock_points, threshold, inclusive)

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        return safe_int(value, default=default)

    @staticmethod
    def _should_stop_unlocking_on_message(message: str) -> bool:
        return should_stop_unlocking_on_message(message)

    async def _store_new_resources(
        self,
        db: AsyncSession,
        subscription_id: int,
        resources: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await store_new_resources_with_db_adapter(
            db,
            subscription_id,
            resources,
            dependencies=ResourceStorageDbAdapterDependencies(
                offline_transfer_enabled=(
                    runtime_settings_service.get_subscription_offline_transfer_enabled
                ),
                record_status_matched=MediaStatus.MATCHED,
                run_store_new_resources=store_new_resources_flow,
            ),
        )

    async def _load_retryable_records(
        self, db: AsyncSession, subscription_id: int
    ) -> list[DownloadRecord]:
        from app.models.models import MediaStatus

        with db.no_autoflush:
            failed_result = await db.execute(
                select(DownloadRecord)
                .where(
                    DownloadRecord.subscription_id == subscription_id,
                    DownloadRecord.status == MediaStatus.FAILED,
                )
                .order_by(DownloadRecord.created_at.desc())
                .limit(8)
            )
            pending_result = await db.execute(
                select(DownloadRecord)
                .where(
                    DownloadRecord.subscription_id == subscription_id,
                    DownloadRecord.status.in_((MediaStatus.PENDING, MediaStatus.MATCHED)),
                )
                .order_by(DownloadRecord.created_at.desc())
                .limit(5)
            )

        failed_rows = list(failed_result.scalars().all())
        pending_rows = list(pending_result.scalars().all())

        return select_retryable_records(failed_rows, pending_rows)

    async def _load_force_retry_records(
        self,
        db: AsyncSession,
        subscription_id: int,
        duplicate_urls: list[str],
    ) -> list[DownloadRecord]:
        from app.models.models import MediaStatus

        url_values = [
            str(item or "").strip()
            for item in duplicate_urls
            if str(item or "").strip()
        ]
        if not url_values:
            return []

        with db.no_autoflush:
            rows_result = await db.execute(
                select(DownloadRecord)
                .where(
                    DownloadRecord.subscription_id == subscription_id,
                    DownloadRecord.resource_url.in_(url_values),
                    DownloadRecord.status.in_(
                        (MediaStatus.FAILED, MediaStatus.PENDING, MediaStatus.MATCHED)
                    ),
                )
                .order_by(DownloadRecord.created_at.desc())
            )

        return dedupe_records_by_resource_url(rows_result.scalars().all())

    async def _load_subscription_resource_urls(
        self, db: AsyncSession, subscription_id: int
    ) -> set[str]:
        """获取订阅下已记录过的资源 URL，用于跳过失效/已尝试链接。"""
        with db.no_autoflush:
            result = await db.execute(
                select(DownloadRecord.resource_url).where(
                    DownloadRecord.subscription_id == subscription_id
                )
        )
        return {str(row[0]).strip() for row in result.all() if row and row[0]}

    async def _auto_save_records_with_link_fallback(
        self,
        db: AsyncSession,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
        records: list[DownloadRecord],
        *,
        transfer_source: str,
        tv_missing_snapshot: dict[str, Any] | None = None,
        hdhive_unlock_context: dict[str, Any] | None = None,
        source_order: list[str] | None = None,
        enable_link_refetch: bool = True,
    ) -> dict[str, Any]:
        """转存资源；当前批链接均失败或剧集仍缺集时，自动补充搜索下一条链接直至成功。"""
        async def create_step_log(
            current_db: AsyncSession,
            **kwargs: Any,
        ) -> None:
            await self._create_step_log(current_db, **kwargs)

        async def auto_save_resources(
            current_db: AsyncSession,
            *args: Any,
            **kwargs: Any,
        ) -> dict[str, Any]:
            return await self._auto_save_resources(current_db, *args, **kwargs)

        async def load_subscription_resource_urls(
            current_db: AsyncSession,
            subscription_id: int,
        ) -> set[str]:
            return await self._load_subscription_resource_urls(
                current_db,
                subscription_id,
            )

        async def fetch_resources(
            *args: Any,
            **kwargs: Any,
        ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
            return await self._fetch_resources(*args, **kwargs)

        async def store_new_resources(
            current_db: AsyncSession,
            subscription_id: int,
            resources: list[dict[str, Any]],
        ) -> dict[str, Any]:
            return await self._store_new_resources(
                current_db,
                subscription_id,
                resources,
            )

        dependencies = LinkFallbackDependencies(
            create_step_log=create_step_log,
            auto_save_resources=auto_save_resources,
            load_subscription_resource_urls=load_subscription_resource_urls,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
        )
        return await auto_save_records_with_link_fallback_flow(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=records,
            transfer_source=transfer_source,
            dependencies=dependencies,
            tv_missing_snapshot=tv_missing_snapshot,
            hdhive_unlock_context=hdhive_unlock_context,
            source_order=source_order,
            enable_link_refetch=enable_link_refetch,
            max_rounds=MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS,
        )

    def _should_scan_fixed_sources(
        self,
        sub: "SubscriptionSnapshot",
        *,
        force_auto_download: bool = False,
    ) -> bool:
        return should_scan_fixed_sources_policy(
            sub,
            force_auto_download=force_auto_download,
        )

    async def _scan_fixed_sources_for_subscription(
        self,
        db: AsyncSession,
        *,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
        tv_missing_snapshot: dict[str, Any] | None = None,
        force_auto_download: bool = False,
    ) -> dict[str, Any]:
        async def list_enabled_manual_sources(
            current_db: AsyncSession,
            subscription_id: int,
        ) -> list[SubscriptionSource]:
            result = await current_db.execute(
                select(SubscriptionSource).where(
                    SubscriptionSource.subscription_id == subscription_id,
                    SubscriptionSource.enabled.is_(True),
                    SubscriptionSource.source_type == MANUAL_PAN115_SOURCE,
                )
            )
            return list(result.scalars().all())

        def create_pan_service() -> Pan115Service:
            return Pan115Service(runtime_settings_service.get_pan115_cookie())

        def get_parent_folder_id() -> str:
            default_folder = runtime_settings_service.get_pan115_default_folder() or {}
            return str(default_folder.get("folder_id") or "0")

        async def get_tv_missing_status(
            tmdb_id: int,
            **kwargs: Any,
        ) -> dict[str, Any]:
            return await tv_missing_service.get_tv_missing_status(tmdb_id, **kwargs)

        async def scan_manual_source(
            current_db: AsyncSession,
            **kwargs: Any,
        ) -> dict[str, Any]:
            return await subscription_source_service.scan_manual_pan115_source(
                current_db,
                **kwargs,
            )

        async def create_step_log(
            current_db: AsyncSession,
            **kwargs: Any,
        ) -> None:
            await self._create_step_log(current_db, **kwargs)

        dependencies = FixedSourceScanDependencies(
            list_enabled_manual_sources=list_enabled_manual_sources,
            create_pan_service=create_pan_service,
            get_parent_folder_id=get_parent_folder_id,
            resolve_quality_filter=self._resolve_subscription_quality_filter,
            get_tv_missing_status=get_tv_missing_status,
            scan_manual_source=scan_manual_source,
            create_step_log=create_step_log,
        )
        return await scan_fixed_sources_flow(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            tv_missing_snapshot=tv_missing_snapshot,
            force_auto_download=force_auto_download,
            dependencies=dependencies,
        )

    async def _auto_save_resources(
        self,
        db: AsyncSession,
        run_id: str,
        channel: str,
        sub: "SubscriptionSnapshot",
        records: list[DownloadRecord],
        source: str,
        tv_missing_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def emit_transfer_success(
            subscription_id: int,
            data: dict[str, Any],
        ) -> None:
            from app.analytics import kafka_producer

            if kafka_producer._enabled:
                kafka_producer.send(
                    event_type="transfer_success",
                    data=data,
                    key=str(subscription_id),
                )

        statuses = AutoTransferBatchStatuses(
            transferring=MediaStatus.TRANSFERRING,
            downloading=MediaStatus.DOWNLOADING,
            offline_submitted=MediaStatus.OFFLINE_SUBMITTED,
            matched=MediaStatus.MATCHED,
            completed=MediaStatus.COMPLETED,
            failed=MediaStatus.FAILED,
        )
        return await auto_save_resources_with_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=records,
            source=source,
            statuses=statuses,
            dependencies=AutoSaveResourcesAdapterDependencies(
                get_pan115_cookie=runtime_settings_service.get_pan115_cookie,
                create_pan_service=Pan115Service,
                get_pan115_default_folder=(
                    runtime_settings_service.get_pan115_default_folder
                ),
                get_pan115_offline_folder=(
                    runtime_settings_service.get_pan115_offline_folder
                ),
                resolve_quality_filter=self._resolve_subscription_quality_filter,
                get_tv_missing_status=tv_missing_service.get_tv_missing_status,
                create_step_log=self._create_step_log,
                emit_transfer_success=emit_transfer_success,
                select_tv_missing_episode_files=select_tv_missing_episode_files,
                apply_precise_postprocess_status=(
                    self._apply_precise_transfer_postprocess_status
                ),
                notify_transfer_success=self._notify_transfer_success,
                trigger_archive_after_transfer=(
                    media_postprocess_service.trigger_archive_after_transfer
                ),
                log_operation=operation_log_service.log_background_event,
                now=beijing_now,
                is_video_file=is_video_filename,
                run_batch=auto_save_resources_batch,
            ),
            tv_missing_snapshot=tv_missing_snapshot,
        )

    async def _create_execution_log(
        self,
        db: AsyncSession,
        channel: str,
        status: ExecutionStatus,
        message: str,
        checked_count: int,
        new_resource_count: int,
        failed_count: int,
        details: list[dict[str, Any]],
        started_at: datetime,
        finished_at: datetime,
    ) -> None:
        await create_subscription_execution_log(
            db,
            channel=channel,
            status=status,
            message=message,
            checked_count=checked_count,
            new_resource_count=new_resource_count,
            failed_count=failed_count,
            details=details,
            started_at=started_at,
            finished_at=finished_at,
        )

    def _resolve_subscription_resolutions(self, sub: "SubscriptionSnapshot") -> list[str]:
        return runtime_settings_service.get_resource_preferred_resolutions()

    def _resolve_subscription_quality_filter(self, sub: "SubscriptionSnapshot") -> dict[str, Any]:
        _ = sub
        return build_subscription_quality_filter(
            SubscriptionQualityPreferences(
                preferred_resolutions=(
                    runtime_settings_service.get_resource_preferred_resolutions()
                ),
                preferred_hdr=runtime_settings_service.get_resource_preferred_hdr(),
                preferred_codec=runtime_settings_service.get_resource_preferred_codec(),
                exclude_labels=runtime_settings_service.get_resource_exclude_tags(),
                preferred_audio=runtime_settings_service.get_resource_preferred_audio(),
                preferred_subtitles=(
                    runtime_settings_service.get_resource_preferred_subtitles()
                ),
                min_size_gb=runtime_settings_service.get_resource_min_size_gb(),
                max_size_gb=runtime_settings_service.get_resource_max_size_gb(),
            )
        )

    @staticmethod
    async def _notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None = None,
    ) -> None:
        async def notify(message: str, *, poster_path: str | None = None) -> None:
            from app.services.tg_bot.notifications import tg_bot_notify

            await tg_bot_notify(message, poster_path=poster_path)

        await notify_transfer_success_flow(
            sub_title,
            resource_name,
            source,
            method,
            poster_path=poster_path,
            dependencies=TransferNotificationDependencies(
                notify=notify,
                log_warning=logger.warning,
            ),
        )

    async def fetch_resources_for_media(
        self,
        media_type: str,
        tmdb_id: int | None = None,
        douban_id: str | None = None,
        title: str = "",
        year: str | None = None,
        season_number: int | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        """供手动转存等场景调用的统一资源获取入口，复用 _fetch_resources 管道。"""
        from app.models.models import MediaType

        mt = MediaType.TV if media_type == "tv" else MediaType.MOVIE
        snapshot = SubscriptionSnapshot(
            id=0,
            tmdb_id=tmdb_id,
            douban_id=douban_id,
            title=title or "",
            media_type=mt,
            year=year,
            auto_download=False,
            tv_scope="all",
            tv_season_number=season_number,
            tv_episode_start=None,
            tv_episode_end=None,
            tv_follow_mode="missing",
            tv_include_specials=False,
            has_successful_transfer=False,
        )
        return await self._fetch_resources(channel="all", sub=snapshot)


subscription_service = SubscriptionService()

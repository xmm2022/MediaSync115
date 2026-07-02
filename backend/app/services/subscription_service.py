from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import (
    DownloadRecord,
    ExecutionStatus,
    MediaType,
    Subscription,
)
from app.core.database import async_session_maker
from app.services.operation_log_service import operation_log_service
from app.services.subscriptions.link_fallback_flow import (
    auto_save_records_with_link_fallback as auto_save_records_with_link_fallback_flow,
)
from app.services.subscriptions.link_fallback_adapter import (
    LinkFallbackAdapterDependencies,
    auto_save_records_with_link_fallback_with_adapter,
)
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
    load_subscription_resource_urls_with_db_adapter,
)
from app.services.subscriptions.resource_fetcher_runtime_adapter import (
    fetch_from_hdhive_with_runtime_adapter,
    fetch_from_pansou_with_runtime_adapter,
    fetch_from_tg_with_runtime_adapter,
    fetch_offline_magnets_with_runtime_adapter,
)
from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
)
from app.services.subscriptions.snapshot import SubscriptionSnapshot
from app.services.subscriptions.execution_logs import (
    create_execution_log as create_subscription_execution_log,
    create_step_log as create_subscription_step_log,
    prune_step_logs as prune_subscription_step_logs,
)
from app.services.subscriptions.completed_cleanup_runtime_adapter import (
    build_default_completed_cleanup_runtime_dependencies,
    cleanup_completed_subscriptions_with_runtime_adapter,
    cleanup_single_subscription_with_runtime_adapter,
)
from app.services.subscriptions.pre_scan_cleanup_runtime_adapter import (
    build_default_pre_scan_cleanup_runtime_dependencies,
    evaluate_pre_scan_cleanup_with_runtime_adapter,
)
from app.services.subscriptions.postprocess_status_runtime_adapter import (
    apply_precise_transfer_postprocess_status_with_runtime_adapter,
)
from app.services.subscriptions.fixed_source_scan import (
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_source_order_with_runtime_adapter,
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
from app.services.subscriptions.run_summary import (
    normalize_subscription_channel,
)
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
from app.services.subscriptions.run_loader import load_active_subscription_snapshots
from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)
from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)
from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
)
from app.services.subscriptions.hdhive_unlock import (
    allow_unlock_by_threshold,
    safe_int,
    should_stop_unlocking_on_message,
)
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.transfer_notification_runtime_adapter import (
    notify_transfer_success_with_runtime_adapter,
)
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
    check_feiniu_tv_missing_status_with_runtime_adapter,
)
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscription_delete_service import subscription_delete_service

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
        run_start = await start_subscription_run(
            db=db,
            channel=normalized_channel,
            force_auto_download=force_auto_download,
            progress_callback=progress_callback,
            dependencies=SubscriptionRunStartDependencies(
                log_background_event=operation_log_service.log_background_event,
                create_step_log=self._create_step_log,
                load_active_subscriptions=load_active_subscription_snapshots,
                build_hdhive_unlock_context=self._build_hdhive_unlock_context,
                resolve_source_order=self._resolve_source_order,
                now=beijing_now,
                make_run_id=lambda: uuid4().hex,
            ),
        )
        run_id = run_start.run_id
        started_at = run_start.started_at
        result = run_start.result
        hdhive_unlock_context = run_start.hdhive_unlock_context
        source_order = run_start.source_order
        subscriptions = run_start.subscriptions

        result_lock = asyncio.Lock()

        async def _process_subscription(sub: SubscriptionSnapshot) -> None:
            await process_subscription_item(
                sub=sub,
                run_id=run_id,
                channel=normalized_channel,
                force_auto_download=force_auto_download,
                hdhive_unlock_context=hdhive_unlock_context,
                source_order=source_order,
                result=result,
                result_lock=result_lock,
                progress_callback=progress_callback,
                tv_media_type=MediaType.TV,
                dependencies=SubscriptionItemProcessingDependencies(
                    session_factory=async_session_maker,
                    create_step_log=self._create_step_log,
                    log_background_event=(
                        operation_log_service.log_background_event
                    ),
                    evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup,
                    fetch_resources=self._fetch_resources,
                    store_new_resources=self._store_new_resources,
                    load_retryable_records=self._load_retryable_records,
                    load_force_retry_records=self._load_force_retry_records,
                    auto_save_records_with_link_fallback=(
                        self._auto_save_records_with_link_fallback
                    ),
                    should_scan_fixed_sources=self._should_scan_fixed_sources,
                    scan_fixed_sources_for_subscription=(
                        self._scan_fixed_sources_for_subscription
                    ),
                    delete_subscription_with_records=(
                        self._delete_subscription_with_records
                    ),
                ),
            )

        await dispatch_subscription_checks(
            subscriptions=subscriptions,
            concurrency=_SUBSCRIPTION_SCAN_CONCURRENCY,
            dependencies=SubscriptionRunDispatchDependencies(
                process_subscription=_process_subscription,
            ),
        )

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
        return await evaluate_pre_scan_cleanup_with_runtime_adapter(
            db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_pre_scan_cleanup_runtime_dependencies(
                delete_subscription_with_records=(
                    self._delete_subscription_with_records
                ),
                create_step_log=self._create_step_log,
                check_feiniu_movie_status=self._check_feiniu_movie_status,
            ),
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
        return await apply_precise_transfer_postprocess_status_with_runtime_adapter(
            record,
        )

    async def cleanup_completed_subscriptions(
        self, db: AsyncSession
    ) -> dict[str, Any]:
        """离线下载完成后检查并清理已完成的订阅（电影已转存或剧集不缺集）"""
        return await cleanup_completed_subscriptions_with_runtime_adapter(
            db,
            dependencies=build_default_completed_cleanup_runtime_dependencies(
                delete_subscription_with_records=(
                    self._delete_subscription_with_records
                ),
                check_feiniu_movie_status=self._check_feiniu_movie_status,
            ),
        )

    async def _check_feiniu_movie_status(
        self, tmdb_id: int
    ) -> dict[str, Any]:
        """检查电影在飞牛中是否已存在，返回 {"checked": bool, "exists": bool, "item_ids": list}"""
        return await check_feiniu_movie_status_with_runtime_adapter(tmdb_id)

    async def _check_feiniu_tv_missing_status(
        self, tmdb_id: int
    ) -> dict[str, Any]:
        """检查剧集在飞牛中的缺集状态，返回 {"checked": bool, "missing_count": int}"""
        return await check_feiniu_tv_missing_status_with_runtime_adapter(tmdb_id)

    async def cleanup_single_subscription(
        self, db: AsyncSession, subscription_id: int
    ) -> dict[str, Any]:
        """检查并清理单个订阅（电影已转存/已在库 或 剧集不缺集）"""
        return await cleanup_single_subscription_with_runtime_adapter(
            db,
            subscription_id,
            dependencies=build_default_completed_cleanup_runtime_dependencies(
                delete_subscription_with_records=(
                    self._delete_subscription_with_records
                ),
                check_feiniu_movie_status=self._check_feiniu_movie_status,
            ),
        )

    async def _fetch_resources(
        self,
        channel: str,
        sub: "SubscriptionSnapshot",
        hdhive_unlock_context: dict[str, Any] | None = None,
        source_order: list[str] | None = None,
        exclude_urls: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return await fetch_subscription_resources_with_runtime_adapter(
            channel=channel,
            sub=sub,
            dependencies=build_default_resource_resolver_runtime_dependencies(
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
        return resolve_source_order_with_runtime_adapter(channel)

    async def _fetch_from_pansou(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_from_pansou_with_runtime_adapter(sub)

    async def _fetch_from_hdhive(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_from_hdhive_with_runtime_adapter(sub)

    async def _fetch_from_tg(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_from_tg_with_runtime_adapter(sub)

    async def _fetch_offline_magnets(
        self,
        sub: "SubscriptionSnapshot",
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return await fetch_offline_magnets_with_runtime_adapter(sub)

    def _build_hdhive_unlock_context(self) -> dict[str, Any]:
        return build_hdhive_unlock_context_with_runtime_adapter()

    async def _prepare_hdhive_locked_resources(
        self,
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return await prepare_hdhive_locked_resources_with_runtime_adapter(
            resources,
            context,
            traces,
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
        return await store_new_resources_with_runtime_adapter(
            db,
            subscription_id,
            resources,
        )

    async def _load_retryable_records(
        self, db: AsyncSession, subscription_id: int
    ) -> list[DownloadRecord]:
        return await load_retryable_records_with_db_adapter(db, subscription_id)

    async def _load_force_retry_records(
        self,
        db: AsyncSession,
        subscription_id: int,
        duplicate_urls: list[str],
    ) -> list[DownloadRecord]:
        return await load_force_retry_records_with_db_adapter(
            db,
            subscription_id,
            duplicate_urls,
        )

    async def _load_subscription_resource_urls(
        self, db: AsyncSession, subscription_id: int
    ) -> set[str]:
        return await load_subscription_resource_urls_with_db_adapter(
            db,
            subscription_id,
        )

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
        return await auto_save_records_with_link_fallback_with_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=records,
            transfer_source=transfer_source,
            dependencies=LinkFallbackAdapterDependencies(
                create_step_log=self._create_step_log,
                auto_save_resources=self._auto_save_resources,
                load_subscription_resource_urls=self._load_subscription_resource_urls,
                fetch_resources=self._fetch_resources,
                store_new_resources=self._store_new_resources,
                run_link_fallback=auto_save_records_with_link_fallback_flow,
            ),
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
        return await scan_fixed_sources_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            dependencies=build_default_fixed_source_scan_runtime_dependencies(
                resolve_quality_filter=self._resolve_subscription_quality_filter,
                create_step_log=self._create_step_log,
            ),
            tv_missing_snapshot=tv_missing_snapshot,
            force_auto_download=force_auto_download,
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
        return await auto_save_resources_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=records,
            source=source,
            dependencies=build_default_auto_save_resources_runtime_dependencies(
                resolve_quality_filter=self._resolve_subscription_quality_filter,
                create_step_log=self._create_step_log,
                apply_precise_postprocess_status=(
                    self._apply_precise_transfer_postprocess_status
                ),
                notify_transfer_success=self._notify_transfer_success,
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
        return resolve_subscription_quality_filter_with_runtime_adapter(sub)

    @staticmethod
    async def _notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None = None,
    ) -> None:
        await notify_transfer_success_with_runtime_adapter(
            sub_title,
            resource_name,
            source,
            method,
            poster_path=poster_path,
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

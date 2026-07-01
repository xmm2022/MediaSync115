from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable
from uuid import uuid4

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import OperationalError
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
    extract_offline_url,
    extract_resource_url,
    filter_resources_excluding_urls,
    merge_auto_save_stats,
    normalize_share_url,
    should_continue_link_fallback,
)
from app.services.subscriptions.record_selection import (
    dedupe_records_by_resource_url,
    exclude_new_records,
    merge_records,
    select_retryable_records,
)
from app.services.subscriptions.resource_metadata import (
    build_hdhive_keyword,
    build_pansou_keyword,
    build_tg_keyword,
    determine_resource_type,
    extract_resource_name,
    is_already_received_error,
    is_video_filename,
    normalize_hdhive_subscription_items,
    split_share_link_and_receive_code,
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
from app.services.subscriptions.pre_scan_cleanup import (
    PreScanCleanupDependencies,
    evaluate_pre_scan_cleanup as evaluate_pre_scan_cleanup_flow,
)
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription as scan_fixed_sources_flow,
    should_scan_fixed_sources as should_scan_fixed_sources_policy,
)
from app.services.subscriptions.resource_resolver import (
    ResourceResolverDependencies,
    resolve_subscription_resources,
)
from app.services.subscriptions.run_summary import (
    build_run_message,
    normalize_subscription_channel,
    resolve_run_status,
)
from app.services.subscriptions.auto_transfer_context import (
    build_auto_transfer_tv_missing_context,
)
from app.services.subscriptions.auto_transfer_already_received import (
    handle_already_received_transfer,
)
from app.services.subscriptions.auto_transfer_failure import (
    handle_transfer_failure,
)
from app.services.subscriptions.auto_transfer_offline import (
    is_offline_transfer_record,
    submit_offline_transfer_record,
)
from app.services.subscriptions.auto_transfer_precise import (
    submit_precise_transfer_record,
)
from app.services.subscriptions.auto_transfer_share import (
    submit_share_transfer_record,
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
from app.services.runtime_settings_service import runtime_settings_service
from app.services.seedhub_service import seedhub_service
from app.services.subscription_source_service import (
    MANUAL_PAN115_SOURCE,
    subscription_source_service,
)
from app.services.tg_service import tg_service
from app.services.subscription_delete_service import subscription_delete_service
from app.services.subscription_cleanup_policy import (
    build_tv_missing_status_kwargs,
    evaluate_movie_cleanup,
    evaluate_tv_cleanup,
    has_upcoming_episodes_in_subscription_scope,
    normalize_tv_follow_mode,
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

        result = {
            "channel": normalized_channel,
            "run_id": run_id,
            "checked_count": 0,
            "processed_count": 0,
            "new_resource_count": 0,
            "failed_count": 0,
            "auto_saved_count": 0,
            "auto_failed_count": 0,
            "auto_new_saved_count": 0,
            "auto_new_failed_count": 0,
            "auto_retry_saved_count": 0,
            "auto_retry_failed_count": 0,
            "resource_checked_count": 0,
            "resource_duplicate_count": 0,
            "hdhive_unlock_attempted_count": 0,
            "hdhive_unlock_success_count": 0,
            "hdhive_unlock_failed_count": 0,
            "hdhive_unlock_skipped_count": 0,
            "hdhive_unlock_points_spent": 0,
            "cleanup_deleted_count": 0,
            "cleanup_movie_deleted_count": 0,
            "cleanup_tv_deleted_count": 0,
            "errors": [],
            "started_at": started_at.isoformat(),
        }
        hdhive_unlock_context = self._build_hdhive_unlock_context()
        source_order = self._resolve_source_order(normalized_channel)

        has_successful_transfer = (
            select(DownloadRecord.id)
            .where(
                DownloadRecord.subscription_id == Subscription.id,
                or_(
                    DownloadRecord.completed_at.is_not(None),
                    DownloadRecord.status.in_(
                        (MediaStatus.COMPLETED, MediaStatus.OFFLINE_COMPLETED)
                    ),
                ),
            )
            .exists()
            .label("has_successful_transfer")
        )
        subs_result = await db.execute(
            select(
                Subscription.id,
                Subscription.douban_id,
                Subscription.tmdb_id,
                Subscription.title,
                Subscription.media_type,
                Subscription.year,
                Subscription.auto_download,
                Subscription.tv_scope,
                Subscription.tv_season_number,
                Subscription.tv_episode_start,
                Subscription.tv_episode_end,
                Subscription.tv_follow_mode,
                Subscription.tv_include_specials,
                has_successful_transfer,
            )
            .where(
                Subscription.is_active == True,  # noqa: E712
                or_(
                    Subscription.provider.is_(None),
                    Subscription.provider == "",
                    Subscription.provider == "mediasync115",
                ),
                or_(
                    Subscription.external_system.is_(None),
                    Subscription.external_system == "",
                    Subscription.external_system == "mediasync115",
                ),
            )
            .order_by(Subscription.id.asc())
        )
        subscriptions = [
            SubscriptionSnapshot(
                id=int(row.id),
                tmdb_id=int(row.tmdb_id) if row.tmdb_id is not None else None,
                douban_id=str(row.douban_id) if row.douban_id is not None else None,
                title=str(row.title or ""),
                media_type=row.media_type,
                year=str(row.year) if row.year is not None else None,
                auto_download=bool(row.auto_download),
                tv_scope=str(row.tv_scope or "all"),
                tv_season_number=int(row.tv_season_number)
                if row.tv_season_number is not None
                else None,
                tv_episode_start=int(row.tv_episode_start)
                if row.tv_episode_start is not None
                else None,
                tv_episode_end=int(row.tv_episode_end)
                if row.tv_episode_end is not None
                else None,
                tv_follow_mode=str(row.tv_follow_mode or "missing"),
                tv_include_specials=bool(row.tv_include_specials),
                has_successful_transfer=bool(row.has_successful_transfer),
            )
            for row in subs_result.all()
        ]
        result["checked_count"] = len(subscriptions)
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
            await progress_callback(
                {
                    "channel": normalized_channel,
                    "status": "running",
                    "processed_count": 0,
                    "checked_count": result["checked_count"],
                    "new_resource_count": 0,
                    "auto_saved_count": 0,
                    "auto_failed_count": 0,
                    "auto_new_saved_count": 0,
                    "auto_new_failed_count": 0,
                    "auto_retry_saved_count": 0,
                    "auto_retry_failed_count": 0,
                    "failed_count": 0,
                    "message": "任务开始执行",
                }
            )

        scan_semaphore = asyncio.Semaphore(_SUBSCRIPTION_SCAN_CONCURRENCY)
        result_lock = asyncio.Lock()

        async def _process_subscription(sub: SubscriptionSnapshot) -> None:
                sub_id = sub.id
                sub_title = sub.title
                async with async_session_maker() as inner_db:

                    try:
                        await self._create_step_log(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            step="subscription_start",
                            status="info",
                            message=f"正在检查「{sub_title}」的资源和入库状态",
                        )
                        cleanup_before = await self._evaluate_pre_scan_cleanup(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            sub=sub,
                        )
                        if cleanup_before.get("deleted"):
                            async with result_lock:
                                self._apply_cleanup_stats(result, sub.media_type)
                            await self._create_step_log(
                                inner_db,
                                run_id=run_id,
                                channel=normalized_channel,
                                subscription_id=sub_id,
                                subscription_title=sub_title,
                                step="subscription_done",
                                status="success",
                                message="订阅已自动清理",
                            )
                            await operation_log_service.log_background_event(
                                source_type="background_task",
                                module="subscriptions",
                                action="subscription.item.done",
                                status="success",
                                message=f"[{sub_title}] 订阅已自动清理（转存完成或已入库）",
                                trace_id=run_id,
                                extra={
                                    "subscription_id": sub_id,
                                    "title": sub_title,
                                    "channel": normalized_channel,
                                },
                            )
                            await inner_db.commit()
                            return

                        tv_missing_snapshot = cleanup_before.get("tv_missing_snapshot")
                        (
                            resources,
                            fetch_trace,
                            source_attempt_info,
                        ) = await self._fetch_resources(
                            normalized_channel,
                            sub,
                            hdhive_unlock_context,
                            source_order=source_order,
                        )
                        for trace in fetch_trace:
                            await self._create_step_log(
                                inner_db,
                                run_id=run_id,
                                channel=normalized_channel,
                                subscription_id=sub_id,
                                subscription_title=sub_title,
                                step=str(trace.get("step") or "fetch_trace"),
                                status=str(trace.get("status") or "info"),
                                message=str(trace.get("message") or ""),
                                payload=trace.get("payload")
                                if isinstance(trace.get("payload"), dict)
                                else None,
                            )

                        # 记录来源尝试链路汇总日志
                        source_summary = source_attempt_info.get("summary", "")
                        await self._create_step_log(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            step="fetch_resources_summary",
                            status="success" if resources else "warning",
                            message=f"搜索完成，找到 {len(resources)} 个可用资源" if resources else "本轮未找到新资源",
                            payload={
                                "resource_count": len(resources),
                                "source_order": source_attempt_info.get("source_order", []),
                                "attempts": source_attempt_info.get("attempts", []),
                                "summary": source_summary,
                            },
                        )

                        # 为每部影视记录资源抓取汇总
                        fetch_sources_tried = [
                            t.get("payload", {}).get("source", t.get("step", ""))
                            for t in fetch_trace
                            if t.get("step") == "fetch_source_selected"
                        ]
                        await operation_log_service.log_background_event(
                            source_type="background_task",
                            module="subscriptions",
                            action="subscription.item.fetch_done",
                            status="success" if resources else "warning",
                            message=(f"[{sub_title}] {source_summary}"),
                            trace_id=run_id,
                            extra={
                                "subscription_id": sub_id,
                                "title": sub_title,
                                "resource_count": len(resources),
                                "sources_hit": fetch_sources_tried,
                                "source_attempt_summary": source_summary,
                            },
                        )
                        store_stats = await self._store_new_resources(inner_db, sub_id, resources)
                        created_records = store_stats["created_records"]
                        duplicate_urls = store_stats["duplicate_urls"]
                        async with result_lock:
                            result["new_resource_count"] += len(created_records)
                            result["resource_checked_count"] += int(store_stats["checked_count"])
                            result["resource_duplicate_count"] += int(
                                store_stats["duplicate_count"]
                            )
                        await self._create_step_log(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            step="store_new_resources",
                            status="info",
                            message=(
                                f"发现 {len(created_records)} 个新资源待处理"
                                if created_records
                                else "未发现新资源"
                            ),
                            payload={
                                "checked_count": store_stats["checked_count"],
                                "new_count": len(created_records),
                                "duplicate_count": store_stats["duplicate_count"],
                                "invalid_count": store_stats["invalid_count"],
                            },
                        )
                        await operation_log_service.log_background_event(
                            source_type="background_task",
                            module="subscriptions",
                            action="subscription.item.store_done",
                            status="success" if created_records else "info",
                            message=(
                                f"[{sub_title}] 资源入库：新增 {len(created_records)} 条，"
                                f"重复 {store_stats['duplicate_count']} 条，无效 {store_stats['invalid_count']} 条"
                            ),
                            trace_id=run_id,
                            extra={
                                "subscription_id": sub_id,
                                "title": sub_title,
                                "new": len(created_records),
                                "dup": store_stats["duplicate_count"],
                            },
                        )

                        should_auto_download = force_auto_download or bool(sub.auto_download)
                        sub_saved_count = 0
                        sub_failed_transfer_count = 0
                        cleanup_after_auto: dict[str, Any] | None = None
                        if should_auto_download:
                            retry_records = []
                            if sub.auto_download:
                                retry_records = await self._load_retryable_records(inner_db, sub_id)
                            if force_auto_download and duplicate_urls:
                                duplicate_retry_records = await self._load_force_retry_records(
                                    inner_db,
                                    sub_id,
                                    duplicate_urls,
                                )
                                retry_records = merge_records(
                                    retry_records, duplicate_retry_records
                                )
                            retry_records = exclude_new_records(
                                retry_records, created_records
                            )

                            if created_records:
                                await self._create_step_log(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    subscription_id=sub_id,
                                    subscription_title=sub_title,
                                    step="auto_transfer_new_start",
                                    status="info",
                                    message=f"开始转存 {len(created_records)} 个新资源",
                                )
                                await operation_log_service.log_background_event(
                                    source_type="background_task",
                                    module="subscriptions",
                                    action="subscription.item.transfer_new_start",
                                    status="info",
                                    message=f"[{sub_title}] 开始自动转存新资源 {len(created_records)} 条",
                                    trace_id=run_id,
                                    extra={
                                        "subscription_id": sub_id,
                                        "title": sub_title,
                                        "count": len(created_records),
                                    },
                                )
                                new_auto_stats = await self._auto_save_records_with_link_fallback(
                                    inner_db,
                                    run_id,
                                    normalized_channel,
                                    sub,
                                    created_records,
                                    transfer_source="new",
                                    tv_missing_snapshot=tv_missing_snapshot,
                                    hdhive_unlock_context=hdhive_unlock_context,
                                    source_order=source_order,
                                )
                                sub_saved_count += int(new_auto_stats.get("saved") or 0)
                                sub_failed_transfer_count += int(
                                    new_auto_stats.get("failed") or 0
                                )
                                async with result_lock:
                                    result["auto_saved_count"] += new_auto_stats["saved"]
                                    result["auto_failed_count"] += new_auto_stats["failed"]
                                    result["auto_new_saved_count"] += new_auto_stats["saved"]
                                    result["auto_new_failed_count"] += new_auto_stats["failed"]
                                    if new_auto_stats["errors"]:
                                        result["errors"].extend(new_auto_stats["errors"])
                                await self._create_step_log(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    subscription_id=sub_id,
                                    subscription_title=sub_title,
                                    step="auto_transfer_new_done",
                                    status="success"
                                    if new_auto_stats["failed"] == 0
                                    else "partial",
                                    message=(
                                        f"新资源转存完成：成功 {new_auto_stats['saved']} 条"
                                        + (f"，失败 {new_auto_stats['failed']} 条" if new_auto_stats['failed'] else "")
                                    ),
                                )
                                await operation_log_service.log_background_event(
                                    source_type="background_task",
                                    module="subscriptions",
                                    action="subscription.item.transfer_new_done",
                                    status="success"
                                    if new_auto_stats["failed"] == 0
                                    else "warning",
                                    message=f"[{sub_title}] 新资源转存完成：成功 {new_auto_stats['saved']} 条，失败 {new_auto_stats['failed']} 条",
                                    trace_id=run_id,
                                    extra={
                                        "subscription_id": sub_id,
                                        "title": sub_title,
                                        "saved": new_auto_stats["saved"],
                                        "failed": new_auto_stats["failed"],
                                    },
                                )
                                if new_auto_stats.get("subscription_completed"):
                                    cleanup_after_auto = new_auto_stats

                            if retry_records and cleanup_after_auto is None:
                                await self._create_step_log(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    subscription_id=sub_id,
                                    subscription_title=sub_title,
                                    step="auto_transfer_retry_start",
                                    status="info",
                                    message=f"开始重试之前失败的 {len(retry_records)} 个资源",
                                )
                                await operation_log_service.log_background_event(
                                    source_type="background_task",
                                    module="subscriptions",
                                    action="subscription.item.transfer_retry_start",
                                    status="info",
                                    message=f"[{sub_title}] 开始重试历史记录 {len(retry_records)} 条",
                                    trace_id=run_id,
                                    extra={
                                        "subscription_id": sub_id,
                                        "title": sub_title,
                                        "count": len(retry_records),
                                    },
                                )
                                retry_auto_stats = await self._auto_save_records_with_link_fallback(
                                    inner_db,
                                    run_id,
                                    normalized_channel,
                                    sub,
                                    retry_records,
                                    transfer_source="retry",
                                    tv_missing_snapshot=tv_missing_snapshot,
                                    hdhive_unlock_context=hdhive_unlock_context,
                                    source_order=source_order,
                                    enable_link_refetch=False,
                                )
                                sub_saved_count += int(retry_auto_stats.get("saved") or 0)
                                sub_failed_transfer_count += int(
                                    retry_auto_stats.get("failed") or 0
                                )
                                async with result_lock:
                                    result["auto_saved_count"] += retry_auto_stats["saved"]
                                    result["auto_failed_count"] += retry_auto_stats["failed"]
                                    result["auto_retry_saved_count"] += retry_auto_stats["saved"]
                                    result["auto_retry_failed_count"] += retry_auto_stats["failed"]
                                    if retry_auto_stats["errors"]:
                                        result["errors"].extend(retry_auto_stats["errors"])
                                await self._create_step_log(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    subscription_id=sub_id,
                                    subscription_title=sub_title,
                                    step="auto_transfer_retry_done",
                                    status="success"
                                    if retry_auto_stats["failed"] == 0
                                    else "partial",
                                    message=(
                                        f"重试完成：成功 {retry_auto_stats['saved']} 条"
                                        + (f"，失败 {retry_auto_stats['failed']} 条" if retry_auto_stats['failed'] else "")
                                    ),
                                )
                                await operation_log_service.log_background_event(
                                    source_type="background_task",
                                    module="subscriptions",
                                    action="subscription.item.transfer_retry_done",
                                    status="success"
                                    if retry_auto_stats["failed"] == 0
                                    else "warning",
                                    message=f"[{sub_title}] 历史重试完成：成功 {retry_auto_stats['saved']} 条，失败 {retry_auto_stats['failed']} 条",
                                    trace_id=run_id,
                                    extra={
                                        "subscription_id": sub_id,
                                        "title": sub_title,
                                        "saved": retry_auto_stats["saved"],
                                        "failed": retry_auto_stats["failed"],
                                    },
                                )
                                if retry_auto_stats.get("subscription_completed"):
                                    cleanup_after_auto = retry_auto_stats

                            await self._create_step_log(
                                inner_db,
                                run_id=run_id,
                                channel=normalized_channel,
                                subscription_id=sub_id,
                                subscription_title=sub_title,
                                step="auto_transfer_summary",
                                status="success"
                                if sub_failed_transfer_count == 0
                                else "partial",
                                message=(
                                    f"本轮转存汇总：成功 {sub_saved_count} 条"
                                    + (f"，失败 {sub_failed_transfer_count} 条" if sub_failed_transfer_count else "")
                                    + f"（新资源 {len(created_records)} 个"
                                    + (f"，重试 {len(retry_records)} 个" if retry_records else "")
                                    + "）"
                                ),
                            )
                            if cleanup_after_auto is not None:
                                await self._delete_subscription_with_records(inner_db, sub_id)
                                await operation_log_service.log_background_event(
                                    source_type="background_task",
                                    module="subscriptions",
                                    action="subscription.item.cleanup_after_transfer",
                                    status="success",
                                    message=f"[{sub_title}] 转存完成后自动清理订阅：{str(cleanup_after_auto.get('cleanup_message') or '订阅已自动清理')}",
                                    trace_id=run_id,
                                    extra={
                                        "subscription_id": sub_id,
                                        "title": sub_title,
                                        "reason": cleanup_after_auto.get("cleanup_step"),
                                    },
                                )
                                await self._create_step_log(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    subscription_id=sub_id,
                                    subscription_title=sub_title,
                                    step=str(
                                        cleanup_after_auto.get("cleanup_step")
                                        or "subscription_cleanup_after_transfer"
                                    ),
                                    status="success",
                                    message=str(
                                        cleanup_after_auto.get("cleanup_message")
                                        or "订阅已自动清理"
                                    ),
                                    payload=cleanup_after_auto.get("cleanup_payload")
                                    if isinstance(
                                        cleanup_after_auto.get("cleanup_payload"), dict
                                    )
                                    else None,
                                )
                                async with result_lock:
                                    self._apply_cleanup_stats(result, sub.media_type)
                        else:
                            await self._create_step_log(
                                inner_db,
                                run_id=run_id,
                                channel=normalized_channel,
                                subscription_id=sub_id,
                                subscription_title=sub_title,
                                step="auto_transfer_skip",
                                status="info",
                                message="未开启自动转存，已记录资源供手动处理",
                            )

                        if (
                            cleanup_after_auto is None
                            and self._should_scan_fixed_sources(
                                sub,
                                force_auto_download=force_auto_download,
                            )
                        ):
                            fixed_source_stats = (
                                await self._scan_fixed_sources_for_subscription(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    sub=sub,
                                    tv_missing_snapshot=tv_missing_snapshot,
                                    force_auto_download=force_auto_download,
                                )
                            )
                            fixed_saved = int(fixed_source_stats.get("saved") or 0)
                            fixed_failed = int(fixed_source_stats.get("failed") or 0)
                            sub_saved_count += fixed_saved
                            sub_failed_transfer_count += fixed_failed
                            async with result_lock:
                                result["auto_saved_count"] += fixed_saved
                                result["auto_failed_count"] += fixed_failed
                            if sub.media_type == MediaType.MOVIE and fixed_saved > 0:
                                await self._delete_subscription_with_records(inner_db, sub_id)
                                await operation_log_service.log_background_event(
                                    source_type="background_task",
                                    module="subscriptions",
                                    action="subscription.item.cleanup_after_fixed_source",
                                    status="success",
                                    message=f"[{sub_title}] 电影固定来源转存完成，自动删除订阅",
                                    trace_id=run_id,
                                    extra={
                                        "subscription_id": sub_id,
                                        "title": sub_title,
                                        "reason": "movie_fixed_source_transferred",
                                    },
                                )
                                await self._create_step_log(
                                    inner_db,
                                    run_id=run_id,
                                    channel=normalized_channel,
                                    subscription_id=sub_id,
                                    subscription_title=sub_title,
                                    step="subscription_cleanup_movie_fixed_source",
                                    status="success",
                                    message="电影固定来源转存完成，订阅已自动清理",
                                    payload={"fixed_saved": fixed_saved},
                                )
                                async with result_lock:
                                    self._apply_cleanup_stats(result, sub.media_type)

                        await self._create_step_log(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            step="subscription_done",
                            status="success",
                            message="订阅处理完成",
                        )
                        # 构建每部影视的摘要信息
                        item_parts = [f"[{sub_title}]"]
                        item_new = result["new_resource_count"]
                        if should_auto_download:
                            item_parts.append(
                                f"新资源 {len(created_records)} 条，"
                                f"转存成功 {sub_saved_count} 条，失败 {sub_failed_transfer_count} 条"
                            )
                        else:
                            item_parts.append(
                                f"新资源 {len(created_records)} 条（未启用自动转存）"
                            )
                        await operation_log_service.log_background_event(
                            source_type="background_task",
                            module="subscriptions",
                            action="subscription.item.done",
                            status="success" if sub_failed_transfer_count == 0 else "warning",
                            message="，".join(item_parts),
                            trace_id=run_id,
                            extra={
                                "subscription_id": sub_id,
                                "title": sub_title,
                                "channel": normalized_channel,
                                "new_resources": len(created_records),
                                "auto_saved": sub_saved_count if should_auto_download else None,
                                "auto_failed": sub_failed_transfer_count
                                if should_auto_download
                                else None,
                            },
                        )
                        await inner_db.commit()
                    except Exception as exc:
                        await inner_db.rollback()
                        async with result_lock:
                            result["failed_count"] += 1
                            result["errors"].append(
                                {
                                    "subscription_id": sub_id,
                                    "title": sub_title,
                                    "error": str(exc),
                                }
                            )
                        await self._create_step_log(
                            inner_db,
                            run_id=run_id,
                            channel=normalized_channel,
                            subscription_id=sub_id,
                            subscription_title=sub_title,
                            step="subscription_failed",
                            status="failed",
                            message=f"处理出错：{str(exc)[:200]}",
                        )
                        await operation_log_service.log_background_event(
                            source_type="background_task",
                            module="subscriptions",
                            action="subscription.item.failed",
                            status="failed",
                            message=f"[{sub_title}] 订阅处理失败: {str(exc)[:200]}",
                            trace_id=run_id,
                            extra={
                                "subscription_id": sub_id,
                                "title": sub_title,
                                "channel": normalized_channel,
                                "error": str(exc)[:500],
                            },
                        )
                        await inner_db.commit()
                    finally:
                        async with result_lock:
                            result["processed_count"] += 1
                            progress_payload = {
                                "channel": normalized_channel,
                                "status": "running",
                                "processed_count": result["processed_count"],
                                "checked_count": result["checked_count"],
                                "new_resource_count": result["new_resource_count"],
                                "auto_saved_count": result["auto_saved_count"],
                                "auto_failed_count": result["auto_failed_count"],
                                "auto_new_saved_count": result["auto_new_saved_count"],
                                "auto_new_failed_count": result["auto_new_failed_count"],
                                "auto_retry_saved_count": result["auto_retry_saved_count"],
                                "auto_retry_failed_count": result[
                                    "auto_retry_failed_count"
                                ],
                                "failed_count": result["failed_count"],
                                "message": f"已处理 {result['processed_count']}/{result['checked_count']} 项订阅",
                            }
                        if progress_callback:
                            await progress_callback(progress_payload)


        async def _bounded_subscription(sub: SubscriptionSnapshot) -> None:
            async with scan_semaphore:
                await _process_subscription(sub)

        if subscriptions:
            await asyncio.gather(*(_bounded_subscription(sub) for sub in subscriptions))

        status = resolve_run_status(
            result["failed_count"],
            result["checked_count"],
            result["auto_failed_count"],
            success_status=ExecutionStatus.SUCCESS,
            failed_status=ExecutionStatus.FAILED,
            partial_status=ExecutionStatus.PARTIAL,
        )
        unlock_stats = hdhive_unlock_context.get("stats", {})
        result["hdhive_unlock_attempted_count"] = int(
            unlock_stats.get("attempted") or 0
        )
        result["hdhive_unlock_success_count"] = int(unlock_stats.get("success") or 0)
        result["hdhive_unlock_failed_count"] = int(unlock_stats.get("failed") or 0)
        result["hdhive_unlock_skipped_count"] = int(unlock_stats.get("skipped") or 0)
        result["hdhive_unlock_points_spent"] = int(
            unlock_stats.get("points_spent") or 0
        )
        message = build_run_message(result)
        finished_at = beijing_now()
        result["finished_at"] = finished_at.isoformat()
        result["status"] = status.value
        result["message"] = message

        await operation_log_service.log_background_event(
            source_type="background_task",
            module="subscriptions",
            action="subscription.check.finish",
            status=status.value,
            message=(
                f"订阅检查任务完成（频道：{normalized_channel}）：检查 {result['checked_count']} 项，"
                f"新增资源 {result['new_resource_count']} 条，"
                f"转存成功 {result['auto_saved_count']} 条，转存失败 {result['auto_failed_count']} 条，"
                f"自动清理 {result['cleanup_deleted_count']} 项，"
                f"失败 {result['failed_count']} 项"
            ),
            trace_id=run_id,
            extra={
                "channel": normalized_channel,
                "checked_count": result["checked_count"],
                "new_resource_count": result["new_resource_count"],
                "auto_saved_count": result["auto_saved_count"],
                "auto_failed_count": result["auto_failed_count"],
                "cleanup_deleted_count": result["cleanup_deleted_count"],
                "failed_count": result["failed_count"],
                "hdhive_unlock_attempted_count": result[
                    "hdhive_unlock_attempted_count"
                ],
                "hdhive_unlock_success_count": result["hdhive_unlock_success_count"],
                "hdhive_unlock_points_spent": result["hdhive_unlock_points_spent"],
            },
        )

        finalize_error = ""
        try:
            await self._create_execution_log(
                db=db,
                channel=normalized_channel,
                status=status,
                message=message,
                checked_count=result["checked_count"],
                new_resource_count=result["new_resource_count"],
                failed_count=result["failed_count"],
                details=result["errors"],
                started_at=started_at,
                finished_at=finished_at,
            )
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=normalized_channel,
                step="run_finish",
                status=status.value,
                message=message,
                payload={
                    "checked_count": result["checked_count"],
                    "resource_checked_count": result["resource_checked_count"],
                    "new_resource_count": result["new_resource_count"],
                    "resource_duplicate_count": result["resource_duplicate_count"],
                    "auto_saved_count": result["auto_saved_count"],
                    "auto_failed_count": result["auto_failed_count"],
                    "failed_count": result["failed_count"],
                    "cleanup_deleted_count": result["cleanup_deleted_count"],
                    "cleanup_movie_deleted_count": result[
                        "cleanup_movie_deleted_count"
                    ],
                    "cleanup_tv_deleted_count": result["cleanup_tv_deleted_count"],
                    "hdhive_unlock_attempted_count": result[
                        "hdhive_unlock_attempted_count"
                    ],
                    "hdhive_unlock_success_count": result[
                        "hdhive_unlock_success_count"
                    ],
                    "hdhive_unlock_failed_count": result["hdhive_unlock_failed_count"],
                    "hdhive_unlock_skipped_count": result[
                        "hdhive_unlock_skipped_count"
                    ],
                    "hdhive_unlock_points_spent": result["hdhive_unlock_points_spent"],
                },
            )
            await self._prune_step_logs(db)
            await db.commit()
        except Exception as exc:
            finalize_error = str(exc)
            await db.rollback()
            result["errors"].append({"stage": "run_finalize", "error": finalize_error})
            result["finalize_error"] = finalize_error
            result["message"] = f"{message}；收尾阶段异常: {finalize_error[:200]}"
            if result["status"] == ExecutionStatus.SUCCESS.value:
                result["status"] = ExecutionStatus.PARTIAL.value

            try:
                await self._create_step_log(
                    db,
                    run_id=run_id,
                    channel=normalized_channel,
                    step="run_finalize_failed",
                    status="warning",
                    message=f"写入执行日志失败：{finalize_error[:200]}",
                    payload={
                        "error": finalize_error[:500],
                        "status_before_finalize": status.value,
                    },
                )
                await db.commit()
            except Exception:
                await db.rollback()
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
        archive_result = await media_postprocess_service.trigger_archive_after_transfer(
            trigger="subscription_transfer"
        )
        if archive_result.get("triggered"):
            record.status = MediaStatus.ARCHIVING
            record.completed_at = None
        else:
            record.status = MediaStatus.COMPLETED
            record.completed_at = beijing_now()
        record.error_message = None
        return archive_result

    @staticmethod
    def _apply_cleanup_stats(result: dict[str, Any], media_type: MediaType) -> None:
        result["cleanup_deleted_count"] = (
            int(result.get("cleanup_deleted_count") or 0) + 1
        )
        if media_type == MediaType.TV:
            result["cleanup_tv_deleted_count"] = (
                int(result.get("cleanup_tv_deleted_count") or 0) + 1
            )
        else:
            result["cleanup_movie_deleted_count"] = (
                int(result.get("cleanup_movie_deleted_count") or 0) + 1
            )

    async def cleanup_completed_subscriptions(
        self, db: AsyncSession
    ) -> dict[str, Any]:
        """离线下载完成后检查并清理已完成的订阅（电影已转存或剧集不缺集）"""
        result: dict[str, Any] = {"deleted_count": 0, "details": []}

        has_successful_transfer = (
            select(DownloadRecord.id)
            .where(
                DownloadRecord.subscription_id == Subscription.id,
                or_(
                    DownloadRecord.completed_at.is_not(None),
                    DownloadRecord.status.in_(
                        (MediaStatus.COMPLETED, MediaStatus.OFFLINE_COMPLETED)
                    ),
                ),
            )
            .exists()
            .label("has_successful_transfer")
        )

        subs_result = await db.execute(
            select(
                Subscription.id,
                Subscription.tmdb_id,
                Subscription.title,
                Subscription.media_type,
                Subscription.tv_scope,
                Subscription.tv_season_number,
                Subscription.tv_episode_start,
                Subscription.tv_episode_end,
                Subscription.tv_follow_mode,
                Subscription.tv_include_specials,
                has_successful_transfer,
            )
            .where(
                Subscription.is_active == True,  # noqa: E712
                or_(
                    Subscription.provider.is_(None),
                    Subscription.provider == "",
                    Subscription.provider == "mediasync115",
                ),
                or_(
                    Subscription.external_system.is_(None),
                    Subscription.external_system == "",
                    Subscription.external_system == "mediasync115",
                ),
            )
            .order_by(Subscription.id.asc())
        )

        # 收集所有命中的订阅，先不立即写操作日志（避免 commit 失败导致日志/数据不一致）
        pending_log_payloads: list[dict[str, Any]] = []
        for row in subs_result.all():
            sub_id = int(row.id)
            title = str(row.title or "")
            media_type = row.media_type
            tmdb_id = int(row.tmdb_id) if row.tmdb_id is not None else None
            sub_has_transfer = bool(row.has_successful_transfer)
            should_delete, reason = await self._evaluate_subscription_cleanup_eligibility(
                row,
                has_successful_transfer=sub_has_transfer,
            )

            if should_delete:
                await self._delete_subscription_with_records(db, sub_id)
                result["deleted_count"] += 1
                detail = {
                    "subscription_id": sub_id,
                    "title": title,
                    "media_type": str(media_type.value)
                    if hasattr(media_type, "value")
                    else str(media_type),
                    "reason": reason,
                }
                result["details"].append(detail)
                pending_log_payloads.append(
                    {
                        "subscription_id": sub_id,
                        "title": title,
                        "reason": reason,
                    }
                )

        if result["deleted_count"] > 0:
            # 带退避重试的 commit，应对 emby/feiniu 全量同步刚完成时的短暂并发冲突。
            for retry in range(3):
                try:
                    await db.commit()
                    break
                except OperationalError as exc:
                    message = str(exc).lower()
                    retryable = any(
                        token in message
                        for token in (
                            "deadlock detected",
                            "could not serialize access",
                            "lock timeout",
                        )
                    )
                    if not retryable or retry >= 2:
                        await db.rollback()
                        raise
                    delay = 1.0 * (2 ** retry)
                    logger.warning(
                        "订阅清理 commit 遇到数据库并发冲突，%0.1fs 后重试（%d/3）",
                        delay,
                        retry + 1,
                    )
                    await asyncio.sleep(delay)

            logger.info(
                "离线完成触发订阅清理，共删除 %d 项订阅",
                result["deleted_count"],
            )

            # commit 成功后再写操作日志（独立 session，不影响主事务）
            for payload in pending_log_payloads:
                try:
                    await operation_log_service.log_background_event(
                        source_type="background_task",
                        module="subscriptions",
                        action="subscription.item.cleanup_offline_completed",
                        status="success",
                        message=f"[{payload['title']}] 离线完成触发清理：{payload['reason']}，自动删除订阅",
                        extra=payload,
                    )
                except Exception:
                    logger.exception("写订阅清理操作日志失败: %s", payload.get("title"))
        return result

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

    async def _subscription_has_successful_transfer(
        self, db: AsyncSession, subscription_id: int
    ) -> bool:
        exists_clause = (
            select(DownloadRecord.id)
            .where(
                DownloadRecord.subscription_id == subscription_id,
                or_(
                    DownloadRecord.completed_at.is_not(None),
                    DownloadRecord.status.in_(
                        (MediaStatus.COMPLETED, MediaStatus.OFFLINE_COMPLETED)
                    ),
                ),
            )
            .exists()
        )
        result = await db.execute(select(exists_clause))
        return bool(result.scalar())

    async def _evaluate_subscription_cleanup_eligibility(
        self,
        sub: Subscription | "SubscriptionSnapshot",
        *,
        has_successful_transfer: bool,
    ) -> tuple[bool, str]:
        """按统一策略判断订阅是否应自动清理。"""
        if sub.media_type == MediaType.MOVIE:
            emby_exists = False
            feiniu_exists = False
            if sub.tmdb_id is not None:
                try:
                    movie_status = await emby_service.get_movie_status_by_tmdb(sub.tmdb_id)
                    emby_exists = str(movie_status.get("status") or "") == "ok" and bool(
                        movie_status.get("exists")
                    )
                except Exception:
                    logger.exception("订阅清理检查 Emby 电影失败: %s", sub.title)
                feiniu_movie = await self._check_feiniu_movie_status(sub.tmdb_id)
                feiniu_exists = bool(
                    feiniu_movie.get("checked") and feiniu_movie.get("exists")
                )
            return evaluate_movie_cleanup(
                has_successful_transfer=has_successful_transfer,
                emby_exists=emby_exists,
                feiniu_exists=feiniu_exists,
            )

        if sub.media_type != MediaType.TV or sub.tmdb_id is None:
            return False, ""

        try:
            tv_kwargs = build_tv_missing_status_kwargs(sub)
            tv_missing_result = await tv_missing_service.get_tv_missing_status(
                sub.tmdb_id,
                **tv_kwargs,
            )
            follow_mode = normalize_tv_follow_mode(sub.tv_follow_mode)
            has_upcoming = False
            if follow_mode == "new":
                has_upcoming = await has_upcoming_episodes_in_subscription_scope(
                    sub.tmdb_id, sub
                )
            return evaluate_tv_cleanup(
                tv_missing_result,
                follow_mode=follow_mode,
                has_upcoming_episodes=has_upcoming,
            )
        except Exception:
            logger.exception("订阅清理检查剧集状态失败: %s", sub.title)
            return False, ""

    async def cleanup_single_subscription(
        self, db: AsyncSession, subscription_id: int
    ) -> dict[str, Any]:
        """检查并清理单个订阅（电影已转存/已在库 或 剧集不缺集）"""
        sub_result = await db.execute(
            select(Subscription).where(Subscription.id == subscription_id)
        )
        sub = sub_result.scalar_one_or_none()
        if sub is None:
            return {"deleted": False, "reason": "订阅不存在"}
        if not sub.is_active:
            return {"deleted": False, "reason": "订阅未激活"}
        provider = str(getattr(sub, "provider", "") or "mediasync115").strip()
        external_system = str(getattr(sub, "external_system", "") or "").strip()
        if provider not in {"", "mediasync115"} or external_system not in {
            "",
            "mediasync115",
        }:
            return {
                "deleted": False,
                "reason": "外部渠道订阅不参与 MediaSync115 自动清理",
            }

        sub_has_transfer = await self._subscription_has_successful_transfer(db, sub.id)
        should_delete, reason = await self._evaluate_subscription_cleanup_eligibility(
            sub,
            has_successful_transfer=sub_has_transfer,
        )

        if not should_delete:
            return {"deleted": False, "reason": ""}

        await self._delete_subscription_with_records(db, sub.id)
        await db.commit()
        await operation_log_service.log_background_event(
            source_type="api",
            module="subscriptions",
            action="subscription.item.cleanup_manual",
            status="success",
            message=f"[{sub.title}] 手动触发清理：{reason}，自动删除订阅",
            extra={
                "subscription_id": sub.id,
                "title": sub.title,
                "reason": reason,
            },
        )
        logger.info(
            "单订阅清理完成: id=%d title=%s reason=%s",
            sub.id, sub.title, reason,
        )
        return {"deleted": True, "reason": reason}

    async def _fetch_resources(
        self,
        channel: str,
        sub: "SubscriptionSnapshot",
        hdhive_unlock_context: dict[str, Any] | None = None,
        source_order: list[str] | None = None,
        exclude_urls: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        async def log_source_fetch(
            current_sub: "SubscriptionSnapshot", source: str, count: int
        ) -> None:
            await operation_log_service.log_background_event(
                source_type="background_task",
                module="subscriptions",
                action="subscription.item.fetch_source",
                status="success" if count else "info",
                message=f"[{current_sub.title}] 来源 {source} 返回 {count} 条资源",
                extra={
                    "subscription_id": current_sub.id,
                    "title": current_sub.title,
                    "source": source,
                    "count": count,
                },
            )

        def emit_source_attempt(
            current_sub: "SubscriptionSnapshot", attempt_info: dict[str, Any]
        ) -> None:
            from app.analytics import kafka_producer

            if kafka_producer._enabled:
                kafka_producer.send(
                    event_type="source_attempt",
                    data={
                        "subscription_id": current_sub.id,
                        "title": current_sub.title,
                        "source": attempt_info.get("source"),
                        "status": attempt_info.get("status", "empty"),
                        "resource_count": attempt_info.get("count", 0),
                    },
                    key=str(current_sub.id),
                )

        dependencies = ResourceResolverDependencies(
            fetch_from_hdhive=self._fetch_from_hdhive,
            fetch_from_tg=self._fetch_from_tg,
            fetch_from_pansou=self._fetch_from_pansou,
            fetch_offline_magnets=self._fetch_offline_magnets,
            resolve_source_order=self._resolve_source_order,
            resolve_subscription_resolutions=self._resolve_subscription_resolutions,
            resolve_subscription_quality_filter=self._resolve_subscription_quality_filter,
            prepare_hdhive_locked_resources=self._prepare_hdhive_locked_resources,
            build_hdhive_unlock_context=self._build_hdhive_unlock_context,
            filter_resources_excluding_urls=filter_resources_excluding_urls,
            log_source_fetch=log_source_fetch,
            emit_source_attempt=emit_source_attempt,
        )
        return await resolve_subscription_resources(
            channel=channel,
            sub=sub,
            dependencies=dependencies,
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

    async def _fetch_from_pansou(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        traces: list[dict[str, Any]] = []
        media_type = "tv" if sub.media_type == MediaType.TV else "movie"

        if sub.tmdb_id is not None:
            try:
                traces.append(
                    {
                        "step": "fetch_pansou_tmdb_start",
                        "status": "info",
                        "message": "开始通过 tmdb_id 调用 Pansou",
                        "payload": {"tmdb_id": sub.tmdb_id, "media_type": media_type},
                    }
                )
                pansou_result = await _search_pansou_pan115_resources(
                    sub.tmdb_id,
                    media_type,
                    sub.tv_season_number if media_type == "tv" else None,
                )
                pansou_list = list(pansou_result.get("list") or [])
                if pansou_list:
                    traces.append(
                        {
                            "step": "fetch_pansou_tmdb_done",
                            "status": "success",
                            "message": f"Pansou(TMDB) 返回 {len(pansou_list)} 条候选资源",
                            "payload": {"count": len(pansou_list)},
                        }
                    )
                    return pansou_list, traces
                traces.append(
                    {
                        "step": "fetch_pansou_tmdb_empty",
                        "status": "warning",
                        "message": "Pansou(TMDB) 未命中资源，尝试关键词兜底",
                    }
                )
            except Exception as exc:
                traces.append(
                    {
                        "step": "fetch_pansou_tmdb_failed",
                        "status": "warning",
                        "message": "Pansou(TMDB) 请求失败，尝试关键词兜底",
                        "payload": {"error": str(exc)[:300]},
                    }
                )

        keyword = build_pansou_keyword(sub.title, sub.year)
        if not keyword:
            traces.append(
                {
                    "step": "fetch_pansou_keyword_skip",
                    "status": "warning",
                    "message": "缺少关键词，无法执行 Pansou 兜底搜索",
                }
            )
            return [], traces
        traces.append(
            {
                "step": "fetch_pansou_keyword_start",
                "status": "info",
                "message": "开始通过关键词调用 Pansou",
                "payload": {"keyword": keyword},
            }
        )
        payload = await pansou_service.search_115(keyword, res="results")
        resources = _normalize_pansou_pan115_list(payload)
        traces.append(
            {
                "step": "fetch_pansou_keyword_done",
                "status": "success" if resources else "warning",
                "message": f"Pansou(关键词) 返回 {len(resources)} 条候选资源",
                "payload": {"count": len(resources)},
            }
        )
        return resources, traces

    async def _fetch_from_hdhive(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        traces: list[dict[str, Any]] = []
        resources: list[dict[str, Any]] = []
        if sub.tmdb_id is not None:
            try:
                traces.append(
                    {
                        "step": "fetch_hdhive_tmdb_start",
                        "status": "info",
                        "message": "开始通过 tmdb_id 调用 HDHive",
                        "payload": {
                            "tmdb_id": sub.tmdb_id,
                            "media_type": sub.media_type.value,
                        },
                    }
                )
                if sub.media_type == MediaType.TV:
                    resources = await hdhive_service.get_tv_pan115(sub.tmdb_id)
                else:
                    resources = await hdhive_service.get_movie_pan115(sub.tmdb_id)
                resources = normalize_hdhive_subscription_items(resources)
                if runtime_settings_service.get_subscription_hdhive_prefer_free():
                    resources = hdhive_service.sort_free_first(resources)
                traces.append(
                    {
                        "step": "fetch_hdhive_tmdb_done",
                        "status": "success" if resources else "warning",
                        "message": f"HDHive(TMDB) 返回 {len(resources)} 条候选资源",
                        "payload": {"count": len(resources)},
                    }
                )
                if resources:
                    return resources, traces
            except Exception as exc:
                traces.append(
                    {
                        "step": "fetch_hdhive_tmdb_failed",
                        "status": "warning",
                        "message": "HDHive(TMDB) 请求失败，尝试关键词兜底",
                        "payload": {"error": str(exc)[:300]},
                    }
                )

        keyword = build_hdhive_keyword(sub.title, sub.year)
        if not keyword:
            traces.append(
                {
                    "step": "fetch_hdhive_keyword_skip",
                    "status": "warning",
                    "message": "缺少关键词，无法执行 HDHive 兜底搜索",
                }
            )
            return [], traces

        traces.append(
            {
                "step": "fetch_hdhive_keyword_start",
                "status": "info",
                "message": "开始通过关键词调用 HDHive",
                "payload": {"keyword": keyword},
            }
        )
        media_type = "tv" if sub.media_type == MediaType.TV else "movie"
        keyword_resources = await hdhive_service.get_pan115_by_keyword(
            keyword, media_type=media_type
        )
        keyword_resources = normalize_hdhive_subscription_items(keyword_resources)
        if runtime_settings_service.get_subscription_hdhive_prefer_free():
            keyword_resources = hdhive_service.sort_free_first(keyword_resources)
        traces.append(
            {
                "step": "fetch_hdhive_keyword_done",
                "status": "success" if keyword_resources else "warning",
                "message": f"HDHive(关键词) 返回 {len(keyword_resources)} 条候选资源",
                "payload": {"count": len(keyword_resources)},
            }
        )
        return keyword_resources, traces

    async def _fetch_from_tg(
        self, sub: "SubscriptionSnapshot"
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        traces: list[dict[str, Any]] = []
        keyword = build_tg_keyword(sub.title, sub.year)
        if not keyword:
            traces.append(
                {
                    "step": "fetch_tg_keyword_skip",
                    "status": "warning",
                    "message": "缺少关键词，无法执行 Telegram 搜索",
                }
            )
            return [], traces

        traces.append(
            {
                "step": "fetch_tg_keyword_start",
                "status": "info",
                "message": "开始通过关键词调用 Telegram 频道搜索",
                "payload": {"keyword": keyword},
            }
        )
        media_type = "tv" if sub.media_type == MediaType.TV else "movie"
        resources = await tg_service.search_115_by_keyword(
            keyword, media_type=media_type
        )
        traces.append(
            {
                "step": "fetch_tg_keyword_done",
                "status": "success" if resources else "warning",
                "message": f"Telegram 返回 {len(resources)} 条候选资源",
                "payload": {"count": len(resources)},
            }
        )
        return resources, traces

    async def _fetch_offline_magnets(
        self,
        sub: "SubscriptionSnapshot",
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """离线转存启用时，从 SeedHub / 不太灵并发抓取磁力资源。"""
        if not runtime_settings_service.get_subscription_offline_transfer_enabled():
            return [], []

        traces: list[dict[str, Any]] = []
        keyword = build_pansou_keyword(sub.title, sub.year)
        media_type = "tv" if sub.media_type == MediaType.TV else "movie"

        async def _seedhub() -> list[dict[str, Any]]:
            if not keyword:
                return []
            return await seedhub_service.search_magnets_by_keyword(keyword, limit=20)

        async def _butailing() -> list[dict[str, Any]]:
            if not keyword:
                return []
            return await butailing_service.search_magnets(
                keyword, media_type=media_type
            )

        seedhub_result, butailing_result = await asyncio.gather(
            _seedhub(),
            _butailing(),
            return_exceptions=True,
        )

        merged: list[dict[str, Any]] = []
        for label, result in [
            ("SeedHub", seedhub_result),
            ("不太灵", butailing_result),
        ]:
            if isinstance(result, BaseException):
                traces.append(
                    {
                        "step": "fetch_offline_magnet_error",
                        "status": "warning",
                        "message": f"{label} 磁力抓取失败: {str(result)[:200]}",
                    }
                )
                await operation_log_service.log_background_event(
                    source_type="background_task",
                    module="subscriptions",
                    action="subscription.item.fetch_offline_source",
                    status="warning",
                    message=f"[{sub.title}] 离线来源 {label} 抓取失败：{str(result)[:200]}",
                    extra={
                        "subscription_id": sub.id,
                        "title": sub.title,
                        "source": label,
                        "error": str(result)[:300],
                    },
                )
            elif result:
                merged.extend(result)
                traces.append(
                    {
                        "step": "fetch_offline_magnet_done",
                        "status": "info",
                        "message": f"{label} 磁力资源 {len(result)} 条",
                        "payload": {"source": label, "count": len(result)},
                    }
                )
                await operation_log_service.log_background_event(
                    source_type="background_task",
                    module="subscriptions",
                    action="subscription.item.fetch_offline_source",
                    status="success",
                    message=f"[{sub.title}] 离线来源 {label} 返回 {len(result)} 条磁力资源",
                    extra={
                        "subscription_id": sub.id,
                        "title": sub.title,
                        "source": label,
                        "count": len(result),
                    },
                )

        if merged:
            traces.append(
                {
                    "step": "fetch_offline_magnet_summary",
                    "status": "success",
                    "message": f"离线磁力资源合计 {len(merged)} 条",
                    "payload": {"total": len(merged)},
                }
            )

        return merged, traces

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
        from app.models.models import MediaStatus

        if not resources:
            return {
                "created_records": [],
                "checked_count": 0,
                "duplicate_count": 0,
                "duplicate_urls": [],
                "invalid_count": 0,
            }

        with db.no_autoflush:
            existing_result = await db.execute(
                select(DownloadRecord.resource_url).where(
                    DownloadRecord.subscription_id == subscription_id
                )
            )
        existing_urls = {str(row[0]) for row in existing_result.all() if row and row[0]}

        offline_enabled = (
            runtime_settings_service.get_subscription_offline_transfer_enabled()
        )
        created_records: list[DownloadRecord] = []
        duplicate_urls: set[str] = set()
        duplicate_count = 0
        invalid_count = 0
        for item in resources:
            resource_url = extract_resource_url(item)
            resource_type = "pan115"
            if not resource_url and offline_enabled:
                resource_url = extract_offline_url(item)
                if resource_url:
                    resource_type = determine_resource_type(resource_url)
            if not resource_url:
                invalid_count += 1
                continue
            if resource_url in existing_urls:
                duplicate_count += 1
                duplicate_urls.add(resource_url)
                continue

            record = DownloadRecord(
                subscription_id=subscription_id,
                resource_name=extract_resource_name(item),
                resource_url=resource_url,
                resource_type=resource_type,
                status=MediaStatus.MATCHED,
            )
            db.add(record)
            existing_urls.add(resource_url)
            created_records.append(record)

        return {
            "created_records": created_records,
            "checked_count": len(resources),
            "duplicate_count": duplicate_count,
            "duplicate_urls": list(duplicate_urls),
            "invalid_count": invalid_count,
        }

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
        merged: dict[str, Any] = {
            "saved": 0,
            "failed": 0,
            "errors": [],
            "subscription_completed": False,
            "cleanup_step": "",
            "cleanup_message": "",
            "cleanup_payload": {},
            "remaining_missing_count": None,
            "link_fallback_rounds": 0,
        }
        pending_records = list(records or [])
        if not pending_records:
            return merged

        last_stats: dict[str, Any] | None = None
        last_attempted_count = 0

        for round_idx in range(MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS):
            if not pending_records:
                break

            last_attempted_count = len(pending_records)
            source_label = (
                transfer_source if round_idx == 0 else f"{transfer_source}_fallback"
            )
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="auto_transfer_batch_start",
                status="info",
                message=(
                    f"开始转存 {last_attempted_count} 个资源"
                    + (f"（补充搜索第 {round_idx} 轮）" if round_idx else "")
                ),
                payload={
                    "transfer_source": source_label,
                    "round": round_idx,
                    "count": last_attempted_count,
                },
            )
            last_stats = await self._auto_save_resources(
                db,
                run_id,
                channel,
                sub,
                pending_records,
                source=source_label,
                tv_missing_snapshot=tv_missing_snapshot,
            )
            merge_auto_save_stats(merged, last_stats)
            merged["link_fallback_rounds"] = round_idx
            pending_records = []

            if not should_continue_link_fallback(
                sub.media_type, last_stats, attempted_count=last_attempted_count
            ):
                break

            if not enable_link_refetch:
                break
            if round_idx + 1 >= MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS:
                await self._create_step_log(
                    db,
                    run_id=run_id,
                    channel=channel,
                    subscription_id=sub.id,
                    subscription_title=sub.title,
                    step="auto_transfer_link_fallback_limit",
                    status="warning",
                    message=(
                        f"已达链接回退上限（{MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS} 轮），"
                        "停止继续搜索"
                    ),
                )
                break

            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="auto_transfer_link_fallback_fetch",
                status="info",
                message="当前链接未转存成功，正在搜索下一条可用资源",
                payload={"round": round_idx + 1},
            )
            exclude_urls = await self._load_subscription_resource_urls(db, sub.id)
            resources, fetch_trace, source_attempt_info = await self._fetch_resources(
                channel,
                sub,
                hdhive_unlock_context,
                source_order=source_order,
                exclude_urls=exclude_urls,
            )
            for trace in fetch_trace:
                await self._create_step_log(
                    db,
                    run_id=run_id,
                    channel=channel,
                    subscription_id=sub.id,
                    subscription_title=sub.title,
                    step=str(trace.get("step") or "fetch_trace"),
                    status=str(trace.get("status") or "info"),
                    message=str(trace.get("message") or ""),
                    payload=trace.get("payload")
                    if isinstance(trace.get("payload"), dict)
                    else None,
                )

            resources = filter_resources_excluding_urls(resources, exclude_urls)
            if not resources:
                await self._create_step_log(
                    db,
                    run_id=run_id,
                    channel=channel,
                    subscription_id=sub.id,
                    subscription_title=sub.title,
                    step="auto_transfer_link_fallback_empty",
                    status="warning",
                    message="未搜索到新的可用链接，停止回退尝试",
                    payload={
                        "round": round_idx + 1,
                        "excluded_url_count": len(exclude_urls),
                        "summary": source_attempt_info.get("summary", ""),
                    },
                )
                break

            store_stats = await self._store_new_resources(db, sub.id, resources)
            pending_records = list(store_stats.get("created_records") or [])
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="auto_transfer_link_fallback_stored",
                status="success" if pending_records else "warning",
                message=(
                    f"补充搜索完成，新增 {len(pending_records)} 条待转存资源"
                    if pending_records
                    else "补充搜索未获得新链接（可能均已尝试过）"
                ),
                payload={
                    "round": round_idx + 1,
                    "new_count": len(pending_records),
                    "fetched_count": len(resources),
                    "summary": source_attempt_info.get("summary", ""),
                },
            )
            if not pending_records:
                break

        return merged

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
        from app.models.models import MediaStatus

        runtime_cookie = runtime_settings_service.get_pan115_cookie()
        pan_service = Pan115Service(runtime_cookie)
        # 订阅自动转存应使用“默认转存文件夹”，而不是离线下载目录。
        default_folder_id = runtime_settings_service.get_pan115_default_folder().get(
            "folder_id", "0"
        )
        parent_folder_id = str(default_folder_id or "0")
        quality_filter = self._resolve_subscription_quality_filter(sub)

        saved = 0
        failed = 0
        errors: list[dict[str, Any]] = []
        subscription_completed = False
        cleanup_step = ""
        cleanup_message = ""
        cleanup_payload: dict[str, Any] = {}

        async def create_tv_missing_step_log(**kwargs: Any) -> None:
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                **kwargs,
            )

        async def fetch_tv_missing_status(**kwargs: Any) -> dict[str, Any]:
            _ = kwargs.pop("tmdb_id", None)
            return await tv_missing_service.get_tv_missing_status(
                sub.tmdb_id,
                **kwargs,
            )

        async def create_auto_transfer_step_log(**kwargs: Any) -> None:
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                **kwargs,
            )

        async def submit_offline_task(url: str, folder_id: str) -> dict[str, Any]:
            return await pan_service.offline_task_add(
                url=url,
                wp_path_id=folder_id,
            )

        def emit_transfer_success(data: dict[str, Any]) -> None:
            from app.analytics import kafka_producer

            if kafka_producer._enabled:
                kafka_producer.send(
                    event_type="transfer_success",
                    data=data,
                    key=str(sub.id),
                )

        def select_precise_missing_episode_files(
            files: list[dict[str, Any]],
            *,
            missing_episodes: set[tuple[int, int]],
            quality_filter: dict[str, Any],
            is_video_file: Callable[[str], bool],
        ) -> Any:
            return select_tv_missing_episode_files(
                files,
                missing_episodes=missing_episodes,
                quality_filter=quality_filter,
                best_picker=pan_service.pick_best_video_file,
                is_video_file=is_video_file,
            )

        tv_missing_context = await build_auto_transfer_tv_missing_context(
            sub=sub,
            tv_missing_snapshot=tv_missing_snapshot,
            fetch_tv_missing_status=fetch_tv_missing_status,
            create_step_log=create_tv_missing_step_log,
        )
        tv_missing_enabled = tv_missing_context.tv_missing_enabled
        missing_episodes = tv_missing_context.missing_episodes
        is_tv_subscription = tv_missing_context.is_tv_subscription

        for record in records:
            await self._create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="auto_transfer_item_start",
                status="info",
                message=f"正在处理资源：{record.resource_name}",
                payload={
                    "source": source,
                    "record_id": record.id,
                    "resource_url": record.resource_url,
                },
            )
            try:
                # 磁力/ED2K 离线下载路径
                if is_offline_transfer_record(record):
                    offline_folder_id = str(
                        runtime_settings_service.get_pan115_offline_folder().get(
                            "folder_id", "0"
                        )
                        or "0"
                    )
                    offline_submission = await submit_offline_transfer_record(
                        sub=sub,
                        record=record,
                        source=source,
                        offline_folder_id=offline_folder_id,
                        downloading_status=MediaStatus.DOWNLOADING,
                        offline_submitted_status=MediaStatus.OFFLINE_SUBMITTED,
                        now=beijing_now,
                        submit_offline_task=submit_offline_task,
                        log_operation=operation_log_service.log_background_event,
                        create_step_log=create_auto_transfer_step_log,
                        emit_transfer_success=emit_transfer_success,
                    )
                    saved += offline_submission.saved_increment
                    if offline_submission.should_stop:
                        break
                    continue

                share_link, receive_code = split_share_link_and_receive_code(
                    record.resource_url
                )
                record.status = MediaStatus.TRANSFERRING
                if tv_missing_enabled and is_tv_subscription:
                    precise_submission = await submit_precise_transfer_record(
                        sub=sub,
                        record=record,
                        source=source,
                        share_link=share_link,
                        receive_code=receive_code,
                        parent_folder_id=parent_folder_id,
                        quality_filter=quality_filter,
                        missing_episodes=missing_episodes,
                        matched_status=MediaStatus.MATCHED,
                        extract_share_code=pan_service._extract_share_code,
                        get_share_all_files_recursive=pan_service.get_share_all_files_recursive,
                        select_missing_episode_files=select_precise_missing_episode_files,
                        save_share_files_directly=pan_service.save_share_files_directly,
                        apply_postprocess_status=self._apply_precise_transfer_postprocess_status,
                        notify_transfer_success=self._notify_transfer_success,
                        log_operation=operation_log_service.log_background_event,
                        create_step_log=create_auto_transfer_step_log,
                        emit_transfer_success=emit_transfer_success,
                        normalize_follow_mode=normalize_tv_follow_mode,
                        has_upcoming_episodes=has_upcoming_episodes_in_subscription_scope,
                        evaluate_cleanup=evaluate_tv_cleanup,
                        is_video_file=is_video_filename,
                        trace_id=run_id,
                    )
                    saved += precise_submission.saved_increment
                    subscription_completed = precise_submission.subscription_completed
                    cleanup_step = precise_submission.cleanup_step
                    cleanup_message = precise_submission.cleanup_message
                    cleanup_payload = precise_submission.cleanup_payload
                    if precise_submission.should_continue:
                        continue
                    if precise_submission.should_stop:
                        break
                else:
                    share_submission = await submit_share_transfer_record(
                        sub=sub,
                        record=record,
                        source=source,
                        share_link=share_link,
                        receive_code=receive_code,
                        parent_folder_id=parent_folder_id,
                        quality_filter=quality_filter,
                        completed_status=MediaStatus.COMPLETED,
                        now=beijing_now,
                        save_share_directly=pan_service.save_share_directly,
                        notify_transfer_success=self._notify_transfer_success,
                        trigger_archive_after_transfer=media_postprocess_service.trigger_archive_after_transfer,
                        log_operation=operation_log_service.log_background_event,
                        create_step_log=create_auto_transfer_step_log,
                        emit_transfer_success=emit_transfer_success,
                        trace_id=run_id,
                    )
                    saved += share_submission.saved_increment
                    subscription_completed = share_submission.subscription_completed
                    cleanup_step = share_submission.cleanup_step
                    cleanup_message = share_submission.cleanup_message
                    cleanup_payload = share_submission.cleanup_payload
                    if share_submission.should_stop:
                        break
            except Exception as exc:
                if is_already_received_error(str(exc)):
                    already_received_result = await handle_already_received_transfer(
                        sub=sub,
                        record=record,
                        source=source,
                        parent_folder_id=parent_folder_id,
                        is_tv_subscription=is_tv_subscription,
                        tv_missing_enabled=tv_missing_enabled,
                        completed_status=MediaStatus.COMPLETED,
                        now=beijing_now,
                        apply_precise_postprocess_status=self._apply_precise_transfer_postprocess_status,
                        notify_transfer_success=self._notify_transfer_success,
                        create_step_log=create_auto_transfer_step_log,
                        log_operation=operation_log_service.log_background_event,
                        trace_id=run_id,
                    )
                    saved += already_received_result.saved_increment
                    subscription_completed = (
                        already_received_result.subscription_completed
                    )
                    cleanup_step = already_received_result.cleanup_step
                    cleanup_message = already_received_result.cleanup_message
                    cleanup_payload = already_received_result.cleanup_payload
                    if already_received_result.should_stop:
                        break
                    if already_received_result.should_continue:
                        continue
                failure_result = await handle_transfer_failure(
                    sub=sub,
                    record=record,
                    source=source,
                    exc=exc,
                    failed_status=MediaStatus.FAILED,
                    create_step_log=create_auto_transfer_step_log,
                    log_operation=operation_log_service.log_background_event,
                    trace_id=run_id,
                )
                failed += failure_result.failed_increment
                errors.append(failure_result.error_entry)

        return {
            "saved": saved,
            "failed": failed,
            "errors": errors,
            "subscription_completed": subscription_completed,
            "cleanup_step": cleanup_step,
            "cleanup_message": cleanup_message,
            "cleanup_payload": cleanup_payload,
            "remaining_missing_count": len(missing_episodes)
            if tv_missing_enabled
            else None,
        }

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
        hdr = runtime_settings_service.get_resource_preferred_hdr()
        codec = runtime_settings_service.get_resource_preferred_codec()
        preferred_formats = (hdr or []) + (codec or [])
        return {
            "preferred_resolutions": runtime_settings_service.get_resource_preferred_resolutions() or None,
            "preferred_formats": preferred_formats or None,
            "exclude_labels": runtime_settings_service.get_resource_exclude_tags() or None,
            "preferred_languages": runtime_settings_service.get_resource_preferred_audio() or None,
            "preferred_subtitles": runtime_settings_service.get_resource_preferred_subtitles() or None,
            "min_size_gb": runtime_settings_service.get_resource_min_size_gb(),
            "max_size_gb": runtime_settings_service.get_resource_max_size_gb(),
        }

    @staticmethod
    async def _notify_transfer_success(
        sub_title: str,
        resource_name: str,
        source: str,
        method: str,
        poster_path: str | None = None,
    ) -> None:
        """订阅任务中网盘转存成功（含已在网盘跳过）时通过 TG Bot 推送。"""
        import logging

        logger = logging.getLogger(__name__)
        try:
            from html import escape
            from app.services.tg_bot.notifications import tg_bot_notify

            lines = [
                "<b>订阅 · 转存成功</b>",
                f"订阅：{escape(sub_title)}",
                f"资源：{escape(resource_name)}",
                f"来源：{escape(source)}　方式：{escape(method)}",
            ]
            await tg_bot_notify("\n".join(lines), poster_path=poster_path)
        except Exception:
            logger.warning("订阅转存 TG 通知发送失败", exc_info=True)

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

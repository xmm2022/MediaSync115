from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    DownloadRecord,
    ExecutionStatus,
)
from app.services.subscriptions.link_fallback_runtime_adapter import (
    auto_save_records_with_link_fallback_with_runtime_adapter,
    build_default_link_fallback_runtime_dependencies,
)
from app.services.subscriptions.auto_transfer_record_loaders_db_adapter import (
    load_force_retry_records_with_db_adapter,
    load_retryable_records_with_db_adapter,
    load_subscription_resource_urls_with_db_adapter,
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
from app.services.subscriptions.run_channel_runtime_adapter import (
    build_default_run_channel_runtime_dependencies,
    run_channel_check_with_runtime_adapter,
)
from app.services.subscriptions.manual_resource_fetch_runtime_adapter import (
    build_default_manual_resource_fetch_runtime_dependencies,
    fetch_resources_for_media_with_runtime_adapter,
)
from app.services.subscriptions.resource_resolver_runtime_adapter import (
    build_default_resource_resolver_runtime_dependencies,
    fetch_subscription_resources_with_runtime_adapter,
)
from app.services.subscriptions.auto_save_resources_runtime_adapter import (
    auto_save_resources_with_runtime_adapter,
    build_default_auto_save_resources_runtime_dependencies,
)
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.feiniu_status_runtime_adapter import (
    check_feiniu_movie_status_with_runtime_adapter,
    check_feiniu_tv_missing_status_with_runtime_adapter,
)
from app.services.subscription_delete_service import subscription_delete_service

logger = logging.getLogger(__name__)

_SUBSCRIPTION_SCAN_CONCURRENCY = 3


class SubscriptionService:
    async def run_channel_check(
        self,
        db: AsyncSession,
        channel: str,
        force_auto_download: bool = False,
        progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        return await run_channel_check_with_runtime_adapter(
            db=db,
            channel=channel,
            force_auto_download=force_auto_download,
            progress_callback=progress_callback,
            concurrency=_SUBSCRIPTION_SCAN_CONCURRENCY,
            dependencies=build_default_run_channel_runtime_dependencies(
                create_execution_log=self._create_execution_log,
                create_step_log=self._create_step_log,
                prune_step_logs=self._prune_step_logs,
                build_hdhive_unlock_context=self._build_hdhive_unlock_context,
                resolve_source_order=self._resolve_source_order,
                evaluate_pre_scan_cleanup=self._evaluate_pre_scan_cleanup,
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
            dependencies=build_default_resource_resolver_runtime_dependencies(),
            hdhive_unlock_context=hdhive_unlock_context,
            source_order=source_order,
            exclude_urls=exclude_urls,
        )

    def _resolve_source_order(self, channel: str) -> list[str]:
        return resolve_source_order_with_runtime_adapter(channel)

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
        return await auto_save_records_with_link_fallback_with_runtime_adapter(
            db=db,
            run_id=run_id,
            channel=channel,
            sub=sub,
            records=records,
            transfer_source=transfer_source,
            dependencies=build_default_link_fallback_runtime_dependencies(),
            tv_missing_snapshot=tv_missing_snapshot,
            hdhive_unlock_context=hdhive_unlock_context,
            source_order=source_order,
            enable_link_refetch=enable_link_refetch,
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
            dependencies=build_default_auto_save_resources_runtime_dependencies(),
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

    def _resolve_subscription_quality_filter(self, sub: "SubscriptionSnapshot") -> dict[str, Any]:
        return resolve_subscription_quality_filter_with_runtime_adapter(sub)

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
        return await fetch_resources_for_media_with_runtime_adapter(
            media_type=media_type,
            tmdb_id=tmdb_id,
            douban_id=douban_id,
            title=title,
            year=year,
            season_number=season_number,
            dependencies=build_default_manual_resource_fetch_runtime_dependencies(
                fetch_resources=self._fetch_resources,
            ),
        )


subscription_service = SubscriptionService()

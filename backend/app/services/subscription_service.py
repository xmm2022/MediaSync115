from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.subscriptions.snapshot import SubscriptionSnapshot
from app.services.subscriptions.completed_cleanup_runtime_adapter import (
    build_default_completed_cleanup_runtime_dependencies,
    cleanup_completed_subscriptions_with_runtime_adapter,
    cleanup_single_subscription_with_runtime_adapter,
)
from app.services.subscriptions.run_channel_runtime_adapter import (
    build_default_run_channel_runtime_dependencies,
    run_channel_check_with_runtime_adapter,
)
from app.services.subscriptions.manual_resource_fetch_runtime_adapter import (
    build_default_manual_resource_fetch_runtime_dependencies,
    fetch_resources_for_media_with_runtime_adapter,
)

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
            dependencies=build_default_run_channel_runtime_dependencies(),
        )

    async def cleanup_completed_subscriptions(
        self, db: AsyncSession
    ) -> dict[str, Any]:
        """离线下载完成后检查并清理已完成的订阅（电影已转存或剧集不缺集）"""
        return await cleanup_completed_subscriptions_with_runtime_adapter(
            db,
            dependencies=build_default_completed_cleanup_runtime_dependencies(),
        )

    async def cleanup_single_subscription(
        self, db: AsyncSession, subscription_id: int
    ) -> dict[str, Any]:
        """检查并清理单个订阅（电影已转存/已在库 或 剧集不缺集）"""
        return await cleanup_single_subscription_with_runtime_adapter(
            db,
            subscription_id,
            dependencies=build_default_completed_cleanup_runtime_dependencies(),
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
        """供手动转存等场景调用的统一资源获取入口，复用资源解析 runtime adapter。"""
        return await fetch_resources_for_media_with_runtime_adapter(
            media_type=media_type,
            tmdb_id=tmdb_id,
            douban_id=douban_id,
            title=title,
            year=year,
            season_number=season_number,
            dependencies=build_default_manual_resource_fetch_runtime_dependencies(),
        )


subscription_service = SubscriptionService()

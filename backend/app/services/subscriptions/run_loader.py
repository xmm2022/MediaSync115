from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select

from app.models.models import DownloadRecord, MediaStatus, Subscription
from app.services.subscriptions.snapshot import SubscriptionSnapshot


def snapshot_from_active_subscription_row(row: Any) -> SubscriptionSnapshot:
    return SubscriptionSnapshot(
        id=int(row.id),
        tmdb_id=int(row.tmdb_id) if row.tmdb_id is not None else None,
        douban_id=str(row.douban_id) if row.douban_id is not None else None,
        title=str(row.title or ""),
        media_type=row.media_type,
        year=str(row.year) if row.year is not None else None,
        auto_download=bool(row.auto_download),
        tv_scope=str(row.tv_scope or "all"),
        tv_season_number=(
            int(row.tv_season_number)
            if row.tv_season_number is not None
            else None
        ),
        tv_episode_start=(
            int(row.tv_episode_start)
            if row.tv_episode_start is not None
            else None
        ),
        tv_episode_end=(
            int(row.tv_episode_end) if row.tv_episode_end is not None else None
        ),
        tv_follow_mode=str(row.tv_follow_mode or "missing"),
        tv_include_specials=bool(row.tv_include_specials),
        has_successful_transfer=bool(row.has_successful_transfer),
    )


async def load_active_subscription_snapshots(db: Any) -> list[SubscriptionSnapshot]:
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
    result = await db.execute(
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
    return [snapshot_from_active_subscription_row(row) for row in result.all()]

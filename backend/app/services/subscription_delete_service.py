from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    DownloadRecord,
    MoviePilotCompletionRecord,
    Subscription,
    SubscriptionSource,
    SubscriptionSourceFile,
)


class SubscriptionDeleteService:
    async def delete_local_subscriptions(
        self,
        db: AsyncSession,
        subscription_ids: Iterable[int],
    ) -> int:
        ids = sorted({int(item) for item in subscription_ids if item is not None})
        if not ids:
            return 0

        source_ids_result = await db.execute(
            select(SubscriptionSource.id).where(SubscriptionSource.subscription_id.in_(ids))
        )
        source_ids = list(source_ids_result.scalars().all())
        if source_ids:
            await db.execute(
                delete(SubscriptionSourceFile).where(
                    SubscriptionSourceFile.source_id.in_(source_ids)
                )
            )

        await db.execute(
            delete(SubscriptionSource).where(SubscriptionSource.subscription_id.in_(ids))
        )
        await db.execute(
            delete(DownloadRecord).where(DownloadRecord.subscription_id.in_(ids))
        )
        await db.execute(
            delete(MoviePilotCompletionRecord).where(
                MoviePilotCompletionRecord.subscription_id.in_(ids)
            )
        )
        await db.execute(delete(Subscription).where(Subscription.id.in_(ids)))
        return len(ids)


async def delete_subscription_with_records_with_default_service(
    db: AsyncSession,
    subscription_id: int,
) -> int:
    return await subscription_delete_service.delete_local_subscriptions(
        db,
        [subscription_id],
    )


subscription_delete_service = SubscriptionDeleteService()

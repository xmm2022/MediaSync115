import pytest
from sqlalchemy import delete


@pytest.mark.asyncio
async def test_subscription_check_does_not_scan_manual_missing_sources(monkeypatch):
    """115 分享补缺源不参与订阅追新检查，只能由补缺入口手动扫描。"""
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.models.models import MediaType, Subscription, SubscriptionSource
    from app.services.subscription_service import SubscriptionService
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist(
        "subscriptions",
        "subscription_sources",
        "download_records",
        "subscription_step_logs",
        "subscription_execution_logs",
        "operation_logs",
    )

    tmdb_id = 900991
    async with async_session_maker() as db:
        await db.execute(
            delete(SubscriptionSource).where(
                SubscriptionSource.share_url.like("%autoscan-guard%")
            )
        )
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == tmdb_id))
        sub = Subscription(
            title="Auto Source Guard",
            media_type=MediaType.TV,
            tmdb_id=tmdb_id,
            is_active=True,
            auto_download=True,
            tv_follow_mode="new",
            provider="mediasync115",
            external_system="mediasync115",
        )
        db.add(sub)
        await db.flush()
        db.add(
            SubscriptionSource(
                subscription_id=sub.id,
                source_type="manual_pan115_share",
                display_name="autoscan-guard",
                share_url="https://115.com/s/autoscan-guard",
                enabled=True,
            )
        )
        await db.commit()

    service = SubscriptionService()

    async def fake_cleanup(*_args, **_kwargs):
        return {}

    async def fake_fetch_resources(*_args, **_kwargs):
        return [], [], {"summary": "no resources", "source_order": [], "attempts": []}

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("manual missing source scan must not run during subscription check")

    monkeypatch.setattr(service, "_evaluate_pre_scan_cleanup", fake_cleanup)
    monkeypatch.setattr(service, "_fetch_resources", fake_fetch_resources)
    monkeypatch.setattr(
        subscription_source_service,
        "scan_manual_pan115_source",
        fail_if_called,
    )

    async with async_session_maker() as db:
        result = await service.run_channel_check(db, "all", force_auto_download=True)

    assert result["checked_count"] >= 1
    assert result["failed_count"] == 0

    async with async_session_maker() as db:
        await db.execute(
            delete(SubscriptionSource).where(
                SubscriptionSource.share_url.like("%autoscan-guard%")
            )
        )
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == tmdb_id))
        await db.commit()

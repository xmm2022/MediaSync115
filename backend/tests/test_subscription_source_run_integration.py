import pytest
from sqlalchemy import delete


@pytest.mark.asyncio
async def test_subscription_check_scans_enabled_manual_pan115_sources(monkeypatch):
    """subscription.check 会额外扫描启用的固定 115 来源。"""
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.models.models import MediaType, Subscription, SubscriptionSource
    from app.services.subscription_service import SubscriptionService
    from app.services.subscription_source_service import subscription_source_service
    from app.services.subscriptions import (
        fixed_source_scan_runtime_adapter as fixed_source_runtime_module,
        run_channel_runtime_adapter as run_channel_runtime_module,
    )

    await ensure_tables_exist(
        "subscriptions",
        "subscription_sources",
        "download_records",
        "subscription_step_logs",
        "subscription_execution_logs",
        "operation_logs",
    )

    tmdb_id = 900991
    source_id = 0
    sub_id = 0
    async with async_session_maker() as db:
        await db.execute(
            delete(SubscriptionSource).where(
                SubscriptionSource.share_url.like("%autoscan-enabled%")
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
        source = SubscriptionSource(
            subscription_id=sub.id,
            source_type="manual_pan115_share",
            display_name="autoscan-enabled",
            share_url="https://115.com/s/autoscan-enabled",
            enabled=True,
        )
        db.add(source)
        await db.flush()
        sub_id = int(sub.id)
        source_id = int(source.id)
        await db.commit()

    service = SubscriptionService()
    scan_calls = []
    fetch_calls = []

    async def fake_cleanup(*_args, **_kwargs):
        sub = _kwargs.get("sub")
        if sub is None or sub.id != sub_id:
            return {"deleted": True}
        return {
            "deleted": False,
            "tv_missing_snapshot": {
                "status": "ok",
                "counts": {"aired": 2, "existing": 1, "missing": 1},
                "missing_episodes": [[1, 2]],
            },
        }

    async def fake_fetch_resources(*_args, **_kwargs):
        fetch_calls.append({"args": _args, "kwargs": _kwargs})
        return [], [], {"summary": "no resources", "source_order": [], "attempts": []}

    async def fake_scan_manual_pan115_source(
        db,
        *,
        source,
        subscription,
        pan_service,
        parent_folder_id,
        missing_episodes,
        quality_filter,
    ):
        if source.id != source_id:
            return {"status": "success", "selected_count": 0, "transferred_count": 0}
        scan_calls.append(source.id)
        assert subscription.id == sub_id
        assert source.source_type == "manual_pan115_share"
        assert parent_folder_id == "fixed-source-target"
        assert missing_episodes == {(1, 2)}
        assert isinstance(quality_filter, dict)
        return {"status": "success", "selected_count": 2, "transferred_count": 2}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        lambda *_args: fake_cleanup,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "fetch_resources_with_default_runtime_dependencies",
        fake_fetch_resources,
    )
    monkeypatch.setattr(
        fixed_source_runtime_module.runtime_settings_service,
        "get_pan115_cookie",
        lambda: "cookie",
    )
    monkeypatch.setattr(
        fixed_source_runtime_module.runtime_settings_service,
        "get_pan115_default_folder",
        lambda: {"folder_id": "fixed-source-target"},
    )
    monkeypatch.setattr(
        subscription_source_service,
        "scan_manual_pan115_source",
        fake_scan_manual_pan115_source,
    )

    try:
        async with async_session_maker() as db:
            result = await service.run_channel_check(db, "all")

        assert scan_calls == [source_id]
        assert len(fetch_calls) == 1
        assert fetch_calls[0]["args"][0] == "all"
        assert fetch_calls[0]["args"][1].id == sub_id
        assert isinstance(fetch_calls[0]["kwargs"].get("source_order"), list)
        assert result["checked_count"] >= 1
        assert result["failed_count"] == 0
        assert result["auto_saved_count"] == 2
        assert result["auto_failed_count"] == 0
    finally:
        async with async_session_maker() as db:
            await db.execute(
                delete(SubscriptionSource).where(
                    SubscriptionSource.share_url.like("%autoscan-enabled%")
                )
            )
            await db.execute(delete(Subscription).where(Subscription.tmdb_id == tmdb_id))
            await db.commit()


@pytest.mark.asyncio
async def test_subscription_check_skips_manual_pan115_source_without_auto_download(
    monkeypatch,
):
    """未开启自动转存时，固定 115 来源不会被定时任务直接转存。"""
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.models.models import MediaType, Subscription, SubscriptionSource
    from app.services.subscription_service import SubscriptionService
    from app.services.subscription_source_service import subscription_source_service
    from app.services.subscriptions import (
        run_channel_runtime_adapter as run_channel_runtime_module,
    )

    await ensure_tables_exist(
        "subscriptions",
        "subscription_sources",
        "download_records",
        "subscription_step_logs",
        "subscription_execution_logs",
        "operation_logs",
    )

    tmdb_id = 900992
    sub_id = 0
    async with async_session_maker() as db:
        await db.execute(
            delete(SubscriptionSource).where(
                SubscriptionSource.share_url.like("%autoscan-disabled%")
            )
        )
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == tmdb_id))
        sub = Subscription(
            title="Auto Source Disabled",
            media_type=MediaType.TV,
            tmdb_id=tmdb_id,
            is_active=True,
            auto_download=False,
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
                display_name="autoscan-disabled",
                share_url="https://115.com/s/autoscan-disabled",
                enabled=True,
            )
        )
        sub_id = int(sub.id)
        await db.commit()

    service = SubscriptionService()
    fetch_calls = []

    async def fake_cleanup(*_args, **_kwargs):
        sub = _kwargs.get("sub")
        if sub is None or sub.id != sub_id:
            return {"deleted": True}
        return {
            "deleted": False,
            "tv_missing_snapshot": {
                "status": "ok",
                "counts": {"aired": 2, "existing": 1, "missing": 1},
                "missing_episodes": [[1, 2]],
            },
        }

    async def fake_fetch_resources(*_args, **_kwargs):
        fetch_calls.append({"args": _args, "kwargs": _kwargs})
        return [], [], {"summary": "no resources", "source_order": [], "attempts": []}

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("fixed source scan requires auto_download or force mode")

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        lambda *_args: fake_cleanup,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "fetch_resources_with_default_runtime_dependencies",
        fake_fetch_resources,
    )
    monkeypatch.setattr(
        subscription_source_service,
        "scan_manual_pan115_source",
        fail_if_called,
    )

    try:
        async with async_session_maker() as db:
            result = await service.run_channel_check(db, "all")

        assert result["checked_count"] >= 1
        assert result["failed_count"] == 0
        assert result["auto_saved_count"] == 0
        assert result["auto_failed_count"] == 0
        assert len(fetch_calls) == 1
        assert fetch_calls[0]["args"][0] == "all"
        assert fetch_calls[0]["args"][1].id == sub_id
        assert isinstance(fetch_calls[0]["kwargs"].get("source_order"), list)
    finally:
        async with async_session_maker() as db:
            await db.execute(
                delete(SubscriptionSource).where(
                    SubscriptionSource.share_url.like("%autoscan-disabled%")
                )
            )
            await db.execute(delete(Subscription).where(Subscription.tmdb_id == tmdb_id))
            await db.commit()

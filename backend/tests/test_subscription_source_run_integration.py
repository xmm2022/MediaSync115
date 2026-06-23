import pytest


@pytest.mark.asyncio
async def test_run_scans_manual_sources_only_when_auto_download_enabled(monkeypatch):
    from app.models.models import MediaType
    from app.services.subscription_service import (
        SubscriptionService,
        SubscriptionSnapshot,
    )

    service = SubscriptionService()
    sub = SubscriptionSnapshot(
        id=1,
        tmdb_id=100,
        douban_id=None,
        title="Show",
        media_type=MediaType.TV,
        year="2026",
        auto_download=False,
        tv_scope="all",
        tv_season_number=None,
        tv_episode_start=None,
        tv_episode_end=None,
        tv_follow_mode="new",
        tv_include_specials=False,
        has_successful_transfer=False,
    )

    called = False

    async def fake_scan(*args, **kwargs):
        nonlocal called
        called = True
        return {"saved": 1, "failed": 0}

    monkeypatch.setattr(service, "_scan_fixed_sources_for_subscription", fake_scan)

    assert service._should_scan_fixed_sources(sub, force_auto_download=False) is False
    assert service._should_scan_fixed_sources(sub, force_auto_download=True) is True
    assert called is False

import pytest
from sqlalchemy import select

from app.models.models import MediaType, Subscription
from app.services.chart_subscription_service import (
    _create_subscription_if_not_exists,
    load_existing_subscription_keys,
)
from app.services.subscription_delete_service import subscription_delete_service


@pytest.mark.asyncio
async def test_chart_existing_keys_ignore_external_subscription_mirrors() -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    tmdb_id = 920001
    await ensure_tables_exist()
    async with async_session_maker() as db:
        existing_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id == tmdb_id)
                )
            ).all()
        ]
        await subscription_delete_service.delete_local_subscriptions(db, existing_ids)
        db.add_all(
            [
                Subscription(
                    tmdb_id=tmdb_id,
                    title="Provider Scope MoviePilot",
                    media_type=MediaType.MOVIE,
                    provider="moviepilot",
                    external_system="moviepilot",
                    external_subscription_id="mp-provider-scope",
                    auto_download=True,
                ),
                Subscription(
                    tmdb_id=tmdb_id,
                    title="Provider Scope Anime",
                    media_type=MediaType.MOVIE,
                    provider="anirss",
                    external_system="anirss",
                    external_subscription_id="ani-provider-scope",
                    auto_download=False,
                ),
            ]
        )
        await db.commit()

    keys = await load_existing_subscription_keys([(tmdb_id, MediaType.MOVIE)])
    assert keys == set()

    created = await _create_subscription_if_not_exists(
        tmdb_id=tmdb_id,
        media_type=MediaType.MOVIE,
        title="Provider Scope Local",
        year="2026",
        rating=None,
        overview="",
        poster_path=None,
        douban_id=None,
    )
    assert created is True

    keys = await load_existing_subscription_keys([(tmdb_id, MediaType.MOVIE)])
    assert keys == {(tmdb_id, MediaType.MOVIE)}

    duplicate = await _create_subscription_if_not_exists(
        tmdb_id=tmdb_id,
        media_type=MediaType.MOVIE,
        title="Provider Scope Local Again",
        year="2026",
        rating=None,
        overview="",
        poster_path=None,
        douban_id=None,
    )
    assert duplicate is False

    async with async_session_maker() as db:
        cleanup_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id == tmdb_id)
                )
            ).all()
        ]
        await subscription_delete_service.delete_local_subscriptions(db, cleanup_ids)
        await db.commit()

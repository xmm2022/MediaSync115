import pytest
from sqlalchemy import delete, func, select

from app.models.models import (
    DownloadRecord,
    MediaStatus,
    MediaType,
    MoviePilotCompletionRecord,
    Subscription,
    SubscriptionSource,
    SubscriptionSourceFile,
)
from app.services.subscription_delete_service import subscription_delete_service


async def _count(db, model, *where_clauses) -> int:
    query = select(func.count()).select_from(model)
    if where_clauses:
        query = query.where(*where_clauses)
    return int((await db.execute(query)).scalar_one())


@pytest.mark.asyncio
async def test_delete_local_subscriptions_removes_child_rows() -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    await ensure_tables_exist()
    async with async_session_maker() as db:
        existing_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id == 910001)
                )
            ).all()
        ]
        await subscription_delete_service.delete_local_subscriptions(db, existing_ids)
        await db.commit()

        sub = Subscription(
            tmdb_id=910001,
            title="Delete Service Show",
            media_type=MediaType.TV,
            provider="mediasync115",
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)

        download = DownloadRecord(
            subscription_id=sub.id,
            resource_name="Delete.Service.Show.S01E01.mkv",
            resource_url="https://115.com/s/delete-service",
            resource_type="pan115",
            status=MediaStatus.MATCHED,
        )
        source = SubscriptionSource(
            subscription_id=sub.id,
            share_url="https://115.com/s/delete-service",
            receive_code="abcd",
            display_name="Delete Service Source",
        )
        completion = MoviePilotCompletionRecord(
            subscription_id=sub.id,
            tmdb_id=910001,
            season_number=1,
            episode_number=1,
            resource_hash="delete-service-hash",
            status="matched",
        )
        db.add_all([download, source, completion])
        await db.commit()
        await db.refresh(download)
        await db.refresh(source)

        source_file = SubscriptionSourceFile(
            source_id=source.id,
            share_file_id="fid-delete",
            file_name="Delete.Service.Show.S01E01.mkv",
            fingerprint="delete-service-fingerprint",
            download_record_id=download.id,
        )
        db.add(source_file)
        await db.commit()

        deleted_count = await subscription_delete_service.delete_local_subscriptions(
            db,
            [sub.id],
        )
        await db.commit()

        assert deleted_count == 1
        assert await _count(db, Subscription, Subscription.id == sub.id) == 0
        assert (
            await _count(db, DownloadRecord, DownloadRecord.subscription_id == sub.id)
            == 0
        )
        assert (
            await _count(
                db,
                MoviePilotCompletionRecord,
                MoviePilotCompletionRecord.subscription_id == sub.id,
            )
            == 0
        )
        assert (
            await _count(
                db,
                SubscriptionSource,
                SubscriptionSource.subscription_id == sub.id,
            )
            == 0
        )
        assert (
            await _count(
                db,
                SubscriptionSourceFile,
                SubscriptionSourceFile.fingerprint == "delete-service-fingerprint",
            )
            == 0
        )


@pytest.mark.asyncio
async def test_batch_delete_filter_excludes_external_mirrors() -> None:
    from app.api.subscriptions import _exclude_external_mirrors_clause
    from app.core.database import async_session_maker, ensure_tables_exist

    tmdb_ids = [910011, 910012, 910013]
    await ensure_tables_exist()
    async with async_session_maker() as db:
        existing_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id.in_(tmdb_ids))
                )
            ).all()
        ]
        await subscription_delete_service.delete_local_subscriptions(db, existing_ids)
        await db.commit()

        db.add_all(
            [
                Subscription(
                    tmdb_id=910011,
                    title="Local Movie",
                    media_type=MediaType.MOVIE,
                    provider="mediasync115",
                    auto_download=True,
                ),
                Subscription(
                    tmdb_id=910012,
                    title="MoviePilot Movie",
                    media_type=MediaType.MOVIE,
                    provider="moviepilot",
                    external_system="moviepilot",
                    external_subscription_id="mp-910012",
                    auto_download=True,
                ),
                Subscription(
                    tmdb_id=910013,
                    title="Anime Movie",
                    media_type=MediaType.MOVIE,
                    provider="anirss",
                    external_system="anirss",
                    external_subscription_id="ani-910013",
                    auto_download=False,
                ),
            ]
        )
        await db.commit()

        result = await db.execute(
            select(Subscription.tmdb_id).where(
                Subscription.media_type == MediaType.MOVIE,
                Subscription.tmdb_id.in_(tmdb_ids),
                _exclude_external_mirrors_clause(),
            )
        )
        selected_tmdb_ids = {int(row[0]) for row in result.all()}

        assert selected_tmdb_ids == {910011}

        cleanup_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id.in_(tmdb_ids))
                )
            ).all()
        ]
        await subscription_delete_service.delete_local_subscriptions(db, cleanup_ids)
        await db.commit()


@pytest.mark.asyncio
async def test_toggle_cancel_uses_local_subscription_delete_service(async_client) -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    await ensure_tables_exist()
    async with async_session_maker() as db:
        existing_ids = [
            int(row[0])
            for row in (
                await db.execute(
                    select(Subscription.id).where(Subscription.tmdb_id == 910021)
                )
            ).all()
        ]
        await subscription_delete_service.delete_local_subscriptions(db, existing_ids)
        await db.commit()

        sub = Subscription(
            tmdb_id=910021,
            title="Toggle Delete Show",
            media_type=MediaType.TV,
            provider="mediasync115",
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)

        download = DownloadRecord(
            subscription_id=sub.id,
            resource_name="Toggle.Delete.Show.S01E01.mkv",
            resource_url="https://115.com/s/toggle-delete",
            resource_type="pan115",
            status=MediaStatus.MATCHED,
        )
        source = SubscriptionSource(
            subscription_id=sub.id,
            share_url="https://115.com/s/toggle-delete",
            receive_code="abcd",
            display_name="Toggle Delete Source",
        )
        completion = MoviePilotCompletionRecord(
            subscription_id=sub.id,
            tmdb_id=910021,
            season_number=1,
            episode_number=1,
            resource_hash="toggle-delete-hash",
            status="matched",
        )
        db.add_all([download, source, completion])
        await db.commit()
        await db.refresh(download)
        await db.refresh(source)

        source_file = SubscriptionSourceFile(
            source_id=source.id,
            share_file_id="toggle-fid",
            file_name="Toggle.Delete.Show.S01E01.mkv",
            fingerprint="toggle-delete-fingerprint",
            download_record_id=download.id,
        )
        db.add(source_file)
        await db.commit()
        sub_id = int(sub.id)

    login_response = await async_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert login_response.status_code == 200

    response = await async_client.post(
        "/api/subscriptions/toggle",
        json={
            "tmdb_id": 910021,
            "title": "Toggle Delete Show",
            "media_type": "tv",
        },
    )
    assert response.status_code == 200
    assert response.json()["subscribed"] is False

    async with async_session_maker() as db:
        assert await _count(db, Subscription, Subscription.id == sub_id) == 0
        assert (
            await _count(db, DownloadRecord, DownloadRecord.subscription_id == sub_id)
            == 0
        )
        assert (
            await _count(
                db,
                MoviePilotCompletionRecord,
                MoviePilotCompletionRecord.subscription_id == sub_id,
            )
            == 0
        )
        assert (
            await _count(
                db,
                SubscriptionSource,
                SubscriptionSource.subscription_id == sub_id,
            )
            == 0
        )
        assert (
            await _count(
                db,
                SubscriptionSourceFile,
                SubscriptionSourceFile.fingerprint == "toggle-delete-fingerprint",
            )
            == 0
        )

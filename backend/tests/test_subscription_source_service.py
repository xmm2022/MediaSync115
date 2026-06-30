import pytest
from sqlalchemy import delete, select

from app.models.models import MediaType, Subscription, SubscriptionSource


@pytest.mark.asyncio
async def test_create_manual_source_allows_movie_subscription(tmp_path):
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        await db.execute(delete(SubscriptionSource).where(SubscriptionSource.share_url.like("%abc123%")))
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 1001))
        await db.commit()
        movie = Subscription(
            tmdb_id=1001,
            title="Movie",
            media_type=MediaType.MOVIE,
            auto_download=True,
        )
        db.add(movie)
        await db.commit()
        await db.refresh(movie)

        source = await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=movie.id,
            share_url="https://115.com/s/abc123?password=abcd",
            receive_code="",
            display_name="Manual Movie",
        )

        assert source.subscription_id == movie.id
        assert source.display_name == "Manual Movie"


@pytest.mark.asyncio
async def test_create_manual_source_stores_receive_code_from_link():
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        await db.execute(delete(SubscriptionSource).where(SubscriptionSource.share_url.like("%abc123%")))
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 2002))
        await db.commit()
        sub = Subscription(
            tmdb_id=2002,
            title="Show",
            media_type=MediaType.TV,
            auto_download=True,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)

        source = await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=sub.id,
            share_url="https://115.com/s/abc123?password=abcd",
            receive_code="",
            display_name="Manual",
        )
        await db.commit()

        assert source.source_type == "manual_pan115_share"
        assert source.share_url == "https://115.com/s/abc123?password=abcd"
        assert source.receive_code == "abcd"
        assert source.enabled is True
        assert source.last_scan_status == "never"


@pytest.mark.asyncio
async def test_scan_manual_movie_source_transfers_best_video():
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.models.models import SubscriptionSourceFile
    from app.services.subscription_source_service import subscription_source_service

    class FakePanService:
        saved_file_ids: list[str] = []

        def _extract_share_code(self, share_url: str) -> str:
            return "abc123"

        async def get_share_all_files_recursive(self, share_code: str, receive_code: str):
            return [
                {"fid": "low", "name": "Movie.2026.720p.mkv", "size": 100},
                {"fid": "high", "name": "Movie.2026.2160p.mkv", "size": 400},
                {"fid": "txt", "name": "readme.txt", "size": 1},
            ]

        def _select_files_for_best_quality_transfer(self, files, quality_filter=None):
            return [files[1]]

        async def save_share_files_directly(self, *, share_url, file_ids, parent_id, receive_code):
            self.saved_file_ids = list(file_ids)
            return {"success": True}

    await ensure_tables_exist()
    async with async_session_maker() as db:
        await db.execute(delete(SubscriptionSource).where(SubscriptionSource.share_url.like("%abc123%")))
        await db.execute(delete(Subscription).where(Subscription.tmdb_id == 2001))
        await db.commit()
        movie = Subscription(
            tmdb_id=2001,
            title="Movie Source",
            media_type=MediaType.MOVIE,
            auto_download=True,
        )
        db.add(movie)
        await db.commit()
        await db.refresh(movie)

        source = await subscription_source_service.create_manual_pan115_source(
            db,
            subscription_id=movie.id,
            share_url="https://115.com/s/abc123?password=abcd",
            receive_code="",
            display_name="Movie Source",
        )
        pan_service = FakePanService()

        result = await subscription_source_service.scan_manual_pan115_source(
            db,
            source=source,
            subscription=movie,
            pan_service=pan_service,
            parent_folder_id="0",
            missing_episodes=set(),
            quality_filter={},
        )
        await db.commit()

        assert result["transferred_count"] == 1
        assert pan_service.saved_file_ids == ["high"]
        rows = (
            (
                await db.execute(
                    select(SubscriptionSourceFile).where(
                        SubscriptionSourceFile.source_id == source.id
                    )
                )
            )
            .scalars()
            .all()
        )
        statuses = {row.status for row in rows}
        assert "transferred" in statuses

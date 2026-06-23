import pytest

from app.models.models import MediaType, Subscription


@pytest.mark.asyncio
async def test_create_manual_source_requires_tv_subscription(tmp_path):
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
        movie = Subscription(
            tmdb_id=1001,
            title="Movie",
            media_type=MediaType.MOVIE,
            auto_download=True,
        )
        db.add(movie)
        await db.commit()
        await db.refresh(movie)

        with pytest.raises(ValueError, match="仅支持电视剧订阅"):
            await subscription_source_service.create_manual_pan115_source(
                db,
                subscription_id=movie.id,
                share_url="https://115.com/s/abc123?password=abcd",
                receive_code="",
                display_name="Manual",
            )


@pytest.mark.asyncio
async def test_create_manual_source_stores_receive_code_from_link():
    from app.core.database import async_session_maker, ensure_tables_exist
    from app.services.subscription_source_service import subscription_source_service

    await ensure_tables_exist()
    async with async_session_maker() as db:
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

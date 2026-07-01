import pytest
from sqlalchemy import delete, select

from app.models.watchlist import Watchlist, WatchlistItem
from app.services.watchlist_service import run_auto_fill_watchlists


async def _cleanup_watchlists(db, names: list[str]) -> None:
    result = await db.execute(select(Watchlist.id).where(Watchlist.name.in_(names)))
    watchlist_ids = [int(row[0]) for row in result.all()]
    if watchlist_ids:
        await db.execute(
            delete(WatchlistItem).where(WatchlistItem.watchlist_id.in_(watchlist_ids))
        )
        await db.execute(delete(Watchlist).where(Watchlist.id.in_(watchlist_ids)))
        await db.commit()


@pytest.mark.asyncio
async def test_run_auto_fill_watchlists_reads_enabled_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    names = ["Auto Fill Enabled Watchlist", "Auto Fill Disabled Watchlist"]
    created_items: list[tuple[int, str]] = []

    async def fake_create_subscription_if_not_exists(**kwargs):
        created_items.append((int(kwargs["tmdb_id"]), str(kwargs["title"])))
        return True

    monkeypatch.setattr(
        "app.services.watchlist_service._create_subscription_if_not_exists",
        fake_create_subscription_if_not_exists,
    )

    await ensure_tables_exist()
    async with async_session_maker() as db:
        await _cleanup_watchlists(db, names)

        enabled = Watchlist(name=names[0], auto_fill_enabled=True)
        disabled = Watchlist(name=names[1], auto_fill_enabled=False)
        db.add_all([enabled, disabled])
        await db.commit()
        await db.refresh(enabled)
        await db.refresh(disabled)

        db.add_all(
            [
                WatchlistItem(
                    watchlist_id=enabled.id,
                    tmdb_id=940501,
                    media_type="movie",
                    title="Enabled Movie",
                ),
                WatchlistItem(
                    watchlist_id=disabled.id,
                    tmdb_id=940502,
                    media_type="movie",
                    title="Disabled Movie",
                ),
            ]
        )
        await db.commit()

    result = await run_auto_fill_watchlists()

    assert result["watchlists_processed"] == 1
    assert result["total_new"] == 1
    assert result["total_failed"] == 0
    assert created_items == [(940501, "Enabled Movie")]

    async with async_session_maker() as db:
        await _cleanup_watchlists(db, names)

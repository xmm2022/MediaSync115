import asyncio

import pytest

from app.services.seedhub_task_service import SeedhubTaskService


@pytest.mark.asyncio
async def test_seedhub_task_stops_resolving_after_limit(monkeypatch):
    service = SeedhubTaskService()
    resolved_seed_ids: list[str] = []

    async def fake_search_movie_ids(keyword, limit=1, expected_context=None):
        return ["movie-1"]

    async def fake_fetch_seed_entries(movie_id):
        return [
            {
                "seed_id": str(index),
                "title": f"资源 {index}",
                "size": "1 GB",
                "updated_at": "2026-06-27",
            }
            for index in range(10)
        ]

    async def fake_resolve_magnet_cached(seed_id):
        resolved_seed_ids.append(seed_id)
        await asyncio.sleep(0.02)
        return f"magnet:?xt=urn:btih:{seed_id}"

    monkeypatch.setattr(
        "app.services.seedhub_task_service.seedhub_service._search_movie_ids",
        fake_search_movie_ids,
    )
    monkeypatch.setattr(
        "app.services.seedhub_task_service.seedhub_service._fetch_seed_entries",
        fake_fetch_seed_entries,
    )
    service._resolve_magnet_cached = fake_resolve_magnet_cached  # type: ignore[method-assign]

    task = await service.start(
        media_type="movie",
        tmdb_id=603,
        keyword_candidates=["The Matrix"],
        limit=3,
    )

    for _ in range(50):
        latest = await service.get(task["task_id"])
        if latest and latest["status"] in {"success", "partial_success", "failed"}:
            break
        await asyncio.sleep(0.01)

    latest = await service.get(task["task_id"])
    assert latest is not None
    assert latest["status"] == "success"
    assert [item["seed_id"] for item in latest["items"]] == ["0", "1", "2"]
    assert resolved_seed_ids == ["0", "1", "2"]

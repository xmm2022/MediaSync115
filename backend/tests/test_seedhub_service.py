import pytest

from app.services.seedhub_service import SeedHubService


@pytest.mark.asyncio
async def test_resolve_entry_batch_stops_after_requested_results():
    service = SeedHubService()
    resolved_seed_ids: list[str] = []

    async def fake_resolve_magnet(seed_id: str, client=None) -> str:
        resolved_seed_ids.append(seed_id)
        return f"magnet:?xt=urn:btih:{seed_id}"

    service._resolve_magnet = fake_resolve_magnet  # type: ignore[method-assign]
    entries = [
        (
            "movie-1",
            {
                "seed_id": str(index),
                "title": f"资源 {index}",
                "size": "1 GB",
                "updated_at": "2026-06-27",
            },
        )
        for index in range(10)
    ]

    result = await service._resolve_entry_batch(
        entries,
        client=None,  # fake resolver does not use the HTTP client
        max_results=3,
        concurrency=8,
    )

    assert [item["seed_id"] for item in result] == ["0", "1", "2"]
    assert resolved_seed_ids == ["0", "1", "2"]

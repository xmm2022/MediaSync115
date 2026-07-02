from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services import explore_action_queue_service as explore_queue_module
from app.services.explore_action_queue_service import ExploreActionQueueService


ROOT = Path(__file__).resolve().parents[2]
EXPLORE_QUEUE = ROOT / "backend/app/services/explore_action_queue_service.py"


def test_explore_save_uses_subscription_resource_helpers_not_service_private_methods() -> None:
    source = EXPLORE_QUEUE.read_text(encoding="utf-8")

    for name in (
        "subscription_service._fetch_resources",
        "subscription_service._extract_resource_url",
        "subscription_service._extract_offline_url",
    ):
        assert name not in source

    for name in (
        "fetch_subscription_resources_with_runtime_adapter",
        "build_default_resource_resolver_runtime_dependencies",
        "resolve_source_order_with_runtime_adapter",
        "extract_resource_url",
        "extract_offline_url",
    ):
        assert name in source


@pytest.mark.asyncio
async def test_explore_save_direct_transfer_uses_resource_resolver_runtime_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ExploreActionQueueService()
    dependencies_marker = object()
    events: list[tuple[str, Any]] = []
    resource = {
        "source_service": "hdhive",
        "name": "Example Movie",
        "share_link": "https://115.com/s/direct?password=abcd",
    }

    monkeypatch.setattr(
        explore_queue_module,
        "resolve_source_order_with_runtime_adapter",
        lambda channel: events.append(("source_order", channel)) or ["hdhive"],
    )
    monkeypatch.setattr(
        explore_queue_module,
        "build_default_resource_resolver_runtime_dependencies",
        lambda: events.append(("build_dependencies", None)) or dependencies_marker,
    )

    async def fake_fetch_subscription_resources_with_runtime_adapter(**kwargs: Any):
        events.append(("fetch", kwargs))
        return [resource], [], {
            "attempts": [{"source": "hdhive", "status": "success"}]
        }

    monkeypatch.setattr(
        explore_queue_module,
        "fetch_subscription_resources_with_runtime_adapter",
        fake_fetch_subscription_resources_with_runtime_adapter,
    )
    monkeypatch.setattr(
        explore_queue_module,
        "extract_resource_url",
        lambda item: events.append(("extract_resource_url", item))
        or str(item["share_link"]),
    )
    monkeypatch.setattr(
        explore_queue_module,
        "extract_offline_url",
        lambda item: events.append(("extract_offline_url", item)) or "",
    )
    monkeypatch.setattr(
        explore_queue_module.runtime_settings_service,
        "get_pan115_default_folder",
        lambda: {"folder_id": "direct-folder"},
    )

    async def fake_save_share_directly(
        share_link: str,
        folder_id: str,
        receive_code: str,
        quality_filter: dict[str, Any],
    ) -> dict[str, Any]:
        events.append(
            (
                "save_share_directly",
                {
                    "share_link": share_link,
                    "folder_id": folder_id,
                    "receive_code": receive_code,
                    "quality_filter": quality_filter,
                },
            )
        )
        return {"success": True, "file_count": 1, "message": "saved"}

    monkeypatch.setattr(
        explore_queue_module.pan115_service,
        "save_share_directly",
        fake_save_share_directly,
    )

    async def fake_trigger_archive_after_transfer(**kwargs: Any) -> None:
        events.append(("postprocess", kwargs))

    monkeypatch.setattr(
        explore_queue_module.media_postprocess_service,
        "trigger_archive_after_transfer",
        fake_trigger_archive_after_transfer,
    )

    from app.utils import resource_tags

    monkeypatch.setattr(
        resource_tags,
        "build_quality_filter_from_settings",
        lambda: {"quality": "filter"},
    )

    result = await service._execute_save(
        {
            "payload": {
                "source": "tmdb",
                "media_type": "movie",
                "tmdb_id": 321,
                "title": "Example Movie",
                "year": "2026",
            }
        }
    )

    fetch_event = next(event for event in events if event[0] == "fetch")
    fetch_kwargs = fetch_event[1]
    assert fetch_kwargs["channel"] == "all"
    assert fetch_kwargs["dependencies"] is dependencies_marker
    assert fetch_kwargs["source_order"] == ["hdhive"]
    assert fetch_kwargs["sub"].tmdb_id == 321
    assert fetch_kwargs["sub"].title == "Example Movie"
    assert ("extract_resource_url", resource) in events
    assert (
        "save_share_directly",
        {
            "share_link": "https://115.com/s/direct?password=abcd",
            "folder_id": "direct-folder",
            "receive_code": "abcd",
            "quality_filter": {"quality": "filter"},
        },
    ) in events
    assert ("postprocess", {"trigger": "explore_transfer"}) in events
    assert result["save_mode"] == "direct"
    assert result["share_link"] == "https://115.com/s/direct?password=abcd"
    assert result["source_order"] == ["hdhive"]
    assert result["attempts"] == [{"source": "hdhive", "status": "success"}]


@pytest.mark.asyncio
async def test_explore_save_offline_transfer_uses_offline_url_helper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ExploreActionQueueService()
    dependencies_marker = object()
    events: list[tuple[str, Any]] = []
    resource = {
        "source_service": "offline",
        "name": "Example Magnet",
        "magnet": "magnet:?xt=urn:btih:abc",
    }

    monkeypatch.setattr(
        explore_queue_module,
        "resolve_source_order_with_runtime_adapter",
        lambda channel: events.append(("source_order", channel)) or ["offline"],
    )
    monkeypatch.setattr(
        explore_queue_module,
        "build_default_resource_resolver_runtime_dependencies",
        lambda: events.append(("build_dependencies", None)) or dependencies_marker,
    )

    async def fake_fetch_subscription_resources_with_runtime_adapter(**kwargs: Any):
        events.append(("fetch", kwargs))
        return [resource], [], {
            "attempts": [{"source": "offline", "status": "success"}]
        }

    monkeypatch.setattr(
        explore_queue_module,
        "fetch_subscription_resources_with_runtime_adapter",
        fake_fetch_subscription_resources_with_runtime_adapter,
    )
    monkeypatch.setattr(
        explore_queue_module,
        "extract_resource_url",
        lambda item: events.append(("extract_resource_url", item)) or "",
    )
    monkeypatch.setattr(
        explore_queue_module,
        "extract_offline_url",
        lambda item: events.append(("extract_offline_url", item))
        or str(item["magnet"]),
    )
    monkeypatch.setattr(
        explore_queue_module.runtime_settings_service,
        "get_pan115_default_folder",
        lambda: {"folder_id": "direct-folder"},
    )
    monkeypatch.setattr(
        explore_queue_module.runtime_settings_service,
        "get_pan115_offline_folder",
        lambda: {"folder_id": "offline-folder"},
    )

    async def fail_save_share_directly(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("offline resource should not use direct share transfer")

    async def fake_offline_task_add(**kwargs: Any) -> None:
        events.append(("offline_task_add", kwargs))

    monkeypatch.setattr(
        explore_queue_module.pan115_service,
        "save_share_directly",
        fail_save_share_directly,
    )
    monkeypatch.setattr(
        explore_queue_module.pan115_service,
        "offline_task_add",
        fake_offline_task_add,
    )

    async def fake_trigger_archive_after_transfer(**kwargs: Any) -> None:
        events.append(("postprocess", kwargs))

    monkeypatch.setattr(
        explore_queue_module.media_postprocess_service,
        "trigger_archive_after_transfer",
        fake_trigger_archive_after_transfer,
    )

    result = await service._execute_save(
        {
            "payload": {
                "source": "tmdb",
                "media_type": "movie",
                "tmdb_id": 654,
                "title": "Example Magnet",
            }
        }
    )

    fetch_event = next(event for event in events if event[0] == "fetch")
    fetch_kwargs = fetch_event[1]
    assert fetch_kwargs["channel"] == "all"
    assert fetch_kwargs["dependencies"] is dependencies_marker
    assert fetch_kwargs["source_order"] == ["offline"]
    assert fetch_kwargs["sub"].tmdb_id == 654
    assert ("extract_resource_url", resource) in events
    assert ("extract_offline_url", resource) in events
    assert (
        "offline_task_add",
        {"url": "magnet:?xt=urn:btih:abc", "wp_path_id": "offline-folder"},
    ) in events
    assert ("postprocess", {"trigger": "explore_transfer"}) in events
    assert result["save_mode"] == "offline"
    assert result["share_link"] == "magnet:?xt=urn:btih:abc"
    assert result["target_parent_id"] == "offline-folder"

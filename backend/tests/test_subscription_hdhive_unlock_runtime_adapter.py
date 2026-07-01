from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.hdhive_unlock import (
    build_hdhive_unlock_context,
    prepare_hdhive_locked_resources,
)
from app.services.subscriptions.hdhive_unlock_runtime_adapter import (
    HDHiveUnlockRuntimeDependencies,
    build_default_hdhive_unlock_runtime_dependencies,
    build_hdhive_unlock_context_with_runtime_adapter,
    prepare_hdhive_locked_resources_with_runtime_adapter,
)
from app.services.subscriptions.resource_candidates import (
    extract_resource_url,
    normalize_share_url,
)
from app.services.subscriptions.resource_metadata import (
    normalize_hdhive_subscription_items,
)


ROOT = Path(__file__).resolve().parents[2]


def _dependencies(**overrides: Any) -> HDHiveUnlockRuntimeDependencies:
    async def unlock_resource(slug: str) -> dict[str, Any]:
        return {
            "success": True,
            "message": "ok",
            "share_link": f"https://115.com/s/{slug}?password=abcd",
        }

    async def prepare_locked_resources(
        resources: list[dict[str, Any]],
        context: dict[str, Any],
        traces: list[dict[str, Any]],
        *,
        normalize_items: Any,
        extract_resource_url: Any,
        normalize_share_url: Any,
        unlock_resource: Any,
    ) -> list[dict[str, Any]]:
        normalized = normalize_items(resources)
        for item in normalized:
            if extract_resource_url(item):
                continue
            item["share_link"] = normalize_share_url(
                (await unlock_resource(item["slug"]))["share_link"]
            )
        traces.append({"step": "prepared", "status": "success"})
        context["prepared"] = True
        return normalized

    values: dict[str, Any] = {
        "get_auto_unlock_enabled": lambda: True,
        "get_max_points_per_item": lambda: 8,
        "get_budget_points_per_run": lambda: 20,
        "get_threshold_inclusive": lambda: False,
        "normalize_items": lambda items: [dict(item) for item in items],
        "extract_resource_url": lambda item: str(item.get("share_link") or ""),
        "normalize_share_url": lambda url: url.strip(),
        "unlock_resource": unlock_resource,
        "build_context": build_hdhive_unlock_context,
        "prepare_locked_resources": prepare_locked_resources,
    }
    values.update(overrides)
    return HDHiveUnlockRuntimeDependencies(**values)


def test_runtime_adapter_builds_context_from_injected_settings() -> None:
    context = build_hdhive_unlock_context_with_runtime_adapter(
        dependencies=_dependencies(
            get_auto_unlock_enabled=lambda: True,
            get_max_points_per_item=lambda: 6,
            get_budget_points_per_run=lambda: 18,
            get_threshold_inclusive=lambda: True,
        )
    )

    assert context["enabled"] is True
    assert context["max_points_per_item"] == 6
    assert context["budget_total"] == 18
    assert context["budget_left"] == 18
    assert context["threshold_inclusive"] is True
    assert context["stats"] == {
        "attempted": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "points_spent": 0,
    }


@pytest.mark.asyncio
async def test_runtime_adapter_prepares_locked_resources_with_injected_helpers() -> None:
    events: list[tuple[str, Any]] = []

    def normalize_items(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        events.append(("normalize_items", resources))
        return [dict(item, normalized=True) for item in resources]

    def normalize_url(url: str) -> str:
        events.append(("normalize_share_url", url))
        return url.strip()

    async def unlock_resource(slug: str) -> dict[str, Any]:
        events.append(("unlock_resource", slug))
        return {
            "success": True,
            "message": "ok",
            "share_link": f" https://115.com/s/{slug}?password=abcd ",
        }

    resources = [{"source_service": "hdhive", "slug": "slug-a"}]
    context: dict[str, Any] = {}
    traces: list[dict[str, Any]] = []

    result = await prepare_hdhive_locked_resources_with_runtime_adapter(
        resources,
        context,
        traces,
        dependencies=_dependencies(
            normalize_items=normalize_items,
            normalize_share_url=normalize_url,
            unlock_resource=unlock_resource,
        ),
    )

    assert result == [
        {
            "source_service": "hdhive",
            "slug": "slug-a",
            "normalized": True,
            "share_link": "https://115.com/s/slug-a?password=abcd",
        }
    ]
    assert context == {"prepared": True}
    assert traces == [{"step": "prepared", "status": "success"}]
    assert events == [
        ("normalize_items", resources),
        ("unlock_resource", "slug-a"),
        ("normalize_share_url", " https://115.com/s/slug-a?password=abcd "),
    ]


def test_default_runtime_dependencies_bind_existing_helpers_and_runners() -> None:
    dependencies = build_default_hdhive_unlock_runtime_dependencies()

    assert dependencies.build_context is build_hdhive_unlock_context
    assert dependencies.prepare_locked_resources is prepare_hdhive_locked_resources
    assert dependencies.normalize_items is normalize_hdhive_subscription_items
    assert dependencies.extract_resource_url is extract_resource_url
    assert dependencies.normalize_share_url is normalize_share_url
    assert callable(dependencies.unlock_resource)
    assert isinstance(dependencies.get_auto_unlock_enabled(), bool)
    assert isinstance(dependencies.get_max_points_per_item(), int)
    assert isinstance(dependencies.get_budget_points_per_run(), int)
    assert isinstance(dependencies.get_threshold_inclusive(), bool)


def test_hdhive_unlock_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/hdhive_unlock_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source

from __future__ import annotations

from pathlib import Path


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

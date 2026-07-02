from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_resource_resolver_default_dependency_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_fetch_from_pansou",
        "_fetch_from_hdhive",
        "_fetch_from_tg",
        "_fetch_offline_magnets",
        "_resolve_subscription_resolutions",
        "fetch_from_pansou_with_runtime_adapter",
        "fetch_from_hdhive_with_runtime_adapter",
        "fetch_from_tg_with_runtime_adapter",
        "fetch_offline_magnets_with_runtime_adapter",
        "runtime_settings_service",
    ):
        assert name not in source


def test_subscription_service_drops_fetch_resources_wrapper_and_keeps_hdhive_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" not in source
    assert "build_default_resource_resolver_runtime_dependencies" not in source
    assert "fetch_subscription_resources_with_runtime_adapter" not in source
    assert "_build_hdhive_unlock_context" in source
    assert "_prepare_hdhive_locked_resources" in source

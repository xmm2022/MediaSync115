from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_link_fallback_adapter_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "LinkFallbackAdapterDependencies",
        "auto_save_records_with_link_fallback_flow",
        "auto_save_records_with_link_fallback_with_adapter",
        "MAX_AUTO_TRANSFER_LINK_FALLBACK_ROUNDS",
    ):
        assert name not in source


def test_subscription_service_drops_link_fallback_runtime_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "async def _auto_save_records_with_link_fallback",
        "auto_save_records_with_link_fallback_with_runtime_adapter",
        "build_default_link_fallback_runtime_dependencies",
    ):
        assert name not in source

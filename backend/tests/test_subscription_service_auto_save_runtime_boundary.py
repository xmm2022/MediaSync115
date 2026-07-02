from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def _auto_save_resources_source(source: str) -> str:
    start = source.index("    async def _auto_save_resources")
    end = source.index("    async def _create_execution_log", start)
    return source[start:end]


def test_subscription_service_drops_auto_save_runtime_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")
    auto_save_source = _auto_save_resources_source(source)

    for name in (
        "_apply_precise_transfer_postprocess_status",
        "_notify_transfer_success",
        "apply_precise_transfer_postprocess_status_with_runtime_adapter",
        "notify_transfer_success_with_runtime_adapter",
    ):
        assert name not in source

    for name in (
        "resolve_quality_filter=self._resolve_subscription_quality_filter",
        "apply_precise_postprocess_status=",
        "notify_transfer_success=self._notify_transfer_success",
    ):
        assert name not in auto_save_source


def test_subscription_service_uses_auto_save_runtime_default_dependencies() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _auto_save_resources" in source
    assert "auto_save_resources_with_runtime_adapter" in source
    assert "build_default_auto_save_resources_runtime_dependencies()" in source

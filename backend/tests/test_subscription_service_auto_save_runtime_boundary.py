from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_auto_save_runtime_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_apply_precise_transfer_postprocess_status",
        "_notify_transfer_success",
        "apply_precise_transfer_postprocess_status_with_runtime_adapter",
        "notify_transfer_success_with_runtime_adapter",
        "apply_precise_postprocess_status=",
        "notify_transfer_success=self._notify_transfer_success",
    ):
        assert name not in source


def test_subscription_service_drops_auto_save_resources_wrapper() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "async def _auto_save_resources",
        "auto_save_resources_with_runtime_adapter",
        "build_default_auto_save_resources_runtime_dependencies",
        "DownloadRecord",
    ):
        assert name not in source

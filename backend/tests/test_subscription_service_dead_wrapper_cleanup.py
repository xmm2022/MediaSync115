from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_subscription_service_drops_unreferenced_private_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    for name in (
        "_build_source_attempt_summary",
        "_allow_unlock_by_threshold",
        "_safe_int",
        "_should_stop_unlocking_on_message",
        "build_source_attempt_summary",
        "allow_unlock_by_threshold",
        "safe_int",
        "should_stop_unlocking_on_message",
    ):
        assert name not in source


def test_subscription_service_keeps_used_hdhive_runtime_wrappers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "_build_hdhive_unlock_context" in source
    assert "_prepare_hdhive_locked_resources" in source
    assert "build_hdhive_unlock_context_with_runtime_adapter" in source
    assert "prepare_hdhive_locked_resources_with_runtime_adapter" in source

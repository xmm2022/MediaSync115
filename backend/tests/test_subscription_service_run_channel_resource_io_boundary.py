from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_run_channel_drops_resource_io_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")
    run_channel_start = source.index("    async def run_channel_check")
    run_channel_end = source.index(
        "    async def cleanup_completed_subscriptions",
        run_channel_start,
    )
    run_channel_source = source[run_channel_start:run_channel_end]

    assert "fetch_resources=self._fetch_resources" not in run_channel_source
    assert "store_new_resources=self._store_new_resources" not in run_channel_source
    assert "async def _store_new_resources" not in source


def test_fetch_resources_wrapper_is_removed_after_runtime_defaults_take_over() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" not in source

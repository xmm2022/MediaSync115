from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "backend/app/services/subscription_service.py"


def test_manual_fetch_drops_fetch_resource_callback_assembly() -> None:
    source = SERVICE.read_text(encoding="utf-8")
    start = source.index("    async def fetch_resources_for_media")
    end = source.index("\n\n\nsubscription_service =", start)
    public_fetch_source = source[start:end]

    assert "fetch_resources=self._fetch_resources" not in public_fetch_source


def test_fetch_resources_wrapper_stays_for_existing_callers() -> None:
    source = SERVICE.read_text(encoding="utf-8")

    assert "async def _fetch_resources" in source

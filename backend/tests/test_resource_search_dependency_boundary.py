from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_subscription_service_does_not_import_search_api_helpers() -> None:
    source = (ROOT / "backend/app/services/subscription_service.py").read_text(
        encoding="utf-8"
    )

    assert "from app.api.search import" not in source

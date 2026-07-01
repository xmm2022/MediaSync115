from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.source_attempts import (
    build_source_attempt_summary,
    resolve_source_order,
)


ROOT = Path(__file__).resolve().parents[2]


def test_build_source_attempt_summary_reports_success_chain() -> None:
    summary = build_source_attempt_summary(
        [
            {"source": "pansou", "status": "empty", "count": 0},
            {"source": "hdhive", "status": "success", "count": 2},
            {"source": "offline", "status": "success", "count": 1},
        ],
        ["pansou", "hdhive", "tg"],
    )

    assert (
        summary
        == "尝试来源 [Pansou(无资源) → HDHive(2条) → 离线磁力(1条)]，最终命中 HDHive, 离线磁力"
    )


def test_build_source_attempt_summary_reports_failure_and_empty() -> None:
    summary = build_source_attempt_summary(
        [
            {"source": "tg", "status": "failed", "count": 0, "error": "boom"},
            {"source": "pansou", "status": "empty", "count": 0},
        ],
        ["tg", "pansou"],
    )

    assert summary == "尝试来源 [TG(失败) → Pansou(无资源)]，均未命中可用资源"


def test_resolve_source_order_filters_unsupported_and_unready_tg() -> None:
    assert resolve_source_order(
        ["seedhub", "tg", "pansou", "hdhive"], tg_ready=False
    ) == [
        "pansou",
        "hdhive",
    ]
    assert resolve_source_order(["seedhub", "tg", "pansou"], tg_ready=True) == [
        "tg",
        "pansou",
    ]


def test_source_attempts_module_does_not_import_runtime_service_or_api_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/source_attempts.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "app.api" not in source

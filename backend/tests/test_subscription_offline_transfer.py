from __future__ import annotations

from pathlib import Path

from app.services.subscriptions.offline_transfer import (
    build_submitted_offline_metadata,
    extract_hash_from_offline_url,
    extract_offline_info_hash,
    extract_offline_task_id,
)


ROOT = Path(__file__).resolve().parents[2]


def test_extract_hash_from_magnet_url_uppercases_btih() -> None:
    assert (
        extract_hash_from_offline_url(
            "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
        )
        == "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
    )


def test_extract_offline_metadata_reads_nested_payloads() -> None:
    payload = {
        "data": [
            {"ignored": ""},
            {"task": {"taskId": "task-123", "taskHash": "hash-456"}},
        ]
    }

    assert extract_offline_info_hash(payload) == "hash-456"
    assert extract_offline_task_id(payload) == "task-123"


def test_build_submitted_offline_metadata_falls_back_to_url_hash() -> None:
    metadata = build_submitted_offline_metadata(
        {"data": {"task_id": "task-only"}},
        "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
    )

    assert metadata.info_hash == "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
    assert metadata.task_id == "task-only"


def test_offline_transfer_module_does_not_import_runtime_or_service_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/offline_transfer.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "app.api" not in source

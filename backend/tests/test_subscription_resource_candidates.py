from __future__ import annotations

from pathlib import Path

from app.models.models import MediaType
from app.services.subscriptions.resource_candidates import (
    extract_offline_url,
    extract_resource_url,
    filter_resources_excluding_urls,
    merge_auto_save_stats,
    resource_candidate_url,
    should_continue_link_fallback,
)


ROOT = Path(__file__).resolve().parents[2]


def test_extract_resource_url_normalizes_115cdn_and_strips_fragment() -> None:
    assert (
        extract_resource_url({"share_link": "https://115cdn.com/s/abc123#frag"})
        == "https://115.com/s/abc123"
    )


def test_resource_candidate_url_falls_back_to_offline_url() -> None:
    item = {"magnet": "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12"}

    assert extract_offline_url(item).startswith("magnet:")
    assert resource_candidate_url(item).startswith("magnet:")


def test_filter_resources_excluding_urls_uses_candidate_url() -> None:
    resources = [
        {"share_link": "https://115.com/s/old"},
        {"magnet": "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12"},
    ]

    filtered = filter_resources_excluding_urls(resources, {"https://115.com/s/old"})

    assert filtered == [resources[1]]


def test_merge_auto_save_stats_carries_cleanup_and_remaining_missing() -> None:
    target = {
        "saved": 0,
        "failed": 1,
        "errors": [{"error": "old"}],
        "subscription_completed": False,
        "cleanup_step": "",
        "cleanup_message": "",
        "cleanup_payload": {},
        "remaining_missing_count": None,
    }

    merge_auto_save_stats(
        target,
        {
            "saved": 2,
            "failed": 0,
            "errors": [{"error": "new"}],
            "subscription_completed": True,
            "cleanup_step": "cleanup",
            "cleanup_message": "done",
            "cleanup_payload": {"deleted": True},
            "remaining_missing_count": 0,
        },
    )

    assert target["saved"] == 2
    assert target["failed"] == 1
    assert target["errors"] == [{"error": "old"}, {"error": "new"}]
    assert target["subscription_completed"] is True
    assert target["cleanup_step"] == "cleanup"
    assert target["remaining_missing_count"] == 0


def test_should_continue_link_fallback_keeps_tv_missing_rounds() -> None:
    assert should_continue_link_fallback(
        MediaType.TV,
        {"saved": 1, "subscription_completed": False, "remaining_missing_count": 2},
        attempted_count=1,
    )
    assert not should_continue_link_fallback(
        MediaType.TV,
        {"saved": 1, "subscription_completed": False, "remaining_missing_count": 0},
        attempted_count=1,
    )


def test_resource_candidates_module_does_not_import_service_or_api_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/resource_candidates.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source

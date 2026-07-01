from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.subscriptions.tv_episode_selection import (
    select_missing_episode_files,
)


ROOT = Path(__file__).resolve().parents[2]


def test_select_missing_episode_files_picks_best_candidate_per_missing_pair() -> None:
    files = [
        {"fid": "low", "name": "Show.S01E02.720p.mkv", "size": 100},
        {"fid": "high", "name": "Show.S01E02.1080p.mkv", "size": 200},
        {"fid": "other", "name": "Show.S01E03.1080p.mkv", "size": 300},
    ]

    def pick_largest(
        items: list[dict[str, Any]], _quality: dict[str, Any]
    ) -> dict[str, Any]:
        return max(items, key=lambda item: int(item.get("size") or 0))

    result = select_missing_episode_files(
        files,
        missing_episodes={(1, 2)},
        quality_filter={},
        best_picker=pick_largest,
    )

    assert [item["fid"] for item in result.selected_items] == ["high"]
    assert result.selected_file_ids == ["high"]
    assert result.matched_pairs == {(1, 2)}
    assert result.matched_missing_count == 2
    assert result.parsed_count == 3
    assert result.unparsed_video_count == 0


def test_select_missing_episode_files_respects_selected_ids_and_counts_unparsed_video() -> None:
    files = [
        {"fid": "1", "name": "Show.S01E01.mkv"},
        {"fid": "2", "name": "Unparsed.Special.mkv"},
        {"fid": "3", "name": "Show.S01E02.txt"},
    ]

    result = select_missing_episode_files(
        files,
        missing_episodes={(1, 1), (1, 2)},
        selected_file_ids={"1", "2"},
    )

    assert result.selected_file_ids == ["1"]
    assert result.matched_pairs == {(1, 1)}
    assert result.parsed_count == 1
    assert result.unparsed_video_count == 1


def test_tv_episode_selection_module_does_not_import_service_or_api_layers() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/tv_episode_selection.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "pan115_service" not in source
    assert "runtime_settings_service" not in source
    assert "app.api" not in source

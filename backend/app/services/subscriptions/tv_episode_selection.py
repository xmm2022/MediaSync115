from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from app.utils.name_parser import name_parser


VIDEO_EXTENSIONS = (
    ".mp4",
    ".mkv",
    ".avi",
    ".rmvb",
    ".flv",
    ".ts",
    ".m2ts",
    ".mov",
    ".wmv",
    ".m4v",
    ".webm",
)

BestPicker = Callable[[list[dict[str, Any]], dict[str, Any]], dict[str, Any] | None]
VideoPredicate = Callable[[str], bool]


@dataclass(frozen=True)
class MissingEpisodeFileSelection:
    selected_items: list[dict[str, Any]]
    selected_file_ids: list[str]
    matched_pairs: set[tuple[int, int]]
    matched_missing_count: int
    parsed_count: int
    unparsed_video_count: int


def is_video_filename(filename: str) -> bool:
    return str(filename or "").strip().lower().endswith(VIDEO_EXTENSIONS)


def item_file_id(item: dict[str, Any]) -> str:
    return str(item.get("fid") or item.get("file_id") or "").strip()


def select_missing_episode_files(
    files: list[dict[str, Any]],
    *,
    missing_episodes: set[tuple[int, int]],
    quality_filter: dict[str, Any] | None = None,
    selected_file_ids: set[str] | None = None,
    best_picker: BestPicker | None = None,
    is_video_file: VideoPredicate = is_video_filename,
) -> MissingEpisodeFileSelection:
    matched_candidates: dict[tuple[int, int], list[dict[str, Any]]] = {}
    parsed_count = 0
    unparsed_video_count = 0
    allowed_ids = {
        str(item).strip() for item in selected_file_ids or set() if str(item).strip()
    }

    for item in files:
        if not isinstance(item, dict):
            continue
        filename = str(item.get("name") or "").strip()
        fid = item_file_id(item)
        if not filename or not fid:
            continue
        if allowed_ids and fid not in allowed_ids:
            continue
        if not is_video_file(filename):
            continue

        parsed = name_parser.parse_episode(filename)
        if parsed:
            parsed_count += 1
            pair = (int(parsed[0]), int(parsed[1]))
            if pair in missing_episodes:
                matched_candidates.setdefault(pair, []).append(item)
            continue
        unparsed_video_count += 1

    selected_items: list[dict[str, Any]] = []
    for items in matched_candidates.values():
        if len(items) > 1:
            selected_items.append(
                (best_picker(items, quality_filter or {}) if best_picker else None)
                or items[0]
            )
        else:
            selected_items.extend(items)

    selected_file_ids = list(
        dict.fromkeys(item_file_id(item) for item in selected_items if item_file_id(item))
    )
    return MissingEpisodeFileSelection(
        selected_items=selected_items,
        selected_file_ids=selected_file_ids,
        matched_pairs=set(matched_candidates.keys()),
        matched_missing_count=sum(len(items) for items in matched_candidates.values()),
        parsed_count=parsed_count,
        unparsed_video_count=unparsed_video_count,
    )

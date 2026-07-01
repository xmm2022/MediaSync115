from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


INFO_HASH_KEYS = {
    "info_hash",
    "infoHash",
    "hash",
    "task_hash",
    "taskHash",
}
TASK_ID_KEYS = {
    "task_id",
    "taskId",
    "taskid",
    "id",
}


@dataclass(frozen=True)
class SubmittedOfflineMetadata:
    info_hash: str
    task_id: str


def extract_hash_from_offline_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    magnet_match = re.search(r"btih:([a-zA-Z0-9]{32,40})", raw, re.IGNORECASE)
    if magnet_match:
        return magnet_match.group(1).upper()
    return ""


def extract_first_nested_value(payload: Any, keys: set[str]) -> str:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in keys and value not in (None, ""):
                return str(value).strip()
        for value in payload.values():
            found = extract_first_nested_value(value, keys)
            if found:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = extract_first_nested_value(item, keys)
            if found:
                return found
    return ""


def extract_offline_info_hash(payload: Any) -> str:
    return extract_first_nested_value(payload, INFO_HASH_KEYS)


def extract_offline_task_id(payload: Any) -> str:
    return extract_first_nested_value(payload, TASK_ID_KEYS)


def build_submitted_offline_metadata(
    payload: Any, resource_url: str
) -> SubmittedOfflineMetadata:
    return SubmittedOfflineMetadata(
        info_hash=extract_offline_info_hash(payload)
        or extract_hash_from_offline_url(resource_url),
        task_id=extract_offline_task_id(payload),
    )

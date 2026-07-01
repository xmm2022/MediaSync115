from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import urlparse


_pan115_share_url_pattern = re.compile(
    r"(https?://(?:115(?:cdn)?\.com/s/[A-Za-z0-9]+(?:[^\s\"'<>]*)?|share\.115\.com/[A-Za-z0-9]+(?:[^\s\"'<>]*)?|anxia\.com/s/[A-Za-z0-9]+(?:[^\s\"'<>]*)?))",
    re.IGNORECASE,
)
_pan115_receive_code_pattern = re.compile(
    r"(?:提取码|提取碼|密码|密碼|password|pwd)\s*[:：=]?\s*([A-Za-z0-9]{4})",
    re.IGNORECASE,
)
_pan115_share_code_hint_pattern = re.compile(
    r"(?:分享码|分享碼|share(?:_|\s*)code)\s*[:：=]?\s*([A-Za-z0-9]{6,32})",
    re.IGNORECASE,
)


def is_115_share_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return "115.com" in host or "115cdn.com" in host or "anxia.com" in host


def is_likely_115_share_identifier(value: str) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False

    if raw.startswith(("http://", "https://", "//")):
        normalized = raw
        if normalized.startswith("//"):
            normalized = f"https:{normalized}"
        return is_115_share_url(normalized)

    return bool(re.match(r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]{4})?$", raw))


def extract_first_string_value(row: dict, keys: list[str]) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def iter_string_values(node: Any, depth: int = 0) -> list[str]:
    if depth > 4:
        return []
    if isinstance(node, str):
        text = node.strip()
        return [text] if text else []
    if isinstance(node, list):
        values: list[str] = []
        for item in node:
            values.extend(iter_string_values(item, depth + 1))
        return values
    if isinstance(node, dict):
        values: list[str] = []
        for value in node.values():
            values.extend(iter_string_values(value, depth + 1))
        return values
    return []


def extract_pan115_share_link_from_text(
    text: str, allow_plain_code: bool = False
) -> str:
    raw = str(text or "").strip()
    if not raw:
        return ""

    if raw.startswith("//"):
        raw = f"https:{raw}"

    url_match = _pan115_share_url_pattern.search(raw)
    if url_match:
        return url_match.group(1).strip()

    if allow_plain_code and re.fullmatch(r"[A-Za-z0-9]{6,32}(?:-[A-Za-z0-9]{4})?", raw):
        return raw

    receive_code = ""
    receive_match = _pan115_receive_code_pattern.search(raw)
    if receive_match:
        receive_code = receive_match.group(1).strip()

    share_code_match = _pan115_share_code_hint_pattern.search(raw)
    if share_code_match:
        share_code = share_code_match.group(1).strip()
        final_receive = receive_code
        if final_receive and share_code:
            return f"{share_code}-{final_receive}"
        return share_code

    return ""


def extract_pansou_share_link(row: dict) -> str:
    prioritized_candidate = extract_first_string_value(
        row,
        [
            "share_link",
            "share_url",
            "url",
            "link",
            "resource_url",
            "source_url",
            "href",
            "share_code",
            "sharecode",
            "code",
        ],
    )
    if prioritized_candidate:
        parsed = extract_pan115_share_link_from_text(
            prioritized_candidate, allow_plain_code=True
        )
        if parsed:
            return parsed

    for text in iter_string_values(row):
        parsed = extract_pan115_share_link_from_text(text, allow_plain_code=False)
        if parsed:
            return parsed
    return ""


def extract_pansou_rows(node: Any, depth: int = 0) -> list[dict]:
    if depth > 5:
        return []

    rows: list[dict] = []
    if isinstance(node, list):
        for item in node:
            if isinstance(item, dict):
                rows.append(item)
            rows.extend(extract_pansou_rows(item, depth + 1))
    elif isinstance(node, dict):
        for value in node.values():
            rows.extend(extract_pansou_rows(value, depth + 1))
    return rows


def normalize_pansou_pan115_list(payload: Any) -> list[dict]:
    rows = extract_pansou_rows(payload)
    items: list[dict] = []
    seen_links: set[str] = set()

    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue

        share_link = extract_pansou_share_link(row)
        if not is_likely_115_share_identifier(share_link):
            continue

        link_key = share_link.strip().lower()
        if link_key in seen_links:
            continue
        seen_links.add(link_key)

        title = extract_first_string_value(
            row,
            ["title", "name", "resource_name", "file_name", "filename", "text"],
        )
        if not title or title == "盘搜资源":
            title = f"115资源 #{len(items) + 1}"

        size = extract_first_string_value(row, ["size"])
        resolution = extract_first_string_value(row, ["resolution"])
        quality = extract_first_string_value(row, ["quality"])

        resource_id = row.get("id")
        if resource_id is None:
            resource_id = f"pansou-pan115-{hashlib.md5(link_key.encode('utf-8')).hexdigest()[:12]}-{index}"

        items.append(
            {
                "id": resource_id,
                "title": title,
                "size": size,
                "resolution": resolution,
                "quality": quality,
                "share_link": share_link,
                "source_service": "pansou",
                "raw_item": row,
            }
        )

    return items


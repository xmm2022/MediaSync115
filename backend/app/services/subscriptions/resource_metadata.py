from __future__ import annotations

import re
from typing import Any


VIDEO_EXTENSIONS = (
    ".mp4",
    ".mkv",
    ".avi",
    ".ts",
    ".rmvb",
    ".flv",
    ".mov",
    ".wmv",
    ".m4v",
)


def determine_resource_type(url: str) -> str:
    lowered = str(url or "").lower()
    if lowered.startswith("magnet:"):
        return "magnet"
    if lowered.startswith("ed2k://"):
        return "ed2k"
    return "pan115"


def extract_resource_name(item: dict[str, Any]) -> str:
    name = str(
        item.get("resource_name") or item.get("title") or item.get("name") or ""
    ).strip()
    return name or "未命名资源"


def build_pansou_keyword(title: str, year: Any) -> str:
    if year:
        return f"{title} {year}".strip()
    return str(title or "")


def build_hdhive_keyword(title: str, year: Any) -> str:
    if year:
        return f"{title} {year}".strip()
    return str(title or "").strip()


def build_tg_keyword(title: str, year: Any) -> str:
    return build_pansou_keyword(title, year)


def normalize_hdhive_subscription_items(
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        if not row.get("pan115_share_link"):
            row["pan115_share_link"] = str(row.get("share_link") or "").strip()
        if not row.get("name") and row.get("resource_name"):
            row["name"] = str(row.get("resource_name") or "").strip()
        normalized.append(row)
    return normalized


def split_share_link_and_receive_code(raw_link: str) -> tuple[str, str]:
    value = str(raw_link or "").strip()
    if not value:
        return "", ""

    code_receive_match = re.fullmatch(r"([A-Za-z0-9]+)-([A-Za-z0-9]{4})", value)
    if code_receive_match:
        return code_receive_match.group(1), code_receive_match.group(2)

    receive_code = ""
    for pattern in (
        r"(?:password|receive_code|pickcode|code)=([A-Za-z0-9]{4})",
        r"(?:提取码|访问码|密码)[:：\s]*([A-Za-z0-9]{4})",
    ):
        matched = re.search(pattern, value, re.IGNORECASE)
        if matched:
            receive_code = matched.group(1)
            break

    return value, receive_code


def is_video_filename(filename: str) -> bool:
    value = str(filename or "").strip().lower()
    if not value:
        return False
    return value.endswith(VIDEO_EXTENSIONS)


def is_likely_115_share_identifier(raw_link: str) -> bool:
    value = str(raw_link or "").strip()
    if not value:
        return False
    lowered = value.lower()
    if lowered.startswith(("http://", "https://", "//")):
        return bool(
            re.search(r"(?:115(?:cdn)?\.com|share\.115\.com|anxia\.com)", lowered)
        )
    return bool(re.fullmatch(r"[a-zA-Z0-9]+(?:-[a-zA-Z0-9]{4})?", value))


def is_retryable_transfer_error(error_text: str) -> bool:
    text = str(error_text or "").lower()
    if not text:
        return False
    tokens = (
        "share_api_method_not_allowed",
        "code=405",
        "code=404",
        "method not allowed",
        "nothing matches the given uri",
        "rate",
        "timeout",
        "频繁",
        "受限",
        "已有转存任务",
    )
    return any(token in text for token in tokens)


def is_already_received_error(error_text: str) -> bool:
    text = str(error_text or "").lower()
    if not text:
        return False
    tokens = (
        "4200045",
        "已接收",
        "重复接收",
        "already received",
    )
    return any(token in text for token in tokens)

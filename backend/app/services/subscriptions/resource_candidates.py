from __future__ import annotations

from typing import Any

from app.models.models import MediaType


def normalize_share_url(url: str) -> str:
    normalized = str(url or "").strip()
    if not normalized:
        return ""
    if "#" in normalized:
        normalized = normalized.split("#")[0]
    return normalized.replace("https://115cdn.com/", "https://115.com/")


def extract_resource_url(item: dict[str, Any]) -> str:
    raw_url = str(
        item.get("pan115_share_link")
        or item.get("share_link")
        or item.get("shareLink")
        or item.get("share_url")
        or item.get("url")
        or ""
    ).strip()
    return normalize_share_url(raw_url)


def extract_offline_url(item: dict[str, Any]) -> str:
    for key in ("magnet", "magnet_link", "magnet_url"):
        value = str(item.get(key) or "").strip()
        if value and value.lower().startswith("magnet:"):
            return value
    for key in ("ed2k", "ed2k_link", "ed2k_url"):
        value = str(item.get(key) or "").strip()
        if value and value.lower().startswith("ed2k://"):
            return value
    return ""


def resource_candidate_url(item: dict[str, Any]) -> str:
    return (extract_resource_url(item) or extract_offline_url(item)).strip()


def filter_resources_excluding_urls(
    resources: list[dict[str, Any]], exclude_urls: set[str]
) -> list[dict[str, Any]]:
    if not exclude_urls:
        return list(resources)
    filtered: list[dict[str, Any]] = []
    for item in resources:
        url = resource_candidate_url(item)
        if url and url in exclude_urls:
            continue
        filtered.append(item)
    return filtered


def merge_auto_save_stats(target: dict[str, Any], source: dict[str, Any]) -> None:
    target["saved"] = int(target.get("saved") or 0) + int(source.get("saved") or 0)
    target["failed"] = int(target.get("failed") or 0) + int(source.get("failed") or 0)
    target.setdefault("errors", [])
    target["errors"].extend(list(source.get("errors") or []))
    if source.get("subscription_completed"):
        target["subscription_completed"] = True
        target["cleanup_step"] = str(source.get("cleanup_step") or "")
        target["cleanup_message"] = str(source.get("cleanup_message") or "")
        target["cleanup_payload"] = dict(source.get("cleanup_payload") or {})
    if source.get("remaining_missing_count") is not None:
        target["remaining_missing_count"] = source.get("remaining_missing_count")


def should_continue_link_fallback(
    media_type: MediaType,
    stats: dict[str, Any],
    *,
    attempted_count: int,
) -> bool:
    if stats.get("subscription_completed"):
        return False
    if media_type == MediaType.TV:
        remaining = stats.get("remaining_missing_count")
        if remaining is not None:
            return int(remaining) > 0
        return int(stats.get("saved") or 0) == 0 and attempted_count > 0
    return int(stats.get("saved") or 0) == 0 and attempted_count > 0

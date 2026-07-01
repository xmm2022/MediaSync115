from __future__ import annotations

from typing import Any


SUPPORTED_RESOURCE_SOURCES = {"hdhive", "pansou", "tg"}
SOURCE_DISPLAY_NAMES = {
    "hdhive": "HDHive",
    "pansou": "Pansou",
    "tg": "TG",
    "offline": "离线磁力",
}


def build_source_attempt_summary(
    attempts: list[dict[str, Any]], source_order: list[str]
) -> str:
    _ = source_order
    if not attempts:
        return "未尝试任何来源"

    chain_parts: list[str] = []
    success_sources: list[str] = []

    for attempt in attempts:
        source = str(attempt.get("source") or "")
        status = str(attempt.get("status") or "")
        count = attempt.get("count", 0)
        source_name = SOURCE_DISPLAY_NAMES.get(source, source)

        if status == "success":
            chain_parts.append(f"{source_name}({count}条)")
            success_sources.append(source_name)
        elif status == "failed":
            chain_parts.append(f"{source_name}(失败)")
        else:
            chain_parts.append(f"{source_name}(无资源)")

    if not chain_parts:
        return "未尝试任何来源"

    chain_str = " → ".join(chain_parts)
    if success_sources:
        return f"尝试来源 [{chain_str}]，最终命中 {', '.join(success_sources)}"
    return f"尝试来源 [{chain_str}]，均未命中可用资源"


def resolve_source_order(priority: list[str], *, tg_ready: bool) -> list[str]:
    source_order = [item for item in priority if item in SUPPORTED_RESOURCE_SOURCES]
    if not tg_ready:
        source_order = [item for item in source_order if item != "tg"]
    return source_order

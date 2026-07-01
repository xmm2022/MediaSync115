from __future__ import annotations

import re
from typing import Any


def extract_year_from_date_like(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if len(text) >= 4 and text[:4].isdigit():
        return text[:4]
    return ""


def normalize_keyword_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return re.sub(r"\s+", " ", text)


def strip_keyword_punctuation(value: str) -> str:
    return re.sub(r"[\s\-_·:：,.，。!！?？'\"“”‘’()（）\[\]【】/\\]+", "", value or "")


def build_pansou_keyword_candidates(
    payload: dict, media_type: str, tmdb_id: int, season: int | None = None
) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    if media_type == "tv":
        title = normalize_keyword_text(payload.get("name") or payload.get("title"))
        original_title = normalize_keyword_text(
            payload.get("original_name") or payload.get("original_title")
        )
        date_like = (
            payload.get("first_air_date")
            or payload.get("release_date")
            or payload.get("release")
        )
    else:
        title = normalize_keyword_text(payload.get("title") or payload.get("name"))
        original_title = normalize_keyword_text(
            payload.get("original_title") or payload.get("original_name")
        )
        date_like = payload.get("release_date") or payload.get("release")

    year = extract_year_from_date_like(date_like)
    season_tag = f" S{season:02d}" if season and media_type == "tv" else ""

    def add_keyword(keyword: str) -> None:
        normalized = normalize_keyword_text(keyword)
        if not normalized:
            return
        fingerprint = normalized.casefold()
        if fingerprint in seen:
            return
        seen.add(fingerprint)
        candidates.append(normalized)

    if title and year:
        add_keyword(f"{title} {year}{season_tag}")
    if title:
        add_keyword(f"{title}{season_tag}")

    if original_title and year:
        add_keyword(f"{original_title} {year}{season_tag}")
    if original_title:
        add_keyword(f"{original_title}{season_tag}")

    if media_type != "tv":
        for raw_title in [title, original_title]:
            base = normalize_keyword_text(raw_title)
            if not base:
                continue
            if year:
                no_year = normalize_keyword_text(base.replace(year, ""))
                add_keyword(no_year)
            add_keyword(strip_keyword_punctuation(base))
            for separator in [":", "：", "-", "·"]:
                if separator not in base:
                    continue
                left, right = [part.strip() for part in base.split(separator, 1)]
                add_keyword(left)
                add_keyword(right)
                if year and left:
                    add_keyword(f"{left} {year}")

    add_keyword(f"TMDB {tmdb_id}")
    return candidates


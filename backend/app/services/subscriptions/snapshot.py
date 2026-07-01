from __future__ import annotations

from dataclasses import dataclass

from app.models.models import MediaType


@dataclass(slots=True)
class SubscriptionSnapshot:
    id: int
    tmdb_id: int | None
    douban_id: str | None
    title: str
    media_type: MediaType
    year: str | None
    auto_download: bool
    tv_scope: str
    tv_season_number: int | None
    tv_episode_start: int | None
    tv_episode_end: int | None
    tv_follow_mode: str
    tv_include_specials: bool
    has_successful_transfer: bool

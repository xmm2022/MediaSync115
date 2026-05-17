"""订阅自动清理策略单元测试"""

from dataclasses import dataclass
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.services.subscription_cleanup_policy import (
    build_tv_missing_status_kwargs,
    evaluate_movie_cleanup,
    evaluate_tv_cleanup,
    has_upcoming_episodes_in_subscription_scope,
    normalize_tv_follow_mode,
)


@dataclass
class _Sub:
    media_type: str = "tv"
    tmdb_id: int | None = 1
    tv_scope: str = "all"
    tv_season_number: int | None = None
    tv_episode_start: int | None = None
    tv_episode_end: int | None = None
    tv_follow_mode: str = "missing"
    tv_include_specials: bool = False


class TestMovieCleanupPolicy:
    def test_delete_when_transfer_success(self) -> None:
        ok, reason = evaluate_movie_cleanup(
            has_successful_transfer=True,
            emby_exists=False,
            feiniu_exists=False,
        )
        assert ok is True
        assert "转存" in reason

    def test_delete_when_in_emby(self) -> None:
        ok, reason = evaluate_movie_cleanup(
            has_successful_transfer=False,
            emby_exists=True,
            feiniu_exists=False,
        )
        assert ok is True
        assert "Emby" in reason

    def test_keep_when_not_in_library(self) -> None:
        ok, reason = evaluate_movie_cleanup(
            has_successful_transfer=False,
            emby_exists=False,
            feiniu_exists=False,
        )
        assert ok is False
        assert reason == ""


class TestTvCleanupPolicy:
    def test_missing_mode_no_missing_episodes(self) -> None:
        ok, reason = evaluate_tv_cleanup(
            {"status": "ok", "counts": {"missing": 0}},
            follow_mode="missing",
            has_upcoming_episodes=False,
        )
        assert ok is True
        assert "不缺集" in reason

    def test_new_mode_with_upcoming_keeps_subscription(self) -> None:
        ok, reason = evaluate_tv_cleanup(
            {"status": "ok", "counts": {"missing": 0}},
            follow_mode="new",
            has_upcoming_episodes=True,
        )
        assert ok is False
        assert reason == ""

    def test_new_mode_no_upcoming_deletes(self) -> None:
        ok, reason = evaluate_tv_cleanup(
            {"status": "ok", "counts": {"missing": 0}},
            follow_mode="new",
            has_upcoming_episodes=False,
        )
        assert ok is True
        assert "待播" in reason

    def test_still_missing_keeps_subscription(self) -> None:
        ok, _ = evaluate_tv_cleanup(
            {"status": "ok", "counts": {"missing": 2}},
            follow_mode="missing",
            has_upcoming_episodes=False,
        )
        assert ok is False


class TestTvMissingKwargs:
    def test_new_mode_uses_aired_only(self) -> None:
        sub = _Sub(tv_follow_mode="new")
        kwargs = build_tv_missing_status_kwargs(sub)
        assert kwargs["aired_only"] is True

    def test_missing_mode_includes_unaired(self) -> None:
        sub = _Sub(tv_follow_mode="missing")
        kwargs = build_tv_missing_status_kwargs(sub)
        assert kwargs["aired_only"] is False


class TestUpcomingEpisodes:
    @pytest.mark.asyncio
    async def test_detects_future_air_date(self) -> None:
        future = (date.today() + timedelta(days=7)).isoformat()
        sub = _Sub(tv_scope="season", tv_season_number=1)
        with patch(
            "app.services.tmdb_service.tmdb_service.get_tv_detail",
            new_callable=AsyncMock,
            return_value={"seasons": [{"season_number": 1, "episode_count": 3}]},
        ), patch(
            "app.services.tmdb_service.tmdb_service.get_tv_season_detail",
            new_callable=AsyncMock,
            return_value={
                "episodes": [
                    {"episode_number": 1, "air_date": "2020-01-01"},
                    {"episode_number": 2, "air_date": future},
                ]
            },
        ):
            assert await has_upcoming_episodes_in_subscription_scope(99, sub) is True

    @pytest.mark.asyncio
    async def test_all_aired_in_scope(self) -> None:
        past = (date.today() - timedelta(days=30)).isoformat()
        sub = _Sub(tv_scope="season", tv_season_number=1)
        with patch(
            "app.services.tmdb_service.tmdb_service.get_tv_detail",
            new_callable=AsyncMock,
            return_value={"seasons": [{"season_number": 1, "episode_count": 2}]},
        ), patch(
            "app.services.tmdb_service.tmdb_service.get_tv_season_detail",
            new_callable=AsyncMock,
            return_value={
                "episodes": [
                    {"episode_number": 1, "air_date": past},
                    {"episode_number": 2, "air_date": past},
                ]
            },
        ):
            assert await has_upcoming_episodes_in_subscription_scope(99, sub) is False


class TestNormalizeFollowMode:
    def test_invalid_defaults_to_missing(self) -> None:
        assert normalize_tv_follow_mode("invalid") == "missing"

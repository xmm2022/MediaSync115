from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import MediaType, Subscription
from app.services.moviepilot_client import MoviePilotClient, MoviePilotClientError
from app.services.runtime_settings_service import runtime_settings_service


class MoviePilotProviderError(RuntimeError):
    """MoviePilot Provider 业务错误。"""


class MoviePilotProviderService:
    def __init__(
        self,
        client_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._client_factory = client_factory

    def _create_client(self) -> MoviePilotClient:
        if self._client_factory:
            return self._client_factory()
        return MoviePilotClient(
            base_url=runtime_settings_service.get_moviepilot_base_url(),
            username=runtime_settings_service.get_moviepilot_username(),
            password=runtime_settings_service.get_moviepilot_password(),
            access_token=runtime_settings_service.get_moviepilot_access_token(),
            token_updater=runtime_settings_service.update_moviepilot_access_token,
        )

    async def search_title(self, keyword: str) -> list[dict[str, Any]]:
        client = self._create_client()
        return await client.search_title(keyword)

    async def list_subscribes(self) -> list[dict[str, Any]]:
        client = self._create_client()
        return await client.list_subscribes()

    async def search_subscribe(self, subscribe_id: int) -> dict[str, Any]:
        client = self._create_client()
        return await client.search_subscribe(subscribe_id)

    @staticmethod
    def _media_type_value(value: Any) -> str:
        if isinstance(value, MediaType):
            return value.value
        normalized = str(value or "").strip().lower()
        if normalized == "tv":
            return MediaType.TV.value
        return MediaType.MOVIE.value

    def build_subscribe_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        media_type = self._media_type_value(payload.get("media_type"))
        result: dict[str, Any] = {
            "name": str(payload.get("title") or "").strip(),
            "type": media_type,
            "year": str(payload.get("year") or "").strip() or None,
            "tmdbid": payload.get("tmdb_id"),
            "doubanid": str(payload.get("douban_id") or "").strip() or None,
            "poster": str(payload.get("poster_path") or "").strip() or None,
            "quality": str(payload.get("moviepilot_quality") or "").strip() or None,
            "resolution": str(payload.get("moviepilot_resolution") or "").strip() or None,
            "include": str(payload.get("moviepilot_include") or "").strip() or None,
            "exclude": str(payload.get("moviepilot_exclude") or "").strip() or None,
            "save_path": str(payload.get("moviepilot_save_path") or "").strip()
            or runtime_settings_service.get_moviepilot_save_path()
            or None,
        }
        if media_type == MediaType.TV.value:
            season = payload.get("tv_season_number")
            episode_start = payload.get("tv_episode_start")
            episode_end = payload.get("tv_episode_end")
            if season is not None:
                result["season"] = int(season)
            if episode_start is not None:
                result["start_episode"] = int(episode_start)
            if episode_end is not None:
                result["total_episode"] = int(episode_end)

        return {key: value for key, value in result.items() if value is not None}

    @staticmethod
    def _extract_external_subscription_id(response: dict[str, Any]) -> str:
        data = response.get("data") if isinstance(response, dict) else None
        if isinstance(data, dict):
            raw_id = data.get("id") or data.get("subscribe_id")
        else:
            raw_id = response.get("id") if isinstance(response, dict) else None
        if raw_id is None:
            raise MoviePilotProviderError("MoviePilot 创建订阅响应缺少订阅 ID")
        return str(raw_id)

    async def _find_existing_subscription(
        self,
        db: AsyncSession,
        payload: dict[str, Any],
    ) -> Subscription | None:
        filters = []
        if payload.get("tmdb_id") is not None:
            filters.append(Subscription.tmdb_id == int(payload["tmdb_id"]))
        if payload.get("douban_id"):
            filters.append(Subscription.douban_id == str(payload["douban_id"]))
        if not filters:
            return None
        result = await db.execute(select(Subscription).where(or_(*filters)).limit(1))
        return result.scalar_one_or_none()

    async def create_subscription(
        self,
        db: AsyncSession,
        payload: dict[str, Any],
    ) -> Subscription:
        mp_payload = self.build_subscribe_payload(payload)
        if not mp_payload.get("name"):
            raise MoviePilotProviderError("订阅标题不能为空")

        client = self._create_client()
        try:
            response = await client.create_subscribe(mp_payload)
        except MoviePilotClientError as exc:
            raise MoviePilotProviderError(str(exc)) from exc

        if isinstance(response, dict) and response.get("success") is False:
            raise MoviePilotProviderError(str(response.get("message") or "MoviePilot 创建订阅失败"))
        external_id = self._extract_external_subscription_id(response)

        subscription = await self._find_existing_subscription(db, payload)
        if subscription is None:
            subscription = Subscription(
                title=str(payload.get("title") or "").strip(),
                media_type=MediaType(self._media_type_value(payload.get("media_type"))),
                tmdb_id=payload.get("tmdb_id"),
                douban_id=payload.get("douban_id"),
                poster_path=payload.get("poster_path"),
                overview=payload.get("overview"),
                year=payload.get("year"),
                rating=payload.get("rating"),
                auto_download=bool(payload.get("auto_download", True)),
                tv_scope=str(payload.get("tv_scope") or "all"),
                tv_season_number=payload.get("tv_season_number"),
                tv_episode_start=payload.get("tv_episode_start"),
                tv_episode_end=payload.get("tv_episode_end"),
                tv_follow_mode=str(payload.get("tv_follow_mode") or "missing"),
                tv_include_specials=bool(payload.get("tv_include_specials", False)),
            )
            db.add(subscription)

        subscription.provider = "moviepilot"
        subscription.external_system = "moviepilot"
        subscription.external_subscription_id = external_id
        subscription.external_status = "created"
        await db.commit()
        await db.refresh(subscription)
        return subscription


moviepilot_provider_service = MoviePilotProviderService()

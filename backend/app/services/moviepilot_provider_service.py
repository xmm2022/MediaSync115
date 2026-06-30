from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import DownloadRecord, MediaStatus, MediaType, Subscription
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
    def _extract_subscribe_item_id(item: dict[str, Any]) -> str | None:
        raw_id = item.get("id") or item.get("subscribe_id")
        if raw_id is None:
            data = item.get("data")
            if isinstance(data, dict):
                raw_id = data.get("id") or data.get("subscribe_id")
        if raw_id is None:
            return None
        return str(raw_id)

    @staticmethod
    def _extract_subscribe_item_status(item: dict[str, Any]) -> str:
        for key in ("state", "status", "state_text", "status_text"):
            value = item.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return "synced"

    async def sync_subscriptions(self, db: AsyncSession) -> dict[str, Any]:
        items = await self.list_subscribes()
        item_by_id = {
            external_id: item
            for item in items
            if isinstance(item, dict)
            for external_id in [self._extract_subscribe_item_id(item)]
            if external_id
        }
        if not item_by_id:
            return {"items": items, "updated_count": 0}

        result = await db.execute(
            select(Subscription).where(
                Subscription.external_subscription_id.in_(item_by_id.keys()),
                or_(
                    Subscription.provider == "moviepilot",
                    Subscription.external_system == "moviepilot",
                ),
            )
        )
        subscriptions = result.scalars().all()
        updated_count = 0
        for subscription in subscriptions:
            if not subscription.external_subscription_id:
                continue
            item = item_by_id.get(subscription.external_subscription_id)
            if item is None:
                continue
            external_status = self._extract_subscribe_item_status(item)
            if subscription.external_status != external_status:
                subscription.external_status = external_status
                updated_count += 1

        if updated_count:
            await db.commit()

        return {"items": items, "updated_count": updated_count}

    @staticmethod
    def _text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _lower_text(value: Any) -> str:
        return str(value or "").strip().lower()

    @staticmethod
    def _extract_download_hash(item: dict[str, Any]) -> str:
        for key in ("hash", "download_hash", "info_hash", "hashString"):
            value = item.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    @staticmethod
    def _extract_download_name(item: dict[str, Any]) -> str:
        media = item.get("media")
        media_title = ""
        if isinstance(media, dict):
            media_title = str(media.get("title") or media.get("name") or "").strip()
        for key in ("name", "title", "torrent_name", "content_path", "path"):
            value = item.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return media_title or "MoviePilot Download"

    @staticmethod
    def _extract_download_url(item: dict[str, Any], fallback_hash: str) -> str:
        for key in ("src", "dest", "content_path", "save_path", "path"):
            value = item.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return fallback_hash or MoviePilotProviderService._extract_download_name(item)

    @staticmethod
    def _extract_transfer_items(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if not isinstance(payload, dict):
            return []
        data = payload.get("data")
        if isinstance(data, dict):
            items = data.get("list") or data.get("items")
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]
        items = payload.get("list") or payload.get("items")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
        return []

    @staticmethod
    def _candidate_texts(item: dict[str, Any]) -> list[str]:
        values: list[str] = []
        media = item.get("media")
        if isinstance(media, dict):
            values.extend(
                [
                    str(media.get("title") or ""),
                    str(media.get("name") or ""),
                    str(media.get("original_title") or ""),
                ]
            )
        for key in (
            "title",
            "name",
            "torrent_name",
            "content_path",
            "path",
            "src",
            "dest",
        ):
            values.append(str(item.get(key) or ""))
        return [value.lower() for value in values if value]

    async def _moviepilot_subscriptions(self, db: AsyncSession) -> list[Subscription]:
        result = await db.execute(
            select(Subscription).where(
                or_(
                    Subscription.provider == "moviepilot",
                    Subscription.external_system == "moviepilot",
                )
            )
        )
        return result.scalars().all()

    async def _match_subscription_for_item(
        self,
        db: AsyncSession,
        item: dict[str, Any],
        subscriptions: list[Subscription] | None = None,
    ) -> Subscription | None:
        media = item.get("media")
        if isinstance(media, dict):
            tmdb_id = media.get("tmdbid") or media.get("tmdb_id")
            douban_id = media.get("doubanid") or media.get("douban_id")
            filters = []
            if tmdb_id:
                filters.append(Subscription.tmdb_id == int(tmdb_id))
            if douban_id:
                filters.append(Subscription.douban_id == str(douban_id))
            if filters:
                result = await db.execute(
                    select(Subscription)
                    .where(
                        or_(*filters),
                        or_(
                            Subscription.provider == "moviepilot",
                            Subscription.external_system == "moviepilot",
                        ),
                    )
                    .limit(1)
                )
                matched = result.scalar_one_or_none()
                if matched:
                    return matched

        subscriptions = subscriptions if subscriptions is not None else await self._moviepilot_subscriptions(db)
        candidates = self._candidate_texts(item)
        for subscription in subscriptions:
            title = self._lower_text(subscription.title)
            if title and any(title in candidate or candidate in title for candidate in candidates):
                return subscription
        return None

    async def sync_active_downloads(self, db: AsyncSession) -> dict[str, Any]:
        client = self._create_client()
        items = await client.list_downloads()
        subscriptions = await self._moviepilot_subscriptions(db)
        created_count = 0
        updated_count = 0
        skipped_count = 0

        for item in items:
            if not isinstance(item, dict):
                skipped_count += 1
                continue
            download_hash = self._extract_download_hash(item)
            subscription = await self._match_subscription_for_item(db, item, subscriptions)
            if subscription is None:
                skipped_count += 1
                continue

            existing: DownloadRecord | None = None
            if download_hash:
                result = await db.execute(
                    select(DownloadRecord)
                    .where(DownloadRecord.offline_info_hash == download_hash)
                    .limit(1)
                )
                existing = result.scalar_one_or_none()

            record = existing
            if record is None:
                record = DownloadRecord(
                    subscription_id=int(subscription.id),
                    resource_name=self._extract_download_name(item),
                    resource_url=self._extract_download_url(item, download_hash),
                    resource_type="moviepilot",
                    offline_info_hash=download_hash or None,
                    offline_task_id=download_hash or None,
                    status=MediaStatus.DOWNLOADING,
                )
                db.add(record)
                created_count += 1
            else:
                updated_count += 1
                record.subscription_id = int(subscription.id)
                record.resource_name = self._extract_download_name(item)
                record.resource_url = self._extract_download_url(item, download_hash)
                record.resource_type = "moviepilot"
                record.status = MediaStatus.DOWNLOADING
                record.completed_at = None

            record.offline_status = self._text(item.get("state") or item.get("status")) or "downloading"
            record.error_message = None

        if created_count or updated_count:
            await db.commit()

        return {
            "items": items,
            "created_count": created_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
        }

    async def sync_transfer_history(
        self,
        db: AsyncSession,
        *,
        page: int = 1,
        count: int = 100,
    ) -> dict[str, Any]:
        client = self._create_client()
        payload = await client.transfer_history(page=page, count=count)
        items = self._extract_transfer_items(payload)
        subscriptions = await self._moviepilot_subscriptions(db)
        created_count = 0
        updated_count = 0
        skipped_count = 0

        for item in items:
            download_hash = self._extract_download_hash(item)
            subscription = await self._match_subscription_for_item(db, item, subscriptions)

            existing: DownloadRecord | None = None
            if download_hash:
                result = await db.execute(
                    select(DownloadRecord)
                    .where(DownloadRecord.offline_info_hash == download_hash)
                    .limit(1)
                )
                existing = result.scalar_one_or_none()

            if existing is None and subscription is None:
                skipped_count += 1
                continue

            success = bool(item.get("status", True))
            if existing is None:
                record = DownloadRecord(
                    subscription_id=int(subscription.id),  # type: ignore[union-attr]
                    resource_name=self._extract_download_name(item),
                    resource_url=self._extract_download_url(item, download_hash),
                    resource_type="moviepilot",
                    offline_info_hash=download_hash or None,
                    offline_task_id=download_hash or None,
                )
                db.add(record)
                created_count += 1
            else:
                record = existing
                updated_count += 1
                if subscription is not None:
                    record.subscription_id = int(subscription.id)
                record.resource_name = self._extract_download_name(item)
                record.resource_url = self._extract_download_url(item, download_hash)
                record.resource_type = "moviepilot"

            if success:
                record.status = MediaStatus.COMPLETED
                record.offline_status = "transfer_success"
                record.completed_at = beijing_now()
                record.offline_completed_at = record.completed_at
                record.error_message = None
            else:
                record.status = MediaStatus.FAILED
                record.offline_status = "transfer_failed"
                record.completed_at = None
                record.error_message = self._text(item.get("errmsg") or item.get("message")) or "MoviePilot 转移失败"

        if created_count or updated_count:
            await db.commit()

        return {
            "items": items,
            "created_count": created_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
        }

    async def sync_execution_state(self, db: AsyncSession) -> dict[str, Any]:
        subscription_result = await self.sync_subscriptions(db)
        download_result = await self.sync_active_downloads(db)
        transfer_result = await self.sync_transfer_history(db)
        return {
            "subscriptions": subscription_result,
            "downloads": download_result,
            "transfer_history": transfer_result,
            "updated_count": int(subscription_result.get("updated_count") or 0),
            "download_created_count": int(download_result.get("created_count") or 0),
            "download_updated_count": int(download_result.get("updated_count") or 0),
            "transfer_created_count": int(transfer_result.get("created_count") or 0),
            "transfer_updated_count": int(transfer_result.get("updated_count") or 0),
        }

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
    def _mapping_or_empty(value: Any) -> dict[str, Any]:
        return dict(value) if isinstance(value, dict) else {}

    def _extract_torrent_input(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = self._mapping_or_empty(payload.get("item"))
        for container in (payload, item):
            for key in ("torrent_info", "torrent"):
                nested = self._mapping_or_empty(container.get(key))
                if nested:
                    return nested
        return item or self._mapping_or_empty(payload.get("torrent")) or payload

    def _extract_media_input(self, payload: dict[str, Any]) -> dict[str, Any]:
        item = self._mapping_or_empty(payload.get("item"))
        for container in (payload, item):
            for key in ("media_info", "media"):
                nested = self._mapping_or_empty(container.get(key))
                if nested:
                    return nested
        return {}

    @staticmethod
    def _first_text(*values: Any) -> str:
        for value in values:
            text = str(value or "").strip()
            if text:
                return text
        return ""

    @staticmethod
    def _first_number(*values: Any) -> float | None:
        for value in values:
            if value is None or value == "":
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None

    @staticmethod
    def _first_int(*values: Any) -> int | None:
        for value in values:
            if value is None or value == "":
                continue
            try:
                return int(value)
            except (TypeError, ValueError):
                continue
        return None

    def build_download_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        torrent_input = self._extract_torrent_input(payload)
        media_input = self._extract_media_input(payload)
        item = self._mapping_or_empty(payload.get("item"))

        title = self._first_text(
            torrent_input.get("title"),
            torrent_input.get("name"),
            torrent_input.get("torrent_name"),
            item.get("title"),
            item.get("name"),
            payload.get("title"),
        )
        enclosure = self._first_text(
            torrent_input.get("enclosure"),
            torrent_input.get("torrent_url"),
            torrent_input.get("download_url"),
            torrent_input.get("url"),
            torrent_input.get("link"),
            item.get("enclosure"),
            item.get("torrent_url"),
            item.get("download_url"),
            item.get("url"),
            item.get("link"),
        )
        page_url = self._first_text(
            torrent_input.get("page_url"),
            torrent_input.get("detail_url"),
            item.get("page_url"),
            item.get("detail_url"),
        )
        if not title:
            raise MoviePilotProviderError("MoviePilot 下载缺少种子标题")
        if not enclosure:
            raise MoviePilotProviderError("MoviePilot 下载缺少种子下载链接")

        torrent_in: dict[str, Any] = {
            **torrent_input,
            "title": title,
            "description": self._first_text(
                torrent_input.get("description"),
                torrent_input.get("subtitle"),
                item.get("description"),
            )
            or None,
            "enclosure": enclosure,
            "page_url": page_url or None,
            "site_name": self._first_text(
                torrent_input.get("site_name"),
                torrent_input.get("source"),
                torrent_input.get("site"),
                item.get("source"),
            )
            or None,
            "pubdate": self._first_text(torrent_input.get("pubdate"), item.get("pubdate"))
            or None,
            "size": self._first_number(torrent_input.get("size"), item.get("size")) or 0,
            "seeders": self._first_int(
                torrent_input.get("seeders"),
                torrent_input.get("seeds"),
                item.get("seeders"),
                item.get("seeds"),
            )
            or 0,
        }
        torrent_in = {key: value for key, value in torrent_in.items() if value is not None}

        save_path = self._first_text(
            payload.get("save_path"),
            payload.get("moviepilot_save_path"),
            runtime_settings_service.get_moviepilot_save_path(),
        )
        downloader = self._first_text(payload.get("downloader"))

        result: dict[str, Any] = {
            "torrent_in": torrent_in,
            "downloader": downloader or None,
            "save_path": save_path or None,
        }
        if media_input:
            result["media_in"] = media_input
        else:
            tmdb_id = self._first_int(payload.get("tmdb_id"), item.get("tmdb_id"))
            douban_id = self._first_text(payload.get("douban_id"), item.get("douban_id"))
            if tmdb_id:
                result["tmdbid"] = tmdb_id
            if douban_id:
                result["doubanid"] = douban_id

        return {key: value for key, value in result.items() if value is not None}

    async def push_download(self, payload: dict[str, Any]) -> dict[str, Any]:
        mp_payload = self.build_download_payload(payload)
        client = self._create_client()
        try:
            response = await client.add_download(mp_payload)
        except MoviePilotClientError as exc:
            raise MoviePilotProviderError(str(exc)) from exc
        if isinstance(response, dict) and response.get("success") is False:
            raise MoviePilotProviderError(str(response.get("message") or "MoviePilot 添加下载失败"))
        return response

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
        result = await db.execute(
            select(Subscription)
            .where(
                or_(*filters),
                or_(
                    Subscription.provider == "moviepilot",
                    Subscription.external_system == "moviepilot",
                ),
            )
            .limit(1)
        )
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

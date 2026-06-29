from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import MediaType, Subscription
from app.services.anirss_client import AniRssClient, AniRssClientError
from app.services.runtime_settings_service import runtime_settings_service


class AniRssProviderError(RuntimeError):
    """ANI-RSS Provider 业务错误。"""


class AniRssProviderService:
    def __init__(self, client_factory: Callable[[], Any] | None = None) -> None:
        self._client_factory = client_factory

    def _create_client(self) -> AniRssClient:
        if self._client_factory:
            return self._client_factory()
        return AniRssClient(
            base_url=runtime_settings_service.get_anirss_base_url(),
            api_key=runtime_settings_service.get_anirss_api_key(),
        )

    async def list_subscriptions(self) -> dict[str, Any]:
        client = self._create_client()
        return await client.list_ani()

    async def health(self) -> dict[str, Any]:
        data = await self.list_subscriptions()
        return {"ok": True, "total": int(data.get("total") or 0), "data": data}

    async def build_ani_from_rss(self, payload: dict[str, Any]) -> dict[str, Any]:
        client = self._create_client()
        return await client.rss_to_ani(self._build_rss_payload(payload))

    async def preview_subscription(self, payload: dict[str, Any]) -> dict[str, Any]:
        client = self._create_client()
        ani = await client.rss_to_ani(self._build_rss_payload(payload))
        self._apply_payload_overrides(ani, payload)
        preview = await client.preview_ani(ani)
        return {"ani": ani, "preview": preview}

    async def refresh_subscription(self, external_subscription_id: str) -> dict[str, Any]:
        client = self._create_client()
        return await client.refresh_ani(str(external_subscription_id))

    async def set_subscription_enabled(
        self,
        external_subscription_id: str,
        enabled: bool,
    ) -> dict[str, Any]:
        client = self._create_client()
        subscriptions = await client.list_ani()
        ani = self._find_ani_in_list(subscriptions, str(external_subscription_id))
        if ani is None:
            raise AniRssProviderError("ANI-RSS 订阅不存在")
        ani = dict(ani)
        ani["enable"] = bool(enabled)
        response = await client.set_ani(ani, move=False)
        return {"ok": True, "enable": bool(enabled), "ani": ani, "response": response}

    async def create_subscription(
        self,
        db: AsyncSession,
        payload: dict[str, Any],
    ) -> Subscription:
        client = self._create_client()
        ani = await client.rss_to_ani(self._build_rss_payload(payload))
        self._apply_payload_overrides(ani, payload)
        try:
            response = await client.add_ani(ani)
        except AniRssClientError as exc:
            raise AniRssProviderError(str(exc)) from exc

        if isinstance(response, dict) and int(response.get("code") or 200) >= 400:
            raise AniRssProviderError(str(response.get("message") or "ANI-RSS 创建订阅失败"))

        external_id = str(ani.get("id") or "").strip()
        if not external_id:
            raise AniRssProviderError("ANI-RSS 订阅未返回 ID")

        subscription = await self._find_existing_subscription(db, external_id, payload)
        if subscription is None:
            subscription = Subscription(
                title=str(ani.get("title") or payload.get("title") or "").strip(),
                media_type=MediaType.TV,
                poster_path=str(ani.get("image") or payload.get("poster_path") or "").strip() or None,
                overview=str(payload.get("overview") or "").strip() or None,
                year=self._extract_year(ani, payload),
                rating=payload.get("rating"),
                auto_download=bool(payload.get("auto_download", True)),
                tv_scope="all",
                tv_follow_mode="missing",
            )
            db.add(subscription)

        subscription.provider = "anirss"
        subscription.external_system = "anirss"
        subscription.external_subscription_id = external_id
        subscription.external_status = "created"
        await db.commit()
        await db.refresh(subscription)
        return subscription

    @staticmethod
    def _build_rss_payload(payload: dict[str, Any]) -> dict[str, Any]:
        rss_url = str(payload.get("rss_url") or payload.get("url") or "").strip()
        bgm_url = str(payload.get("bgm_url") or "").strip()
        bangumi_id = str(payload.get("bangumi_id") or "").strip()
        if not bgm_url and bangumi_id:
            bgm_url = f"https://bgm.tv/subject/{bangumi_id}"
        return {
            "url": rss_url,
            "type": str(payload.get("rss_type") or payload.get("type") or "mikan").strip() or "mikan",
            "bgmUrl": bgm_url,
            "subgroup": str(payload.get("subgroup") or "").strip() or None,
            "enable": bool(payload.get("enable", True)),
        }

    @staticmethod
    def _apply_payload_overrides(ani: dict[str, Any], payload: dict[str, Any]) -> None:
        if payload.get("title"):
            ani["title"] = str(payload["title"]).strip()
        if payload.get("download_path"):
            ani["customDownloadPath"] = True
            ani["downloadPath"] = AniRssProviderService._expand_download_path(
                str(payload["download_path"]).strip(),
                payload,
            )
        if payload.get("season") is not None:
            ani["season"] = int(payload["season"])
        if payload.get("enable") is not None:
            ani["enable"] = bool(payload.get("enable"))

    @staticmethod
    def _sanitize_path_segment(value: Any) -> str:
        cleaned = re.sub(r'[\\/:*?"<>|]+', " ", str(value or ""))
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or "未命名"

    @staticmethod
    def _expand_download_path(path: str, payload: dict[str, Any]) -> str:
        try:
            season = max(1, int(payload.get("season") or 1))
        except Exception:
            season = 1
        title = AniRssProviderService._sanitize_path_segment(payload.get("title"))
        year = str(payload.get("year") or "").strip()
        bangumi_id = str(payload.get("bangumi_id") or "").strip()
        replacements = {
            "title": title,
            "title_cn": title,
            "title_jp": title,
            "year": year,
            "season": str(season),
            "season2": str(season).zfill(2),
            "bangumiId": bangumi_id,
        }
        return re.sub(
            r"\$\{(title|title_cn|title_jp|year|season|season2|bangumiId)\}",
            lambda match: replacements.get(match.group(1), ""),
            path,
        ).strip()

    @staticmethod
    def _extract_year(ani: dict[str, Any], payload: dict[str, Any]) -> str | None:
        if payload.get("year"):
            return str(payload.get("year"))
        release_date = str(ani.get("releaseDate") or "").strip()
        return release_date[:4] if len(release_date) >= 4 else None

    @staticmethod
    def _find_ani_in_list(data: dict[str, Any], external_subscription_id: str) -> dict[str, Any] | None:
        target_id = str(external_subscription_id or "").strip()
        if not target_id:
            return None
        if isinstance(data.get("items"), list):
            for item in data["items"]:
                if isinstance(item, dict) and str(item.get("id") or "").strip() == target_id:
                    return item
        if isinstance(data.get("weekList"), list):
            for week in data["weekList"]:
                items = week.get("items") if isinstance(week, dict) else None
                if not isinstance(items, list):
                    continue
                for item in items:
                    if isinstance(item, dict) and str(item.get("id") or "").strip() == target_id:
                        return item
        return None

    async def _find_existing_subscription(
        self,
        db: AsyncSession,
        external_id: str,
        payload: dict[str, Any],
    ) -> Subscription | None:
        filters = [
            or_(
                Subscription.provider == "anirss",
                Subscription.external_system == "anirss",
            ),
            Subscription.external_subscription_id == external_id,
        ]
        result = await db.execute(select(Subscription).where(*filters).limit(1))
        existing = result.scalar_one_or_none()
        if existing:
            return existing

        title = str(payload.get("title") or "").strip()
        if title:
            result = await db.execute(
                select(Subscription)
                .where(
                    Subscription.title == title,
                    or_(
                        Subscription.provider == "anirss",
                        Subscription.external_system == "anirss",
                    ),
                )
                .limit(1)
            )
            return result.scalar_one_or_none()
        return None


anirss_provider_service = AniRssProviderService()

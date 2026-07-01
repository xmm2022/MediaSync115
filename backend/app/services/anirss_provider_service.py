from __future__ import annotations

import asyncio
import re
import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import delete as sa_delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    DownloadRecord,
    MediaType,
    MoviePilotCompletionRecord,
    Subscription,
    SubscriptionSource,
    SubscriptionSourceFile,
)
from app.services.anirss_client import AniRssClient, AniRssClientError
from app.services.runtime_settings_service import runtime_settings_service


class AniRssProviderError(RuntimeError):
    """ANI-RSS Provider 业务错误。"""


class AniRssProviderService:
    LOG_PATH = Path("data/ani-rss/config/logs/ani-rss.log")
    CONFIG_PATH = Path("data/ani-rss/config/config.v2.json")
    DEFAULT_DOWNLOAD_CLIENT = {
        "downloadToolType": "qBittorrent",
        "downloadToolHost": "http://qbittorrent:8080",
        "downloadToolUsername": "admin",
        "downloadToolPassword": "mediasync-docker-whitelist",
        "qbUseDownloadPath": True,
        "rss": True,
        "downloadNew": False,
        "autoStart": False,
    }

    def __init__(self, client_factory: Callable[[], Any] | None = None) -> None:
        self._client_factory = client_factory

    def _create_client(self) -> AniRssClient:
        if self._client_factory:
            return self._client_factory()
        return AniRssClient(
            base_url=runtime_settings_service.get_anirss_base_url(),
            api_key=runtime_settings_service.get_anirss_api_key(),
        )

    async def list_subscriptions(
        self,
        db: AsyncSession | None = None,
        *,
        include_preview: bool = False,
        preview_limit: int = 5,
    ) -> dict[str, Any]:
        client = self._create_client()
        data = await client.list_ani()
        if not isinstance(data, dict):
            data = {}

        remote_items = self._flatten_ani_items(data)
        local_by_external: dict[str, Subscription] = {}
        local_subscriptions: list[Subscription] = []
        if db is not None:
            result = await db.execute(
                select(Subscription).where(
                    or_(
                        Subscription.provider == "anirss",
                        Subscription.external_system == "anirss",
                    )
                )
            )
            local_subscriptions = list(result.scalars().all())
            local_by_external = {
                str(sub.external_subscription_id or "").strip(): sub
                for sub in local_subscriptions
                if str(sub.external_subscription_id or "").strip()
            }

        log_lines = self._read_recent_log_lines()
        normalized_items: list[dict[str, Any]] = []
        dirty = False
        seen_external_ids: set[str] = set()

        for ani in remote_items:
            external_id = str(ani.get("id") or "").strip()
            if external_id:
                seen_external_ids.add(external_id)
            preview_summary: dict[str, Any] | None = None
            preview_error: str | None = None
            if include_preview:
                try:
                    preview_summary = self._summarize_preview(
                        await client.preview_ani(dict(ani)),
                        item_limit=preview_limit,
                    )
                except Exception as exc:
                    preview_error = f"预览同步失败：{exc}"

            item = self._normalize_ani_item(
                ani,
                local_subscription=local_by_external.get(external_id),
                log_lines=log_lines,
                preview_summary=preview_summary,
                preview_error=preview_error,
            )
            normalized_items.append(item)
            if db is not None and external_id in local_by_external:
                dirty = self._sync_local_subscription_from_item(
                    local_by_external[external_id],
                    item,
                ) or dirty

        if db is not None:
            for sub in local_subscriptions:
                external_id = str(sub.external_subscription_id or "").strip()
                if external_id and external_id in seen_external_ids:
                    continue
                normalized_items.append(self._build_missing_local_item(sub))
                dirty = self._mark_local_subscription_missing(sub) or dirty
            if dirty:
                await db.commit()

        response = dict(data)
        response["items"] = normalized_items
        response["total"] = int(data.get("total") or len(normalized_items))
        response["sync"] = {
            "remote_count": len(remote_items),
            "local_count": len(local_subscriptions),
            "include_preview": bool(include_preview),
            "sync_local": db is not None,
            "updated_local": bool(dirty),
        }
        return response

    async def health(self) -> dict[str, Any]:
        data = await self.list_subscriptions()
        return {"ok": True, "total": int(data.get("total") or 0), "data": data}

    async def discover_anirss_rss_candidates(
        self,
        keyword: str,
        *,
        bangumi_id: str | int | None = None,
        air_date: str | None = None,
        limit: int = 48,
    ) -> dict[str, Any]:
        client = self._create_client()
        subject_id = str(bangumi_id or "").strip()
        cleaned_keyword = str(keyword or "").strip()
        max_items = max(1, min(int(limit), 120))

        source_tasks = [
            self._discover_mikan_rss_candidates(
                client,
                cleaned_keyword,
                bangumi_id=subject_id,
                air_date=air_date,
                limit=max_items,
            )
        ]
        if subject_id:
            source_tasks.extend(
                [
                    self._discover_anibt_rss_candidates(
                        client,
                        bangumi_id=subject_id,
                        limit=max_items,
                    ),
                    self._discover_anime_garden_rss_candidates(
                        client,
                        bangumi_id=subject_id,
                        limit=max_items,
                    ),
                ]
            )

        raw_results = await asyncio.gather(*source_tasks, return_exceptions=True)
        source_results: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        errors: list[str] = []
        queries: list[dict[str, Any]] = []

        for result in raw_results:
            if isinstance(result, Exception):
                errors.append(str(result) or "ANI-RSS RSS 候选获取失败")
                continue
            source_result = result if isinstance(result, dict) else {}
            source_results.append(
                {
                    "source": source_result.get("source"),
                    "matched": bool(source_result.get("matched")),
                    "candidate_count": len(source_result.get("candidates") or []),
                    "item_count": len(source_result.get("items") or []),
                    "queries": source_result.get("queries") or [],
                    "errors": source_result.get("errors") or [],
                }
            )
            candidates.extend(
                candidate
                for candidate in source_result.get("candidates") or []
                if isinstance(candidate, dict)
            )
            errors.extend(str(error) for error in source_result.get("errors") or [] if error)
            for query in source_result.get("queries") or []:
                if isinstance(query, dict):
                    queries.append(query)

        candidates = self._limit_candidates_by_source(
            self._dedupe_rss_candidates(candidates),
            max_items,
        )
        if not source_results and errors:
            raise AniRssProviderError(errors[0])

        return {
            "source": "anirss",
            "provider": "anirss",
            "discovery": "anirss-api",
            "sources": ["mikan", "ani-bt", "anime-garden"] if subject_id else ["mikan"],
            "keyword": keyword,
            "search_text": cleaned_keyword,
            "queries": queries,
            "base_url": client.base_url,
            "matched": bool(candidates) if subject_id else bool(candidates),
            "matched_source_count": len({str(candidate.get("source") or "") for candidate in candidates}),
            "source_results": source_results,
            "candidates": candidates,
            "errors": errors,
        }

    async def discover_mikan_rss_candidates(
        self,
        keyword: str,
        *,
        bangumi_id: str | int | None = None,
        air_date: str | None = None,
        limit: int = 24,
    ) -> dict[str, Any]:
        client = self._create_client()
        return await self._discover_mikan_rss_candidates(
            client,
            keyword,
            bangumi_id=bangumi_id,
            air_date=air_date,
            limit=limit,
        )

    async def _discover_mikan_rss_candidates(
        self,
        client: Any,
        keyword: str,
        *,
        bangumi_id: str | int | None = None,
        air_date: str | None = None,
        limit: int = 24,
    ) -> dict[str, Any]:
        subject_id = str(bangumi_id or "").strip()
        cleaned_keyword = str(keyword or "").strip()
        errors: list[str] = []
        queries: list[dict[str, Any]] = []
        if cleaned_keyword:
            queries.append({"text": cleaned_keyword, "season": {}, "scan_limit": 12})
        season = self._build_mikan_season_from_date(air_date)
        if subject_id and season:
            queries.append({"text": "", "season": season, "scan_limit": 80})
        if subject_id:
            queries.append({"text": "", "season": {}, "scan_limit": 80})
        if not queries:
            queries.append({"text": "", "season": {}, "scan_limit": 80})

        all_items: list[dict[str, Any]] = []
        exact_mikan_id: str | None = None
        candidates: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        max_items = max(1, min(int(limit), 80))
        executed_queries: list[dict[str, Any]] = []
        loop = asyncio.get_running_loop()
        deadline = loop.time() + 25
        timed_out = False

        def mark_timeout() -> None:
            nonlocal timed_out
            if not timed_out:
                errors.append("ANI-RSS 获取 Mikan 候选超时，已返回当前已匹配结果")
                timed_out = True

        for query in queries:
            remaining = deadline - loop.time()
            if remaining <= 0:
                mark_timeout()
                break
            text = str(query.get("text") or "")
            season_body = query.get("season") if isinstance(query.get("season"), dict) else {}
            try:
                data = await asyncio.wait_for(
                    client.mikan(text, season_body),
                    timeout=max(1, min(15, remaining)),
                )
            except asyncio.TimeoutError:
                mark_timeout()
                break
            items = self._flatten_mikan_items(data)
            all_items.extend(items)
            executed_queries.append({"text": text, "season": season_body, "items": len(items)})

            scan_limit = int(query.get("scan_limit") or 12)
            search_items = items[:scan_limit] if subject_id else items[:2]
            for item in search_items:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    mark_timeout()
                    break
                if not item:
                    continue
                groups = item.get("groups") if isinstance(item.get("groups"), list) else []
                if not groups and item.get("url"):
                    try:
                        groups = await asyncio.wait_for(
                            client.mikan_group(str(item.get("url") or "")),
                            timeout=max(1, min(10, remaining)),
                        )
                    except asyncio.TimeoutError:
                        mark_timeout()
                        groups = []
                    except AniRssClientError as exc:
                        errors.append(str(exc) or "ANI-RSS 获取 Mikan 字幕组失败")
                        groups = []
                if timed_out:
                    break
                for group in groups:
                    if not isinstance(group, dict):
                        continue
                    candidate = self._normalize_mikan_group_candidate(item, group)
                    if subject_id and str(candidate.get("bangumi_id") or "") != subject_id:
                        continue
                    rss_url = str(candidate.get("rss_url") or "").strip()
                    if not rss_url or rss_url in seen_urls:
                        continue
                    if exact_mikan_id is None:
                        exact_mikan_id = str(candidate.get("mikan_id") or "").strip() or None
                    seen_urls.add(rss_url)
                    candidates.append(candidate)
                    if len(candidates) >= max_items:
                        break
                if len(candidates) >= max_items:
                    break
            if timed_out:
                break
            if subject_id and candidates:
                break
            if len(candidates) >= max_items:
                break

        return {
            "source": "mikan",
            "provider": "anirss",
            "discovery": "anirss-api",
            "keyword": keyword,
            "search_text": cleaned_keyword,
            "queries": executed_queries,
            "base_url": client.base_url,
            "matched": bool(candidates) if subject_id else bool(candidates),
            "matched_mikan_id": exact_mikan_id,
            "items": self._dedupe_mikan_items(all_items),
            "candidates": candidates,
            "errors": errors,
        }

    async def _discover_anibt_rss_candidates(
        self,
        client: Any,
        *,
        bangumi_id: str | int | None = None,
        limit: int = 48,
    ) -> dict[str, Any]:
        subject_id = str(bangumi_id or "").strip()
        errors: list[str] = []
        queries: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        if not subject_id:
            return {
                "source": "ani-bt",
                "provider": "anirss",
                "discovery": "anirss-api",
                "matched": False,
                "queries": queries,
                "items": [],
                "candidates": candidates,
                "errors": errors,
            }

        bgm_url = f"https://bgm.tv/subject/{subject_id}"
        try:
            data = await asyncio.wait_for(
                client.ani_bt(season="", bgm_url=bgm_url),
                timeout=15,
            )
        except asyncio.TimeoutError:
            errors.append("ANI-RSS 获取 AniBT 番剧列表超时")
            data = {}
        except AniRssClientError as exc:
            errors.append(str(exc) or "ANI-RSS 获取 AniBT 番剧列表失败")
            data = {}

        items = self._flatten_anibt_items(data)
        queries.append({"source": "ani-bt", "bgm_url": bgm_url, "items": len(items)})
        matched_items = [item for item in items if str(item.get("bgmId") or "").strip() == subject_id]

        if matched_items:
            try:
                groups = await asyncio.wait_for(
                    client.ani_bt_group(subject_id),
                    timeout=10,
                )
            except asyncio.TimeoutError:
                errors.append("ANI-RSS 获取 AniBT 字幕组超时")
                groups = []
            except AniRssClientError as exc:
                errors.append(str(exc) or "ANI-RSS 获取 AniBT 字幕组失败")
                groups = []
            for group in groups[: max(1, min(int(limit), 120))]:
                if not isinstance(group, dict):
                    continue
                candidate = self._normalize_anibt_group_candidate(matched_items[0], group)
                if str(candidate.get("bangumi_id") or "") != subject_id:
                    continue
                if candidate.get("rss_url"):
                    candidates.append(candidate)

        return {
            "source": "ani-bt",
            "provider": "anirss",
            "discovery": "anirss-api",
            "matched": bool(candidates),
            "queries": queries,
            "items": matched_items,
            "candidates": candidates,
            "errors": errors,
        }

    async def _discover_anime_garden_rss_candidates(
        self,
        client: Any,
        *,
        bangumi_id: str | int | None = None,
        limit: int = 48,
    ) -> dict[str, Any]:
        subject_id = str(bangumi_id or "").strip()
        errors: list[str] = []
        queries: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        if not subject_id:
            return {
                "source": "anime-garden",
                "provider": "anirss",
                "discovery": "anirss-api",
                "matched": False,
                "queries": queries,
                "items": [],
                "candidates": candidates,
                "errors": errors,
            }

        bgm_url = f"https://bgm.tv/subject/{subject_id}"
        try:
            data = await asyncio.wait_for(
                client.anime_garden_list(bgm_url=bgm_url),
                timeout=15,
            )
        except asyncio.TimeoutError:
            errors.append("ANI-RSS 获取 AnimeGarden 番剧列表超时")
            data = []
        except AniRssClientError as exc:
            errors.append(str(exc) or "ANI-RSS 获取 AnimeGarden 番剧列表失败")
            data = []

        subjects = self._flatten_anime_garden_subjects(data)
        queries.append({"source": "anime-garden", "bgm_url": bgm_url, "items": len(subjects)})
        matched_subjects = [item for item in subjects if str(item.get("id") or "").strip() == subject_id]

        if matched_subjects:
            try:
                groups = await asyncio.wait_for(
                    client.anime_garden_group(subject_id),
                    timeout=10,
                )
            except asyncio.TimeoutError:
                errors.append("ANI-RSS 获取 AnimeGarden 字幕组超时")
                groups = []
            except AniRssClientError as exc:
                errors.append(str(exc) or "ANI-RSS 获取 AnimeGarden 字幕组失败")
                groups = []
            for group in groups[: max(1, min(int(limit), 120))]:
                if not isinstance(group, dict):
                    continue
                candidate = self._normalize_anime_garden_group_candidate(matched_subjects[0], group)
                if str(candidate.get("bangumi_id") or "") != subject_id:
                    continue
                if candidate.get("rss_url"):
                    candidates.append(candidate)

        return {
            "source": "anime-garden",
            "provider": "anirss",
            "discovery": "anirss-api",
            "matched": bool(candidates),
            "queries": queries,
            "items": matched_subjects,
            "candidates": candidates,
            "errors": errors,
        }

    async def download_client_status(self) -> dict[str, Any]:
        config = self._read_config()
        actual = self._extract_download_client_config(config)
        desired = dict(self.DEFAULT_DOWNLOAD_CLIENT)
        issues = self._collect_download_client_issues(actual, desired)
        qbittorrent = await self._check_qbittorrent(actual)

        if not qbittorrent.get("ok"):
            issues.append(str(qbittorrent.get("message") or "qBittorrent 无法连接"))

        unsafe_flags: list[str] = []
        if actual.get("download_new") is True:
            unsafe_flags.append("downloadNew=true")
        if actual.get("auto_start") is True:
            unsafe_flags.append("autoStart=true")

        return {
            "ok": not issues and not unsafe_flags,
            "ready": bool(qbittorrent.get("ok")) and not issues and not unsafe_flags,
            "config_path": str(self.CONFIG_PATH),
            "desired": self._sanitize_download_client_config(desired),
            "actual": actual,
            "qbittorrent": qbittorrent,
            "issues": issues,
            "unsafe_flags": unsafe_flags,
            "message": "ANI-RSS 下载器配置正常" if not issues and not unsafe_flags else "ANI-RSS 下载器配置需要处理",
        }

    async def apply_download_client_defaults(self) -> dict[str, Any]:
        config = self._read_config()
        before = self._extract_download_client_config(config)
        updated = dict(config)
        changed_fields: list[str] = []

        for key, value in self.DEFAULT_DOWNLOAD_CLIENT.items():
            if updated.get(key) != value:
                updated[key] = value
                changed_fields.append(key)

        if changed_fields:
            self._write_config(updated)

        status = await self.download_client_status()
        return {
            "ok": True,
            "changed": bool(changed_fields),
            "changed_fields": changed_fields,
            "before": before,
            "after": status.get("actual"),
            "status": status,
            "restart_required": bool(changed_fields),
            "message": (
                "已写入 ANI-RSS 下载器安全默认配置，重启 ANI-RSS 后完全生效"
                if changed_fields
                else "ANI-RSS 下载器配置已是安全默认值"
            ),
        }

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

    async def delete_subscription(
        self,
        external_subscription_id: str,
        db: AsyncSession | None = None,
    ) -> dict[str, Any]:
        external_id = str(external_subscription_id or "").strip()
        if not external_id:
            raise AniRssProviderError("ANI-RSS 订阅 ID 不能为空")

        client = self._create_client()
        subscriptions = await client.list_ani()
        ani = self._find_ani_in_list(subscriptions, external_id)
        if ani is None:
            raise AniRssProviderError("ANI-RSS 订阅不存在")

        response = await client.delete_ani([external_id], delete_files=False)
        deleted_local = False
        if db is not None:
            result = await db.execute(
                select(Subscription)
                .where(
                    or_(
                        Subscription.provider == "anirss",
                        Subscription.external_system == "anirss",
                    ),
                    Subscription.external_subscription_id == external_id,
                )
                .limit(1)
            )
            subscription = result.scalar_one_or_none()
            if subscription is not None:
                await self._delete_local_subscription_mirror(db, subscription.id)
                deleted_local = True

        return {
            "ok": True,
            "external_subscription_id": external_id,
            "deleted_local": deleted_local,
            "delete_files": False,
            "response": response,
        }

    async def preview_existing_subscription(
        self,
        external_subscription_id: str,
        *,
        preview_limit: int = 5,
    ) -> dict[str, Any]:
        client = self._create_client()
        subscriptions = await client.list_ani()
        ani = self._find_ani_in_list(subscriptions, str(external_subscription_id))
        if ani is None:
            raise AniRssProviderError("ANI-RSS 订阅不存在")
        preview = await client.preview_ani(dict(ani))
        preview_summary = self._summarize_preview(
            preview,
            item_limit=preview_limit,
        )
        item = self._normalize_ani_item(
            ani,
            log_lines=self._read_recent_log_lines(),
            preview_summary=preview_summary,
        )
        return {
            "ok": True,
            "external_subscription_id": str(external_subscription_id),
            "item": item,
            "summary": preview_summary,
            "preview": preview,
        }

    async def set_subscription_enabled(
        self,
        external_subscription_id: str,
        enabled: bool,
        db: AsyncSession | None = None,
    ) -> dict[str, Any]:
        client = self._create_client()
        subscriptions = await client.list_ani()
        ani = self._find_ani_in_list(subscriptions, str(external_subscription_id))
        if ani is None:
            raise AniRssProviderError("ANI-RSS 订阅不存在")
        ani = dict(ani)
        ani["enable"] = bool(enabled)
        response = await client.set_ani(ani, move=False)
        status = "tracking" if bool(enabled) else "paused"
        if db is not None:
            result = await db.execute(
                select(Subscription)
                .where(
                    or_(
                        Subscription.provider == "anirss",
                        Subscription.external_system == "anirss",
                    ),
                    Subscription.external_subscription_id == str(external_subscription_id),
                )
                .limit(1)
            )
            subscription = result.scalar_one_or_none()
            if subscription is not None:
                subscription.external_status = status
                subscription.is_active = bool(enabled)
                subscription.auto_download = False
                await db.commit()
        return {
            "ok": True,
            "enable": bool(enabled),
            "status": status,
            "ani": ani,
            "response": response,
        }

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
                is_active=bool(ani.get("enable")),
                auto_download=False,
                tv_scope="all",
                tv_follow_mode="missing",
            )
            db.add(subscription)

        subscription.provider = "anirss"
        subscription.external_system = "anirss"
        subscription.external_subscription_id = external_id
        subscription.external_status = "tracking" if bool(ani.get("enable")) else "paused"
        subscription.is_active = bool(ani.get("enable"))
        subscription.auto_download = False
        await db.commit()
        await db.refresh(subscription)
        return subscription

    @staticmethod
    async def _delete_local_subscription_mirror(db: AsyncSession, subscription_id: int) -> None:
        source_ids_result = await db.execute(
            select(SubscriptionSource.id).where(SubscriptionSource.subscription_id == subscription_id)
        )
        source_ids = list(source_ids_result.scalars().all())
        if source_ids:
            await db.execute(
                sa_delete(SubscriptionSourceFile).where(SubscriptionSourceFile.source_id.in_(source_ids))
            )
        await db.execute(sa_delete(SubscriptionSource).where(SubscriptionSource.subscription_id == subscription_id))
        await db.execute(sa_delete(DownloadRecord).where(DownloadRecord.subscription_id == subscription_id))
        await db.execute(
            sa_delete(MoviePilotCompletionRecord).where(
                MoviePilotCompletionRecord.subscription_id == subscription_id
            )
        )
        await db.execute(sa_delete(Subscription).where(Subscription.id == subscription_id))
        await db.commit()

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
            "enable": False,
        }

    @classmethod
    def _flatten_mikan_items(cls, data: dict[str, Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        weeks = data.get("weeks") if isinstance(data, dict) else []
        if isinstance(weeks, list):
            for week in weeks:
                if not isinstance(week, dict):
                    continue
                week_items = week.get("items")
                if not isinstance(week_items, list):
                    continue
                for item in week_items:
                    if isinstance(item, dict):
                        items.append(item)
        direct_items = data.get("items") if isinstance(data, dict) else []
        if isinstance(direct_items, list):
            for item in direct_items:
                if isinstance(item, dict):
                    items.append(item)

        return cls._dedupe_mikan_items(items)

    @staticmethod
    def _dedupe_mikan_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique_items: list[dict[str, Any]] = []
        for item in items:
            key = (
                str(item.get("url") or "").strip()
                or str(item.get("title") or "").strip()
            )
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            unique_items.append(item)
        return unique_items

    @staticmethod
    def _flatten_anibt_items(data: dict[str, Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        by_weekday = data.get("byWeekday") if isinstance(data, dict) else []
        if isinstance(by_weekday, list):
            for week in by_weekday:
                if not isinstance(week, dict):
                    continue
                animes = week.get("animes")
                if not isinstance(animes, list):
                    continue
                for item in animes:
                    if isinstance(item, dict):
                        items.append(item)
        direct_items = data.get("items") if isinstance(data, dict) else []
        if isinstance(direct_items, list):
            for item in direct_items:
                if isinstance(item, dict):
                    items.append(item)
        return AniRssProviderService._dedupe_items_by_key(items, ("bgmId", "animeId", "title"))

    @staticmethod
    def _flatten_anime_garden_subjects(data: Any) -> list[dict[str, Any]]:
        subjects: list[dict[str, Any]] = []
        weeks = data if isinstance(data, list) else data.get("items") if isinstance(data, dict) else []
        if isinstance(weeks, list):
            for week in weeks:
                if not isinstance(week, dict):
                    continue
                week_subjects = week.get("subjects")
                if isinstance(week_subjects, list):
                    for subject in week_subjects:
                        if isinstance(subject, dict):
                            subjects.append(subject)
                    continue
                if "id" in week and "name" in week:
                    subjects.append(week)
        return AniRssProviderService._dedupe_items_by_key(subjects, ("id", "name"))

    @staticmethod
    def _dedupe_items_by_key(items: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique_items: list[dict[str, Any]] = []
        for item in items:
            key = ""
            for key_name in keys:
                value = item.get(key_name)
                if isinstance(value, dict):
                    value = json.dumps(value, ensure_ascii=False, sort_keys=True)
                key = str(value or "").strip()
                if key:
                    break
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            unique_items.append(item)
        return unique_items

    @staticmethod
    def _dedupe_rss_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique_candidates: list[dict[str, Any]] = []
        for candidate in candidates:
            rss_url = str(candidate.get("rss_url") or "").strip()
            if not rss_url:
                continue
            if rss_url in seen:
                continue
            seen.add(rss_url)
            unique_candidates.append(candidate)
        return unique_candidates

    @staticmethod
    def _limit_candidates_by_source(candidates: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        max_items = max(1, int(limit))
        if len(candidates) <= max_items:
            return candidates
        source_order = ["mikan", "ani-bt", "anime-garden"]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for candidate in candidates:
            source = str(candidate.get("source") or "other")
            grouped.setdefault(source, []).append(candidate)
        ordered_sources = [source for source in source_order if source in grouped]
        ordered_sources.extend(source for source in grouped if source not in ordered_sources)

        limited: list[dict[str, Any]] = []
        while len(limited) < max_items and any(grouped.get(source) for source in ordered_sources):
            for source in ordered_sources:
                bucket = grouped.get(source) or []
                if not bucket:
                    continue
                limited.append(bucket.pop(0))
                if len(limited) >= max_items:
                    break
        return limited

    @staticmethod
    def _build_mikan_season_from_date(air_date: str | None) -> dict[str, Any]:
        match = re.match(r"^\s*(\d{4})-(\d{1,2})", str(air_date or ""))
        if not match:
            return {}
        year = int(match.group(1))
        month = int(match.group(2))
        if month <= 3:
            season = "冬"
        elif month <= 6:
            season = "春"
        elif month <= 9:
            season = "夏"
        else:
            season = "秋"
        return {"year": year, "season": season}

    @staticmethod
    def _extract_bangumi_subject_id(url: str) -> str:
        match = re.search(r"(?:bgm\.tv|bangumi\.tv)/subject/(\d+)", str(url or ""))
        return match.group(1) if match else ""

    @staticmethod
    def _extract_mikan_id(value: str) -> str:
        match = re.search(r"/Home/Bangumi/(\d+)", str(value or ""))
        if match:
            return match.group(1)
        match = re.search(r"[?&]bangumiId=([^&]+)", str(value or ""), flags=re.IGNORECASE)
        return match.group(1) if match else ""

    @classmethod
    def _normalize_mikan_group_candidate(
        cls,
        item: dict[str, Any],
        group: dict[str, Any],
    ) -> dict[str, Any]:
        rss_url = str(group.get("rss") or group.get("url") or "").strip()
        subgroup_id = str(group.get("subgroupId") or group.get("subgroup_id") or "").strip()
        if not subgroup_id:
            parsed = re.search(r"[?&]subgroupid=([^&]+)", rss_url, flags=re.IGNORECASE)
            subgroup_id = parsed.group(1) if parsed else ""
        bgm_url = str(group.get("bgmUrl") or group.get("bgm_url") or item.get("bgmUrl") or item.get("bgm_url") or "").strip()
        bangumi_id = cls._extract_bangumi_subject_id(bgm_url)
        mikan_id = cls._extract_mikan_id(str(item.get("url") or "")) or cls._extract_mikan_id(rss_url)
        return {
            "source": "mikan",
            "provider": "anirss",
            "mikan_id": mikan_id,
            "title": str(item.get("title") or "").strip(),
            "rss_url": rss_url,
            "rss_type": "mikan",
            "subgroup_id": subgroup_id or None,
            "subgroup": str(group.get("label") or group.get("name") or "").strip() or "全部字幕组",
            "mikan_url": str(item.get("url") or "").strip(),
            "bgm_url": bgm_url,
            "bangumi_id": bangumi_id or None,
            "update_day": str(group.get("updateDay") or group.get("update_day") or "").strip() or None,
            "group_regex": group.get("groupRegex") if isinstance(group.get("groupRegex"), dict) else None,
        }

    @staticmethod
    def _pick_anibt_title(item: dict[str, Any]) -> str:
        title = item.get("title")
        if isinstance(title, dict):
            for key in ("primary", "chinese", "chineseTraditional", "english", "romaji"):
                value = str(title.get(key) or "").strip()
                if value:
                    return value
        return str(title or item.get("name") or "").strip()

    @classmethod
    def _normalize_anibt_group_candidate(
        cls,
        item: dict[str, Any],
        group: dict[str, Any],
    ) -> dict[str, Any]:
        bgm_id = str(group.get("bgmId") or item.get("bgmId") or "").strip()
        rss_url = str(group.get("rss") or "").strip()
        return {
            "source": "ani-bt",
            "provider": "anirss",
            "source_id": bgm_id,
            "anibt_id": str(item.get("animeId") or "").strip() or None,
            "title": cls._pick_anibt_title(item),
            "rss_url": rss_url,
            "rss_type": "ani-bt",
            "subgroup_id": str(group.get("groupId") or group.get("slug") or "").strip() or None,
            "subgroup": str(group.get("name") or "").strip() or "全部字幕组",
            "source_url": f"https://anibt.net/anime/{bgm_id}" if bgm_id else None,
            "bgm_url": f"https://bgm.tv/subject/{bgm_id}" if bgm_id else "",
            "bangumi_id": bgm_id or None,
            "status": str(group.get("status") or "").strip() or None,
            "last_updated_at": group.get("lastUpdatedAt"),
            "group_regex": group.get("groupRegex") if isinstance(group.get("groupRegex"), dict) else None,
        }

    @classmethod
    def _normalize_anime_garden_group_candidate(
        cls,
        subject: dict[str, Any],
        group: dict[str, Any],
    ) -> dict[str, Any]:
        bgm_id = str(group.get("bgmId") or subject.get("id") or "").strip()
        rss_url = str(group.get("rss") or "").strip()
        return {
            "source": "anime-garden",
            "provider": "anirss",
            "source_id": bgm_id,
            "anime_garden_id": str(subject.get("id") or "").strip() or None,
            "title": str(subject.get("name") or "").strip(),
            "rss_url": rss_url,
            "rss_type": "anime-garden",
            "subgroup_id": str(group.get("id") or "").strip() or None,
            "subgroup": str(group.get("name") or "").strip() or "全部字幕组",
            "source_url": f"https://animes.garden/subject/{bgm_id}" if bgm_id else None,
            "bgm_url": f"https://bgm.tv/subject/{bgm_id}" if bgm_id else "",
            "bangumi_id": bgm_id or None,
            "last_updated_at": group.get("lastUpdatedAt"),
            "group_regex": group.get("groupRegex") if isinstance(group.get("groupRegex"), dict) else None,
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
        ani["enable"] = False

    @staticmethod
    def _sanitize_path_segment(value: Any) -> str:
        cleaned = re.sub(r'[\\/:*?"<>|]+', " ", str(value or ""))
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or "未命名"

    @staticmethod
    def _expand_download_path(path: str, payload: dict[str, Any]) -> str:
        title = AniRssProviderService._sanitize_path_segment(payload.get("title"))
        year = str(payload.get("year") or "").strip()
        bangumi_id = str(payload.get("bangumi_id") or "").strip()
        replacements = {
            "title": title,
            "title_cn": title,
            "title_jp": title,
            "year": year,
            "bangumiId": bangumi_id,
        }
        return re.sub(
            r"\$\{(title|title_cn|title_jp|year|bangumiId)\}",
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

    @staticmethod
    def _flatten_ani_items(data: dict[str, Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        raw_items = data.get("items")
        if isinstance(raw_items, list):
            items.extend(item for item in raw_items if isinstance(item, dict))
        raw_week_list = data.get("weekList")
        if isinstance(raw_week_list, list):
            for week in raw_week_list:
                week_items = week.get("items") if isinstance(week, dict) else None
                if isinstance(week_items, list):
                    items.extend(item for item in week_items if isinstance(item, dict))
        return items

    @classmethod
    def _normalize_ani_item(
        cls,
        ani: dict[str, Any],
        *,
        local_subscription: Subscription | None = None,
        log_lines: list[str] | None = None,
        preview_summary: dict[str, Any] | None = None,
        preview_error: str | None = None,
    ) -> dict[str, Any]:
        external_id = str(ani.get("id") or "").strip()
        enabled = bool(ani.get("enable"))
        recent_error = preview_error or cls._find_recent_error(ani, log_lines or [])
        status = cls._derive_status(enabled=enabled, recent_error=recent_error)
        current_episode = cls._to_int(ani.get("currentEpisodeNumber"))
        total_episodes = cls._to_int(ani.get("totalEpisodeNumber"))
        rss_url = str(ani.get("url") or "").strip()
        download_path = str(ani.get("downloadPath") or "").strip()
        custom_download_path = bool(ani.get("customDownloadPath"))
        preview_summary = preview_summary or {}
        matched_items = preview_summary.get("matched_items") or []
        duplicate_ignored_items = preview_summary.get("duplicate_ignored_items") or []

        item = {
            "id": external_id,
            "external_subscription_id": external_id,
            "local_subscription_id": getattr(local_subscription, "id", None),
            "title": str(ani.get("title") or "").strip(),
            "jp_title": str(ani.get("jpTitle") or "").strip() or None,
            "subgroup": str(ani.get("subgroup") or "").strip() or None,
            "enabled": enabled,
            "enable": enabled,
            "status": status,
            "status_text": cls._status_text(status),
            "current_episode": current_episode,
            "total_episodes": total_episodes,
            "currentEpisodeNumber": current_episode,
            "totalEpisodeNumber": total_episodes,
            "rss_url": rss_url,
            "url": rss_url,
            "bangumi_url": str(ani.get("bgmUrl") or "").strip() or None,
            "bgmUrl": str(ani.get("bgmUrl") or "").strip() or None,
            "download_path": download_path,
            "downloadPath": download_path,
            "custom_download_path": custom_download_path,
            "customDownloadPath": custom_download_path,
            "download_new": bool(ani.get("downloadNew")),
            "downloadNew": bool(ani.get("downloadNew")),
            "last_download_time": cls._to_int(ani.get("lastDownloadTime")),
            "lastDownloadTime": cls._to_int(ani.get("lastDownloadTime")),
            "image": str(ani.get("image") or "").strip() or None,
            "cover": str(ani.get("cover") or "").strip() or None,
            "completed": bool(ani.get("completed")),
            "matched_count": int(preview_summary.get("matched_count") or 0),
            "duplicate_ignored_count": int(preview_summary.get("duplicate_ignored_count") or 0),
            "matched_items": matched_items,
            "duplicate_ignored_items": duplicate_ignored_items,
            "preview_download_path": preview_summary.get("download_path"),
            "recent_hit": matched_items[0] if matched_items else None,
            "recent_error": recent_error,
            "local_external_status": getattr(local_subscription, "external_status", None),
            "raw": ani,
        }
        return item

    @staticmethod
    def _derive_status(*, enabled: bool, recent_error: str | None) -> str:
        if recent_error and enabled:
            return "error"
        return "tracking" if enabled else "paused"

    @staticmethod
    def _status_text(status: str) -> str:
        return {
            "tracking": "追新中",
            "paused": "暂停",
            "error": "错误",
            "missing": "外部不存在",
        }.get(status, "未知")

    @staticmethod
    def _to_int(value: Any) -> int | None:
        try:
            if value is None or value == "":
                return None
            return int(value)
        except Exception:
            return None

    @classmethod
    def _summarize_preview(
        cls,
        preview: dict[str, Any],
        *,
        item_limit: int = 5,
    ) -> dict[str, Any]:
        items = preview.get("items") if isinstance(preview, dict) else []
        omit_list = preview.get("omitList") if isinstance(preview, dict) else []
        if not isinstance(items, list):
            items = []
        if not isinstance(omit_list, list):
            omit_list = []
        limit = max(0, min(int(item_limit or 5), 20))
        return {
            "matched_count": len(items),
            "duplicate_ignored_count": len(omit_list),
            "download_path": preview.get("downloadPath") if isinstance(preview, dict) else None,
            "matched_items": [
                cls._summarize_preview_item(item) for item in items[:limit]
            ],
            "duplicate_ignored_items": [
                cls._summarize_preview_item(item) for item in omit_list[:limit]
            ],
        }

    @staticmethod
    def _summarize_preview_item(item: Any) -> dict[str, Any]:
        if isinstance(item, str):
            return {"title": item}
        if not isinstance(item, dict):
            return {"title": str(item)}

        episode = item.get("episode")
        if isinstance(episode, dict):
            episode_value = (
                episode.get("episode")
                or episode.get("episodeNumber")
                or episode.get("sort")
                or episode.get("name")
            )
        else:
            episode_value = episode

        title = str(
            item.get("title")
            or item.get("name")
            or item.get("episodeTitle")
            or item.get("reName")
            or item.get("torrent")
            or ""
        ).strip()
        return {
            "title": title,
            "episode": str(episode_value).strip() if episode_value is not None else None,
            "subgroup": str(item.get("subgroup") or "").strip() or None,
            "info_hash": str(item.get("infoHash") or "").strip() or None,
            "pub_date": str(item.get("pubDate") or "").strip() or None,
        }

    @classmethod
    def _read_recent_log_lines(cls, limit: int = 400) -> list[str]:
        try:
            lines = cls.LOG_PATH.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            return []
        return lines[-max(1, int(limit or 400)) :]

    @classmethod
    def _find_recent_error(cls, ani: dict[str, Any], log_lines: list[str]) -> str | None:
        title = str(ani.get("title") or "").strip()
        external_id = str(ani.get("id") or "").strip()
        rss_url = str(ani.get("url") or "").strip()
        tokens = [token for token in (title, external_id, rss_url) if token]
        generic_error: str | None = None

        for line in reversed(log_lines):
            if " WARN " not in line and " ERROR " not in line:
                continue
            normalized = cls._trim_log_line(line)
            if tokens and any(token in line for token in tokens):
                return normalized
            if generic_error is None:
                generic_error = normalized

        return generic_error if bool(ani.get("enable")) else None

    @staticmethod
    def _trim_log_line(line: str) -> str:
        text = str(line or "").strip()
        if " - " in text:
            text = text.split(" - ", 1)[1].strip()
        return text[:300]

    @staticmethod
    def _sync_local_subscription_from_item(
        subscription: Subscription,
        item: dict[str, Any],
    ) -> bool:
        changed = False
        updates = {
            "provider": "anirss",
            "external_system": "anirss",
            "external_subscription_id": str(item.get("external_subscription_id") or ""),
            "external_status": str(item.get("status") or "unknown"),
            "is_active": bool(item.get("enabled")),
            "auto_download": False,
        }
        for key, value in updates.items():
            if getattr(subscription, key) != value:
                setattr(subscription, key, value)
                changed = True
        return changed

    @staticmethod
    def _mark_local_subscription_missing(subscription: Subscription) -> bool:
        changed = False
        updates = {
            "external_status": "missing",
            "is_active": False,
            "auto_download": False,
        }
        for key, value in updates.items():
            if getattr(subscription, key) != value:
                setattr(subscription, key, value)
                changed = True
        return changed

    @staticmethod
    def _build_missing_local_item(subscription: Subscription) -> dict[str, Any]:
        external_id = str(subscription.external_subscription_id or "").strip()
        return {
            "id": external_id,
            "external_subscription_id": external_id,
            "local_subscription_id": subscription.id,
            "title": subscription.title,
            "enabled": False,
            "enable": False,
            "status": "missing",
            "status_text": "外部不存在",
            "current_episode": None,
            "total_episodes": None,
            "rss_url": "",
            "url": "",
            "download_path": "",
            "custom_download_path": False,
            "download_new": False,
            "matched_count": 0,
            "duplicate_ignored_count": 0,
            "matched_items": [],
            "duplicate_ignored_items": [],
            "recent_hit": None,
            "recent_error": "本地记录存在，但 ANI-RSS 外部订阅未返回",
            "local_external_status": subscription.external_status,
            "raw": None,
        }

    @classmethod
    def _read_config(cls) -> dict[str, Any]:
        try:
            payload = json.loads(cls.CONFIG_PATH.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise AniRssProviderError(f"ANI-RSS 配置文件不存在：{cls.CONFIG_PATH}") from exc
        except json.JSONDecodeError as exc:
            raise AniRssProviderError(f"ANI-RSS 配置文件不是有效 JSON：{exc}") from exc
        if not isinstance(payload, dict):
            raise AniRssProviderError("ANI-RSS 配置文件格式异常")
        return payload

    @classmethod
    def _write_config(cls, config: dict[str, Any]) -> None:
        cls.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        if cls.CONFIG_PATH.exists():
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            backup_path = cls.CONFIG_PATH.with_suffix(f".v2.{timestamp}.bak")
            backup_path.write_text(
                cls.CONFIG_PATH.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
        cls.CONFIG_PATH.write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    @classmethod
    def _extract_download_client_config(cls, config: dict[str, Any]) -> dict[str, Any]:
        password = str(config.get("downloadToolPassword") or "")
        return {
            "download_tool_type": str(config.get("downloadToolType") or "").strip(),
            "download_tool_host": str(config.get("downloadToolHost") or "").strip().rstrip("/"),
            "download_tool_username": str(config.get("downloadToolUsername") or "").strip(),
            "download_tool_password_configured": bool(password),
            "download_tool_password_matches_default": password == str(cls.DEFAULT_DOWNLOAD_CLIENT["downloadToolPassword"]),
            "qb_use_download_path": bool(config.get("qbUseDownloadPath")),
            "rss": bool(config.get("rss")),
            "download_new": bool(config.get("downloadNew")),
            "auto_start": bool(config.get("autoStart")),
            "download_count": cls._to_int(config.get("downloadCount")),
            "download_path_template": str(config.get("downloadPathTemplate") or "").strip(),
        }

    @classmethod
    def _sanitize_download_client_config(cls, config: dict[str, Any]) -> dict[str, Any]:
        return {
            "download_tool_type": str(config.get("downloadToolType") or ""),
            "download_tool_host": str(config.get("downloadToolHost") or ""),
            "download_tool_username": str(config.get("downloadToolUsername") or ""),
            "download_tool_password_configured": bool(config.get("downloadToolPassword")),
            "qb_use_download_path": bool(config.get("qbUseDownloadPath")),
            "rss": bool(config.get("rss")),
            "download_new": bool(config.get("downloadNew")),
            "auto_start": bool(config.get("autoStart")),
        }

    @staticmethod
    def _collect_download_client_issues(
        actual: dict[str, Any],
        desired: dict[str, Any],
    ) -> list[str]:
        issues: list[str] = []
        checks = [
            ("download_tool_type", "downloadToolType"),
            ("download_tool_host", "downloadToolHost"),
            ("download_tool_username", "downloadToolUsername"),
        ]
        for actual_key, desired_key in checks:
            if str(actual.get(actual_key) or "") != str(desired.get(desired_key) or ""):
                issues.append(f"{desired_key} 不一致")
        if not actual.get("download_tool_password_configured"):
            issues.append("downloadToolPassword 未配置")
        if not actual.get("download_tool_password_matches_default"):
            issues.append("downloadToolPassword 与项目默认值不一致")
        if actual.get("qb_use_download_path") is not True:
            issues.append("qbUseDownloadPath 未启用")
        if actual.get("rss") is not True:
            issues.append("rss 未启用")
        return issues

    @staticmethod
    async def _check_qbittorrent(actual: dict[str, Any]) -> dict[str, Any]:
        base_url = str(actual.get("download_tool_host") or "").strip().rstrip("/")
        username = str(actual.get("download_tool_username") or "").strip()
        password = str(actual.get("download_tool_password") or "")
        if not base_url:
            return {"ok": False, "message": "qBittorrent 地址未配置"}

        # 重新读取未脱敏密码，避免把密码暴露在 status payload 里。
        try:
            config = AniRssProviderService._read_config()
            password = str(config.get("downloadToolPassword") or "")
        except AniRssProviderError:
            password = ""

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                login_status: int | None = None
                if username or password:
                    login = await client.post(
                        f"{base_url}/api/v2/auth/login",
                        data={"username": username, "password": password},
                    )
                    login_status = login.status_code
                    if login.status_code >= 400:
                        return {
                            "ok": False,
                            "message": f"qBittorrent 登录失败：HTTP {login.status_code}",
                            "base_url": base_url,
                            "login_status": login_status,
                        }

                version_response = await client.get(f"{base_url}/api/v2/app/version")
                if version_response.status_code >= 400:
                    return {
                        "ok": False,
                        "message": f"qBittorrent 版本检测失败：HTTP {version_response.status_code}",
                        "base_url": base_url,
                        "login_status": login_status,
                    }
                torrents_response = await client.get(f"{base_url}/api/v2/torrents/info")
                torrent_count: int | None = None
                if torrents_response.status_code < 400:
                    torrents = torrents_response.json()
                    torrent_count = len(torrents) if isinstance(torrents, list) else None

                return {
                    "ok": True,
                    "message": "qBittorrent 连接正常",
                    "base_url": base_url,
                    "version": version_response.text.strip(),
                    "login_status": login_status,
                    "torrent_count": torrent_count,
                    "torrents_status": torrents_response.status_code,
                }
        except Exception as exc:
            return {
                "ok": False,
                "message": f"qBittorrent 请求失败：{exc}",
                "base_url": base_url,
            }

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
                    or_(
                        Subscription.external_subscription_id.is_(None),
                        Subscription.external_subscription_id == "",
                    ),
                )
                .limit(1)
            )
            return result.scalar_one_or_none()
        return None


anirss_provider_service = AniRssProviderService()

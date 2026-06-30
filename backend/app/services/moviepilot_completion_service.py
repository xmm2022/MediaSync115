from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import MediaType, MoviePilotCompletionRecord, Subscription
from app.services.moviepilot_provider_service import (
    MoviePilotProviderError,
    moviepilot_provider_service,
)
from app.services.tv_missing_service import tv_missing_service
from app.utils.name_parser import name_parser


class MoviePilotCompletionError(RuntimeError):
    """MoviePilot 缺集补齐业务错误。"""


@dataclass(frozen=True)
class MoviePilotEpisodeCandidate:
    season: int
    episode: int
    item: dict[str, Any]
    title: str
    resource_url: str
    resource_hash: str
    status: str
    reason: str = ""

    def to_payload(self) -> dict[str, Any]:
        return {
            "season_number": self.season,
            "episode_number": self.episode,
            "title": self.title,
            "resource_url": self.resource_url,
            "resource_hash": self.resource_hash,
            "status": self.status,
            "reason": self.reason,
            "item": self.item,
        }


class MoviePilotCompletionService:
    terminal_statuses = {"pushed", "processing"}

    async def preview_missing_completion(
        self,
        db: AsyncSession,
        subscription_id: int,
        *,
        refresh: bool = False,
        force: bool = False,
    ) -> dict[str, Any]:
        return await self._build_plan(
            db,
            subscription_id,
            refresh=refresh,
            force=force,
        )

    async def run_missing_completion(
        self,
        db: AsyncSession,
        subscription_id: int,
        *,
        refresh: bool = False,
        dry_run: bool = False,
        force: bool = False,
    ) -> dict[str, Any]:
        plan = await self._build_plan(
            db,
            subscription_id,
            refresh=refresh,
            force=force,
        )
        if dry_run:
            plan["dry_run"] = True
            return plan

        subscription = await self._get_moviepilot_tv_subscription(db, subscription_id)
        pushed: list[dict[str, Any]] = []
        failed: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []

        for item in plan.get("auto_push", []):
            if not isinstance(item, dict):
                continue
            candidate = MoviePilotEpisodeCandidate(
                season=int(item["season_number"]),
                episode=int(item["episode_number"]),
                item=dict(item.get("item") or {}),
                title=str(item.get("title") or ""),
                resource_url=str(item.get("resource_url") or ""),
                resource_hash=str(item.get("resource_hash") or ""),
                status="matched",
                reason=str(item.get("reason") or ""),
            )
            record, skipped_record = await self._claim_record_for_push(
                db,
                subscription=subscription,
                candidate=candidate,
                force=force,
            )
            if record is None:
                if skipped_record:
                    skipped.append(skipped_record)
                continue
            try:
                response = await moviepilot_provider_service.push_download(
                    {
                        "title": subscription.title,
                        "media_type": subscription.media_type,
                        "tmdb_id": subscription.tmdb_id,
                        "douban_id": subscription.douban_id,
                        "item": candidate.item,
                    }
                )
                record.status = "pushed"
                record.error_message = None
                record.updated_at = beijing_now()
                pushed.append({**candidate.to_payload(), "response": response})
            except Exception as exc:
                record.status = "failed"
                record.error_message = str(exc)
                record.updated_at = beijing_now()
                failed.append({**candidate.to_payload(), "error": str(exc)})
            await db.commit()

        for item in plan.get("no_match", []):
            if not isinstance(item, dict):
                continue
            await self._upsert_no_resource_record(
                db,
                subscription=subscription,
                season=int(item["season_number"]),
                episode=int(item["episode_number"]),
                status="no_match",
                error_message=str(item.get("reason") or "MoviePilot 搜索无明确匹配"),
            )

        for item in plan.get("ambiguous", []):
            if not isinstance(item, dict):
                continue
            candidate = MoviePilotEpisodeCandidate(
                season=int(item["season_number"]),
                episode=int(item["episode_number"]),
                item=dict(item.get("item") or {}),
                title=str(item.get("title") or ""),
                resource_url=str(item.get("resource_url") or ""),
                resource_hash=str(item.get("resource_hash") or ""),
                status="ambiguous",
                reason=str(item.get("reason") or "资源需要人工确认"),
            )
            await self._upsert_record(
                db,
                subscription=subscription,
                candidate=candidate,
                status="ambiguous",
                error_message=candidate.reason,
            )

        await db.commit()
        return {
            **plan,
            "dry_run": False,
            "pushed": pushed,
            "failed": failed,
            "skipped": skipped,
            "pushed_count": len(pushed),
            "failed_count": len(failed),
            "skipped_count": len(skipped),
        }

    async def _build_plan(
        self,
        db: AsyncSession,
        subscription_id: int,
        *,
        refresh: bool,
        force: bool,
    ) -> dict[str, Any]:
        subscription = await self._get_moviepilot_tv_subscription(db, subscription_id)
        missing_status = await tv_missing_service.get_tv_missing_status(
            int(subscription.tmdb_id),
            include_specials=bool(subscription.tv_include_specials),
            refresh=bool(refresh),
            season_number=subscription.tv_season_number
            if subscription.tv_scope in {"season", "episode_range"}
            else None,
            episode_start=subscription.tv_episode_start
            if subscription.tv_scope == "episode_range"
            else None,
            episode_end=subscription.tv_episode_end
            if subscription.tv_scope == "episode_range"
            else None,
            aired_only=subscription.tv_follow_mode == "new",
        )
        if str(missing_status.get("status") or "") != "ok":
            return {
                "subscription_id": subscription.id,
                "tmdb_id": subscription.tmdb_id,
                "title": subscription.title,
                "status": "missing_unavailable",
                "message": missing_status.get("message") or "缺集状态不可用",
                "missing_status": missing_status,
                "missing_episodes": [],
                "auto_push": [],
                "ambiguous": [],
                "no_match": [],
                "processed": [],
            }

        missing_pairs = self._extract_missing_pairs(missing_status)
        records = await self._load_records(db, int(subscription.id))
        processed = [
            self._record_payload(record)
            for record in records
            if not force and record.status in self.terminal_statuses
        ]
        terminal_pairs = {
            (int(record.season_number), int(record.episode_number))
            for record in records
            if not force and record.status in self.terminal_statuses
        }
        searchable_pairs = missing_pairs - terminal_pairs
        items = await moviepilot_provider_service.search_title(subscription.title)
        candidates = self.select_episode_candidates(
            items,
            missing_pairs=searchable_pairs,
            expected_title=subscription.title,
            tmdb_id=subscription.tmdb_id,
            douban_id=subscription.douban_id,
            year=subscription.year,
        )

        by_pair: dict[tuple[int, int], list[MoviePilotEpisodeCandidate]] = {}
        ambiguous: list[dict[str, Any]] = []
        for candidate in candidates:
            if candidate.status == "matched":
                by_pair.setdefault((candidate.season, candidate.episode), []).append(candidate)
            else:
                ambiguous.append(candidate.to_payload())

        auto_push: list[dict[str, Any]] = []
        no_match: list[dict[str, Any]] = []
        for season, episode in sorted(searchable_pairs):
            matches = by_pair.get((season, episode), [])
            if len(matches) == 1:
                auto_push.append(matches[0].to_payload())
            elif len(matches) > 1:
                for match in matches:
                    ambiguous.append(
                        {
                            **match.to_payload(),
                            "status": "ambiguous",
                            "reason": "同一缺集命中多个 MoviePilot 资源，需人工确认",
                        }
                    )
            else:
                no_match.append(
                    {
                        "season_number": season,
                        "episode_number": episode,
                        "status": "no_match",
                        "reason": "MoviePilot 搜索无明确单集匹配",
                    }
                )

        return {
            "subscription_id": subscription.id,
            "tmdb_id": subscription.tmdb_id,
            "title": subscription.title,
            "status": "ok",
            "message": "MoviePilot 缺集补齐预览完成",
            "missing_status": missing_status,
            "missing_episodes": [
                {"season_number": season, "episode_number": episode}
                for season, episode in sorted(missing_pairs)
            ],
            "auto_push": auto_push,
            "ambiguous": ambiguous,
            "no_match": no_match,
            "processed": processed,
            "counts": {
                "missing": len(missing_pairs),
                "auto_push": len(auto_push),
                "ambiguous": len(ambiguous),
                "no_match": len(no_match),
                "processed": len(processed),
            },
        }

    async def _get_moviepilot_tv_subscription(
        self,
        db: AsyncSession,
        subscription_id: int,
    ) -> Subscription:
        result = await db.execute(
            select(Subscription).where(Subscription.id == int(subscription_id))
        )
        subscription = result.scalar_one_or_none()
        if subscription is None:
            raise MoviePilotCompletionError("Subscription not found")
        if subscription.media_type != MediaType.TV:
            raise MoviePilotCompletionError("MoviePilot 缺集补齐仅支持电视剧订阅")
        if subscription.tmdb_id is None:
            raise MoviePilotCompletionError("缺少 TMDB ID，无法计算缺集")
        provider = str(subscription.provider or "").strip().lower()
        external_system = str(subscription.external_system or "").strip().lower()
        if provider != "moviepilot" and external_system != "moviepilot":
            raise MoviePilotCompletionError("该订阅不是 MoviePilot 订阅")
        return subscription

    async def _load_records(
        self,
        db: AsyncSession,
        subscription_id: int,
    ) -> list[MoviePilotCompletionRecord]:
        result = await db.execute(
            select(MoviePilotCompletionRecord).where(
                MoviePilotCompletionRecord.subscription_id == int(subscription_id)
            )
        )
        return list(result.scalars().all())

    async def _claim_record_for_push(
        self,
        db: AsyncSession,
        *,
        subscription: Subscription,
        candidate: MoviePilotEpisodeCandidate,
        force: bool = False,
    ) -> tuple[MoviePilotCompletionRecord | None, dict[str, Any] | None]:
        result = await db.execute(
            select(MoviePilotCompletionRecord)
            .where(
                MoviePilotCompletionRecord.subscription_id == int(subscription.id),
                MoviePilotCompletionRecord.season_number == int(candidate.season),
                MoviePilotCompletionRecord.episode_number == int(candidate.episode),
                MoviePilotCompletionRecord.resource_hash == candidate.resource_hash,
            )
            .limit(1)
        )
        record = result.scalar_one_or_none()
        if record is not None and not force and record.status in self.terminal_statuses:
            return None, self._record_payload(record)
        if record is None:
            record = MoviePilotCompletionRecord(
                subscription_id=int(subscription.id),
                tmdb_id=subscription.tmdb_id,
                season_number=int(candidate.season),
                episode_number=int(candidate.episode),
                resource_hash=candidate.resource_hash,
            )
            db.add(record)

        record.resource_title = candidate.title
        record.resource_url = candidate.resource_url
        record.status = "processing"
        record.error_message = None
        record.raw_item_json = self._json_dumps(candidate.item)
        record.updated_at = beijing_now()
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return None, {
                **candidate.to_payload(),
                "status": "processing",
                "reason": "已有并发补缺任务正在处理该资源",
            }
        return record, None

    async def _upsert_record(
        self,
        db: AsyncSession,
        *,
        subscription: Subscription,
        candidate: MoviePilotEpisodeCandidate,
        status: str,
        error_message: str | None = None,
    ) -> MoviePilotCompletionRecord:
        result = await db.execute(
            select(MoviePilotCompletionRecord)
            .where(
                MoviePilotCompletionRecord.subscription_id == int(subscription.id),
                MoviePilotCompletionRecord.season_number == int(candidate.season),
                MoviePilotCompletionRecord.episode_number == int(candidate.episode),
                MoviePilotCompletionRecord.resource_hash == candidate.resource_hash,
            )
            .limit(1)
        )
        record = result.scalar_one_or_none()
        if record is None:
            record = MoviePilotCompletionRecord(
                subscription_id=int(subscription.id),
                tmdb_id=subscription.tmdb_id,
                season_number=int(candidate.season),
                episode_number=int(candidate.episode),
                resource_hash=candidate.resource_hash,
            )
            db.add(record)

        record.resource_title = candidate.title
        record.resource_url = candidate.resource_url
        record.status = status
        record.error_message = error_message
        record.raw_item_json = self._json_dumps(candidate.item)
        record.updated_at = beijing_now()
        return record

    async def _upsert_no_resource_record(
        self,
        db: AsyncSession,
        *,
        subscription: Subscription,
        season: int,
        episode: int,
        status: str,
        error_message: str,
    ) -> MoviePilotCompletionRecord:
        resource_hash = f"no-resource:S{int(season):02d}E{int(episode):02d}"
        result = await db.execute(
            select(MoviePilotCompletionRecord)
            .where(
                MoviePilotCompletionRecord.subscription_id == int(subscription.id),
                MoviePilotCompletionRecord.season_number == int(season),
                MoviePilotCompletionRecord.episode_number == int(episode),
                MoviePilotCompletionRecord.resource_hash == resource_hash,
            )
            .limit(1)
        )
        record = result.scalar_one_or_none()
        if record is None:
            record = MoviePilotCompletionRecord(
                subscription_id=int(subscription.id),
                tmdb_id=subscription.tmdb_id,
                season_number=int(season),
                episode_number=int(episode),
                resource_hash=resource_hash,
            )
            db.add(record)
        record.status = status
        record.error_message = error_message
        record.resource_title = None
        record.resource_url = None
        record.raw_item_json = None
        record.updated_at = beijing_now()
        return record

    @staticmethod
    def select_episode_candidates(
        items: list[dict[str, Any]],
        *,
        missing_pairs: set[tuple[int, int]],
        expected_title: str | None = None,
        tmdb_id: int | None = None,
        douban_id: str | None = None,
        year: str | int | None = None,
    ) -> list[MoviePilotEpisodeCandidate]:
        candidates: list[MoviePilotEpisodeCandidate] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = MoviePilotCompletionService._extract_title(item)
            if not title:
                continue
            parsed = name_parser.parse_episode(title)
            if not parsed:
                continue
            season, episode = int(parsed[0]), int(parsed[1])
            if (season, episode) not in missing_pairs:
                continue
            resource_url = MoviePilotCompletionService._extract_resource_url(item)
            resource_hash = MoviePilotCompletionService._extract_resource_hash(
                item,
                title=title,
                resource_url=resource_url,
            )
            match_issue = MoviePilotCompletionService._subscription_match_issue(
                item,
                title=title,
                expected_title=expected_title,
                tmdb_id=tmdb_id,
                douban_id=douban_id,
                year=year,
            )
            if match_issue:
                candidates.append(
                    MoviePilotEpisodeCandidate(
                        season=season,
                        episode=episode,
                        item=item,
                        title=title,
                        resource_url=resource_url,
                        resource_hash=resource_hash,
                        status="ambiguous",
                        reason=match_issue,
                    )
                )
                continue
            if not resource_url:
                candidates.append(
                    MoviePilotEpisodeCandidate(
                        season=season,
                        episode=episode,
                        item=item,
                        title=title,
                        resource_url="",
                        resource_hash=resource_hash,
                        status="ambiguous",
                        reason="资源缺少可推送的种子下载链接",
                    )
                )
                continue
            if MoviePilotCompletionService._looks_like_pack_or_multi_episode(title):
                candidates.append(
                    MoviePilotEpisodeCandidate(
                        season=season,
                        episode=episode,
                        item=item,
                        title=title,
                        resource_url=resource_url,
                        resource_hash=resource_hash,
                        status="ambiguous",
                        reason="疑似季包、全集包或多集资源，需人工确认",
                    )
                )
                continue
            candidates.append(
                MoviePilotEpisodeCandidate(
                    season=season,
                    episode=episode,
                    item=item,
                    title=title,
                    resource_url=resource_url,
                    resource_hash=resource_hash,
                    status="matched",
                )
            )
        return candidates

    @staticmethod
    def _extract_missing_pairs(payload: dict[str, Any]) -> set[tuple[int, int]]:
        pairs: set[tuple[int, int]] = set()
        for pair in payload.get("missing_episodes") or []:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                pairs.add((int(pair[0]), int(pair[1])))
        return pairs

    @staticmethod
    def _extract_title(item: dict[str, Any]) -> str:
        torrent = item.get("torrent_info") if isinstance(item.get("torrent_info"), dict) else {}
        for key in ("title", "name", "torrent_name"):
            value = torrent.get(key) or item.get(key)
            text = str(value or "").strip()
            if text:
                return text
        return ""

    @staticmethod
    def _extract_resource_url(item: dict[str, Any]) -> str:
        torrent = item.get("torrent_info") if isinstance(item.get("torrent_info"), dict) else {}
        for key in ("enclosure", "torrent_url", "download_url", "url", "link"):
            value = torrent.get(key) or item.get(key)
            text = str(value or "").strip()
            if text:
                return text
        return ""

    @staticmethod
    def _extract_resource_hash(
        item: dict[str, Any],
        *,
        title: str,
        resource_url: str,
    ) -> str:
        torrent = item.get("torrent_info") if isinstance(item.get("torrent_info"), dict) else {}
        for key in ("hash", "download_hash", "info_hash", "hashString"):
            value = torrent.get(key) or item.get(key)
            text = str(value or "").strip()
            if text:
                return text
        fingerprint = f"{title}|{resource_url}"
        return hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()

    @staticmethod
    def _item_containers(item: dict[str, Any]) -> list[dict[str, Any]]:
        containers = [item]
        for key in ("media_info", "media", "meta_info", "torrent_info", "torrent"):
            value = item.get(key)
            if isinstance(value, dict):
                containers.append(value)
        return containers

    @staticmethod
    def _extract_nested_text(item: dict[str, Any], keys: tuple[str, ...]) -> str:
        for container in MoviePilotCompletionService._item_containers(item):
            for key in keys:
                value = container.get(key)
                text = str(value or "").strip()
                if text:
                    return text
        return ""

    @staticmethod
    def _normalize_identity(value: Any) -> str:
        text = str(value or "").strip()
        return text[:-2] if text.endswith(".0") and text[:-2].isdigit() else text

    @staticmethod
    def _normalize_year(value: Any) -> str:
        match = re.search(r"(19|20)\d{2}", str(value or ""))
        return match.group(0) if match else ""

    @staticmethod
    def _normalize_title_for_match(value: str) -> str:
        return re.sub(r"[\W_]+", "", str(value or "").lower(), flags=re.UNICODE)

    @staticmethod
    def _subscription_match_issue(
        item: dict[str, Any],
        *,
        title: str,
        expected_title: str | None,
        tmdb_id: int | None,
        douban_id: str | None,
        year: str | int | None,
    ) -> str:
        item_tmdb_id = MoviePilotCompletionService._extract_nested_text(
            item,
            ("tmdb_id", "tmdbid", "tmdbId"),
        )
        expected_tmdb_id = MoviePilotCompletionService._normalize_identity(tmdb_id)
        if item_tmdb_id and expected_tmdb_id:
            if MoviePilotCompletionService._normalize_identity(item_tmdb_id) != expected_tmdb_id:
                return "MoviePilot 资源 TMDB ID 与订阅不一致，需人工确认"
            return ""

        item_douban_id = MoviePilotCompletionService._extract_nested_text(
            item,
            ("douban_id", "doubanid", "doubanId"),
        )
        expected_douban_id = MoviePilotCompletionService._normalize_identity(douban_id)
        if item_douban_id and expected_douban_id:
            if MoviePilotCompletionService._normalize_identity(item_douban_id) != expected_douban_id:
                return "MoviePilot 资源 Douban ID 与订阅不一致，需人工确认"
            return ""

        normalized_expected_title = MoviePilotCompletionService._normalize_title_for_match(
            expected_title or ""
        )
        normalized_title = MoviePilotCompletionService._normalize_title_for_match(title)
        if normalized_expected_title and normalized_expected_title not in normalized_title:
            return "MoviePilot 资源标题与订阅标题不一致，需人工确认"

        expected_year = MoviePilotCompletionService._normalize_year(year)
        item_year = MoviePilotCompletionService._normalize_year(
            MoviePilotCompletionService._extract_nested_text(
                item,
                ("year", "release_year", "releaseYear", "begin_year", "beginYear"),
            )
        )
        if expected_year and item_year and expected_year != item_year:
            return "MoviePilot 资源年份与订阅年份不一致，需人工确认"

        return ""

    @staticmethod
    def _looks_like_pack_or_multi_episode(title: str) -> bool:
        text_value = str(title or "")
        lower = text_value.lower()
        if any(token in lower for token in ("complete", "season pack", "full season")):
            return True
        if any(token in text_value for token in ("全集", "全季", "整季", "季包")):
            return True
        if re.search(r"\bS\d{1,2}\b(?!\s*E)", text_value, re.IGNORECASE):
            return True
        if re.search(r"E(?:P)?\d{1,3}\s*(?:-|~|–|—|至|to)\s*E?(?:P)?\d{1,3}\b", text_value, re.IGNORECASE):
            return True
        if re.search(r"S\d{1,2}\s*E\d{1,3}\s*E\d{1,3}", text_value, re.IGNORECASE):
            return True
        if re.search(r"E(?:P)?\d{1,3}\s*(?:\+|&|,|，|、)\s*E?(?:P)?\d{1,3}", text_value, re.IGNORECASE):
            return True
        if re.search(r"第\s*\d{1,3}\s*[集话話]\s*(?:-|~|–|—|至|到|to)\s*第?\s*\d{1,3}\s*[集话話]?", text_value, re.IGNORECASE):
            return True
        if re.search(r"(?<!\d)\d{1,3}\s*(?:-|~|–|—|至|到)\s*\d{1,3}(?!\d)", text_value):
            return True
        if len(re.findall(r"S\d{1,2}\s*E\d{1,3}", text_value, re.IGNORECASE)) > 1:
            return True
        return False

    @staticmethod
    def _json_dumps(payload: Any) -> str:
        return json.dumps(payload, ensure_ascii=False, default=str)

    @staticmethod
    def _record_payload(record: MoviePilotCompletionRecord) -> dict[str, Any]:
        return {
            "id": record.id,
            "subscription_id": record.subscription_id,
            "tmdb_id": record.tmdb_id,
            "season_number": record.season_number,
            "episode_number": record.episode_number,
            "resource_title": record.resource_title,
            "resource_url": record.resource_url,
            "resource_hash": record.resource_hash,
            "status": record.status,
            "error_message": record.error_message,
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }


moviepilot_completion_service = MoviePilotCompletionService()

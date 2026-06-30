from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import (
    MediaType,
    Subscription,
    SubscriptionSource,
    SubscriptionSourceFile,
)
from app.services.pan115_service import Pan115Service
from app.utils.name_parser import name_parser


MANUAL_PAN115_SOURCE = "manual_pan115_share"
VIDEO_EXTENSIONS = (
    ".mp4",
    ".mkv",
    ".avi",
    ".rmvb",
    ".flv",
    ".ts",
    ".m2ts",
    ".mov",
    ".wmv",
    ".m4v",
    ".webm",
)


def _sanitize_receive_code(value: str | None) -> str:
    text = "".join(ch for ch in str(value or "").strip() if ch.isalnum())
    return text[:4] if len(text) >= 4 else ""


def _extract_receive_code_from_url(value: str) -> str:
    text = str(value or "").strip()
    try:
        parsed = urlparse(text)
        query = parse_qs(parsed.query)
        for key in ("password", "pwd", "receive_code"):
            raw = (query.get(key) or [""])[0]
            code = _sanitize_receive_code(raw)
            if code:
                return code
    except Exception:
        pass

    match = re.search(
        r"(?:提取码|提取碼|密码|密碼|password|pwd)\s*[:：=]?\s*([A-Za-z0-9]{4})",
        text,
        re.I,
    )
    return _sanitize_receive_code(match.group(1)) if match else ""


def is_video_filename(filename: str) -> bool:
    return str(filename or "").strip().lower().endswith(VIDEO_EXTENSIONS)


def _item_size(item: dict[str, Any]) -> int:
    try:
        return int(item.get("size") or item.get("file_size") or 0)
    except (TypeError, ValueError):
        return 0


def build_source_file_fingerprint(item: dict[str, Any]) -> str:
    fid = str(item.get("fid") or item.get("file_id") or "").strip()
    if fid:
        return f"fid:{fid}"
    name = str(item.get("name") or "").strip()
    return f"name:{name}|size:{_item_size(item)}"


def _item_file_id(item: dict[str, Any]) -> str:
    return str(item.get("fid") or item.get("file_id") or "").strip()


def normalize_selected_file_ids(value: Any) -> list[str]:
    if value is None:
        return []
    raw_items: list[Any]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            raw_items = parsed if isinstance(parsed, list) else [text]
        except Exception:
            raw_items = re.split(r"[,，\s]+", text)
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        raw_items = [value]
    selected = [str(item or "").strip() for item in raw_items]
    return list(dict.fromkeys(item for item in selected if item))


def encode_selected_file_ids(value: Any) -> str | None:
    selected = normalize_selected_file_ids(value)
    return json.dumps(selected, ensure_ascii=False) if selected else None


def decode_selected_file_ids(value: Any) -> list[str]:
    return normalize_selected_file_ids(value)


def select_missing_episode_files(
    files: list[dict[str, Any]],
    *,
    missing_episodes: set[tuple[int, int]],
    quality_filter: dict[str, Any] | None = None,
    selected_file_ids: set[str] | None = None,
) -> tuple[list[dict[str, Any]], int, int]:
    matched_candidates: dict[tuple[int, int], list[dict[str, Any]]] = {}
    parsed_count = 0
    unparsed_video_count = 0
    allowed_ids = {str(item).strip() for item in selected_file_ids or set() if str(item).strip()}
    for item in files:
        if not isinstance(item, dict):
            continue
        filename = str(item.get("name") or "").strip()
        fid = _item_file_id(item)
        if not filename or not fid:
            continue
        if allowed_ids and fid not in allowed_ids:
            continue
        if not is_video_filename(filename):
            continue
        parsed = name_parser.parse_episode(filename)
        if parsed:
            parsed_count += 1
            pair = (int(parsed[0]), int(parsed[1]))
            if pair in missing_episodes:
                matched_candidates.setdefault(pair, []).append(item)
            continue
        unparsed_video_count += 1

    selected: list[dict[str, Any]] = []
    for items in matched_candidates.values():
        if len(items) > 1:
            selected.append(
                Pan115Service.pick_best_video_file(items, quality_filter or {})
                or items[0]
            )
        else:
            selected.extend(items)
    return selected, parsed_count, unparsed_video_count


class SubscriptionSourceService:
    async def create_manual_pan115_source(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        share_url: str,
        receive_code: str = "",
        display_name: str = "",
        selected_file_ids: list[str] | None = None,
    ) -> SubscriptionSource:
        normalized_url = str(share_url or "").strip()
        if not normalized_url:
            raise ValueError("分享链接不能为空")

        pan_service = Pan115Service("")
        share_code = pan_service._extract_share_code(normalized_url)
        if not share_code:
            raise ValueError("无效的 115 分享链接")

        result = await db.execute(
            select(Subscription).where(Subscription.id == int(subscription_id))
        )
        subscription = result.scalar_one_or_none()
        if subscription is None:
            raise ValueError("订阅不存在")
        provider = str(getattr(subscription, "provider", "") or "mediasync115").strip()
        external_system = str(getattr(subscription, "external_system", "") or "").strip()
        if provider not in {"", "mediasync115"} or external_system not in {
            "",
            "mediasync115",
        }:
            raise ValueError("固定 115 来源仅支持 MediaSync115 订阅")

        final_receive_code = _sanitize_receive_code(
            receive_code
        ) or _extract_receive_code_from_url(normalized_url)
        source = SubscriptionSource(
            subscription_id=subscription.id,
            source_type=MANUAL_PAN115_SOURCE,
            display_name=str(display_name or "").strip() or subscription.title,
            share_url=normalized_url,
            receive_code=final_receive_code or None,
            selected_file_ids=encode_selected_file_ids(selected_file_ids),
            enabled=True,
            last_scan_status="never",
            last_transferred_count=0,
        )
        db.add(source)
        await db.flush()
        return source

    async def list_sources(
        self,
        db: AsyncSession,
        subscription_id: int,
    ) -> list[SubscriptionSource]:
        result = await db.execute(
            select(SubscriptionSource)
            .where(SubscriptionSource.subscription_id == int(subscription_id))
            .order_by(SubscriptionSource.created_at.desc())
        )
        return list(result.scalars().all())

    async def update_source_enabled(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        source_id: int,
        enabled: bool,
    ) -> SubscriptionSource:
        source = await self.get_source(
            db,
            subscription_id=subscription_id,
            source_id=source_id,
        )
        source.enabled = bool(enabled)
        source.updated_at = beijing_now()
        await db.flush()
        return source

    async def delete_source(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        source_id: int,
    ) -> None:
        source = await self.get_source(
            db,
            subscription_id=subscription_id,
            source_id=source_id,
        )
        await db.delete(source)
        await db.flush()

    async def scan_manual_pan115_source(
        self,
        db: AsyncSession,
        *,
        source: SubscriptionSource,
        subscription: Any,
        pan_service: Pan115Service,
        parent_folder_id: str,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if source.source_type != MANUAL_PAN115_SOURCE:
            raise ValueError("不支持的固定来源类型")
        if not source.enabled:
            return {"status": "skipped", "transferred_count": 0, "selected_count": 0}

        now = beijing_now()
        try:
            share_code = pan_service._extract_share_code(source.share_url)
            if not share_code:
                raise ValueError("无效的 115 分享链接")

            all_files = await pan_service.get_share_all_files_recursive(
                share_code,
                source.receive_code or "",
            )
            configured_file_ids = set(decode_selected_file_ids(source.selected_file_ids))
            for item in all_files:
                await self._upsert_source_file_state(
                    db,
                    source=source,
                    item=item,
                    status="seen",
                )

            if getattr(subscription, "media_type", None) == MediaType.MOVIE:
                if int(source.last_transferred_count or 0) > 0:
                    source.last_scanned_at = now
                    source.last_scan_status = "success"
                    source.last_error = None
                    source.updated_at = now
                    await db.flush()
                    return {
                        "status": "success",
                        "total_files": len(all_files),
                        "selected_count": 0,
                        "transferred_count": 0,
                        "skipped_reason": "already_transferred",
                    }

                if configured_file_ids:
                    selected_items = [
                        item
                        for item in all_files
                        if isinstance(item, dict)
                        and _item_file_id(item) in configured_file_ids
                        and is_video_filename(str(item.get("name") or ""))
                    ]
                else:
                    selected_items = pan_service._select_files_for_best_quality_transfer(
                        all_files,
                        quality_filter or {},
                    )
                selected_file_ids = list(
                    dict.fromkeys(
                        _item_file_id(item)
                        for item in selected_items
                        if _item_file_id(item)
                    )
                )
                if not selected_file_ids:
                    raise ValueError("分享中未找到可转存的视频文件")

                await pan_service.save_share_files_directly(
                    share_url=source.share_url,
                    file_ids=selected_file_ids,
                    parent_id=parent_folder_id,
                    receive_code=source.receive_code or "",
                )
                for item in selected_items:
                    await self._upsert_source_file_state(
                        db,
                        source=source,
                        item=item,
                        status="transferred",
                    )

                source.last_scanned_at = now
                source.last_scan_status = "success"
                source.last_error = None
                source.last_found_episode = None
                source.last_transferred_count = len(selected_file_ids)
                source.updated_at = now
                await db.flush()
                return {
                    "status": "success",
                    "total_files": len(all_files),
                    "selected_count": len(selected_file_ids),
                    "transferred_count": len(selected_file_ids),
                }

            selected_items, parsed_count, unparsed_video_count = (
                select_missing_episode_files(
                    all_files,
                    missing_episodes=missing_episodes,
                    quality_filter=quality_filter or {},
                    selected_file_ids=configured_file_ids,
                )
            )
            selected_file_ids = list(
                dict.fromkeys(
                    _item_file_id(item)
                    for item in selected_items
                    if _item_file_id(item)
                )
            )

            transferred_count = 0
            if selected_file_ids:
                await pan_service.save_share_files_directly(
                    share_url=source.share_url,
                    file_ids=selected_file_ids,
                    parent_id=parent_folder_id,
                    receive_code=source.receive_code or "",
                )
                transferred_count = len(selected_file_ids)
                for item in selected_items:
                    await self._upsert_source_file_state(
                        db,
                        source=source,
                        item=item,
                        status="transferred",
                    )

            parsed_pairs = []
            for item in all_files:
                parsed = name_parser.parse_episode(str(item.get("name") or ""))
                if parsed:
                    parsed_pairs.append((int(parsed[0]), int(parsed[1])))
            latest_pair = ""
            if parsed_pairs:
                season, episode = sorted(parsed_pairs)[-1]
                latest_pair = f"S{season:02d}E{episode:02d}"

            source.last_scanned_at = now
            source.last_scan_status = "success"
            source.last_error = None
            source.last_found_episode = latest_pair or None
            source.last_transferred_count = transferred_count
            source.updated_at = now
            await db.flush()
            return {
                "status": "success",
                "total_files": len(all_files),
                "parsed_count": parsed_count,
                "unparsed_video_count": unparsed_video_count,
                "selected_count": len(selected_file_ids),
                "transferred_count": transferred_count,
                "last_found_episode": latest_pair,
                "selected_file_ids_configured": len(configured_file_ids),
            }
        except Exception as exc:
            source.last_scanned_at = now
            source.last_scan_status = "failed"
            source.last_error = str(exc)
            source.last_transferred_count = 0
            source.updated_at = now
            await db.flush()
            raise

    async def _upsert_source_file_state(
        self,
        db: AsyncSession,
        *,
        source: SubscriptionSource,
        item: dict[str, Any],
        status: str,
    ) -> None:
        filename = str(item.get("name") or "").strip()
        if not filename:
            return
        fingerprint = build_source_file_fingerprint(item)
        parsed = name_parser.parse_episode(filename)
        season_number = int(parsed[0]) if parsed else None
        episode_number = int(parsed[1]) if parsed else None
        result = await db.execute(
            select(SubscriptionSourceFile).where(
                SubscriptionSourceFile.source_id == source.id,
                SubscriptionSourceFile.fingerprint == fingerprint,
            )
        )
        row = result.scalar_one_or_none()
        now = beijing_now()
        if row is None:
            row = SubscriptionSourceFile(
                source_id=source.id,
                share_file_id=str(item.get("fid") or item.get("file_id") or "").strip()
                or None,
                file_name=filename,
                file_size=_item_size(item) or None,
                season_number=season_number,
                episode_number=episode_number,
                fingerprint=fingerprint,
                status=status,
                last_seen_at=now,
                transferred_at=now if status == "transferred" else None,
            )
            db.add(row)
            return
        row.file_name = filename
        row.file_size = _item_size(item) or None
        row.season_number = season_number
        row.episode_number = episode_number
        row.status = status
        row.last_seen_at = now
        if status == "transferred":
            row.transferred_at = now

    async def get_source(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        source_id: int,
    ) -> SubscriptionSource:
        result = await db.execute(
            select(SubscriptionSource).where(
                SubscriptionSource.id == int(source_id),
                SubscriptionSource.subscription_id == int(subscription_id),
            )
        )
        source = result.scalar_one_or_none()
        if source is None:
            raise ValueError("固定来源不存在")
        return source


subscription_source_service = SubscriptionSourceService()

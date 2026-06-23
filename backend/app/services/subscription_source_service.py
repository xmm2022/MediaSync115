from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone_utils import beijing_now
from app.models.models import MediaType, Subscription, SubscriptionSource
from app.services.pan115_service import Pan115Service


MANUAL_PAN115_SOURCE = "manual_pan115_share"


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


class SubscriptionSourceService:
    async def create_manual_pan115_source(
        self,
        db: AsyncSession,
        *,
        subscription_id: int,
        share_url: str,
        receive_code: str = "",
        display_name: str = "",
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
        if subscription.media_type != MediaType.TV:
            raise ValueError("固定来源仅支持电视剧订阅")

        final_receive_code = _sanitize_receive_code(
            receive_code
        ) or _extract_receive_code_from_url(normalized_url)
        source = SubscriptionSource(
            subscription_id=subscription.id,
            source_type=MANUAL_PAN115_SOURCE,
            display_name=str(display_name or "").strip() or subscription.title,
            share_url=normalized_url,
            receive_code=final_receive_code or None,
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

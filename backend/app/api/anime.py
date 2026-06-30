from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services.anirss_client import AniRssClientError
from app.services.anirss_provider_service import (
    AniRssProviderError,
    anirss_provider_service,
)
from app.services.bangumi_client import BangumiClientError, bangumi_client
from app.services.runtime_settings_service import runtime_settings_service


router = APIRouter(prefix="/anime", tags=["Anime"])


class AniRssSubscriptionPayload(BaseModel):
    rss_url: str
    rss_type: str = "mikan"
    bgm_url: Optional[str] = None
    bangumi_id: Optional[str] = None
    subgroup: Optional[str] = None
    title: Optional[str] = None
    poster_path: Optional[str] = None
    overview: Optional[str] = None
    year: Optional[str] = None
    rating: Optional[float] = None
    enable: bool = False
    auto_download: bool = True
    download_path: Optional[str] = None


class AniRssSubscriptionEnabledPayload(BaseModel):
    enable: bool


def _serialize_subscription(subscription: Any) -> dict[str, Any]:
    media_type = getattr(subscription, "media_type", None)
    return {
        "id": getattr(subscription, "id", None),
        "title": getattr(subscription, "title", None),
        "media_type": getattr(media_type, "value", str(media_type) if media_type else None),
        "provider": getattr(subscription, "provider", None),
        "external_system": getattr(subscription, "external_system", None),
        "external_subscription_id": getattr(subscription, "external_subscription_id", None),
        "external_status": getattr(subscription, "external_status", None),
    }


@router.get("/bangumi/search")
async def search_bangumi_anime(
    keyword: str = Query(..., min_length=1),
    limit: int = Query(12, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    try:
        return await bangumi_client.search_anime(keyword, limit=limit, offset=offset)
    except BangumiClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/bangumi/subjects/{subject_id}")
async def get_bangumi_subject(subject_id: int) -> dict[str, Any]:
    try:
        return await bangumi_client.get_subject(subject_id)
    except BangumiClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/mikan/rss-candidates")
async def get_mikan_rss_candidates(
    keyword: str = Query(..., min_length=1),
    bangumi_id: Optional[str] = Query(None),
    air_date: Optional[str] = Query(None),
    limit: int = Query(24, ge=1, le=80),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.discover_mikan_rss_candidates(
            keyword,
            bangumi_id=bangumi_id,
            air_date=air_date,
            limit=limit,
        )
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/anirss/rss-candidates")
async def get_anirss_rss_candidates(
    keyword: str = Query(..., min_length=1),
    bangumi_id: Optional[str] = Query(None),
    air_date: Optional[str] = Query(None),
    limit: int = Query(48, ge=1, le=120),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.discover_anirss_rss_candidates(
            keyword,
            bangumi_id=bangumi_id,
            air_date=air_date,
            limit=limit,
        )
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/anirss/config")
async def get_anirss_config() -> dict[str, Any]:
    return runtime_settings_service.get_anirss_config()


@router.get("/anirss/health")
async def check_anirss_health() -> dict[str, Any]:
    try:
        return await anirss_provider_service.health()
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/anirss/download-client/status")
async def get_anirss_download_client_status() -> dict[str, Any]:
    try:
        return await anirss_provider_service.download_client_status()
    except AniRssProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/anirss/download-client/apply-defaults")
async def apply_anirss_download_client_defaults() -> dict[str, Any]:
    try:
        return await anirss_provider_service.apply_download_client_defaults()
    except AniRssProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/anirss/subscriptions")
async def list_anirss_subscriptions(
    include_preview: bool = Query(True),
    preview_limit: int = Query(5, ge=0, le=20),
    sync_local: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.list_subscriptions(
            db if sync_local else None,
            include_preview=include_preview,
            preview_limit=preview_limit,
        )
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/anirss/subscriptions/sync")
async def sync_anirss_subscriptions(
    include_preview: bool = Query(True),
    preview_limit: int = Query(5, ge=0, le=20),
    sync_local: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.list_subscriptions(
            db if sync_local else None,
            include_preview=include_preview,
            preview_limit=preview_limit,
        )
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/anirss/preview")
async def preview_anirss_subscription(payload: AniRssSubscriptionPayload) -> dict[str, Any]:
    try:
        return await anirss_provider_service.preview_subscription(payload.model_dump())
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/anirss/subscriptions")
async def create_anirss_subscription(
    payload: AniRssSubscriptionPayload,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        subscription = await anirss_provider_service.create_subscription(
            db,
            payload.model_dump(),
        )
    except AniRssProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AniRssClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _serialize_subscription(subscription)


@router.post("/anirss/subscriptions/{external_subscription_id}/refresh")
async def refresh_anirss_subscription(external_subscription_id: str) -> dict[str, Any]:
    try:
        return await anirss_provider_service.refresh_subscription(external_subscription_id)
    except (AniRssClientError, AniRssProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/anirss/subscriptions/{external_subscription_id}/preview")
async def preview_existing_anirss_subscription(
    external_subscription_id: str,
    preview_limit: int = Query(5, ge=0, le=20),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.preview_existing_subscription(
            external_subscription_id,
            preview_limit=preview_limit,
        )
    except AniRssProviderError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AniRssClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/anirss/subscriptions/{external_subscription_id}")
async def delete_anirss_subscription(
    external_subscription_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.delete_subscription(external_subscription_id, db)
    except AniRssProviderError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AniRssClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/anirss/subscriptions/{external_subscription_id}/enabled")
async def set_anirss_subscription_enabled(
    external_subscription_id: str,
    payload: AniRssSubscriptionEnabledPayload,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await anirss_provider_service.set_subscription_enabled(
            external_subscription_id,
            payload.enable,
            db,
        )
    except AniRssProviderError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AniRssClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

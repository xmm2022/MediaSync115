from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import MediaType, Subscription
from app.services.moviepilot_client import MoviePilotClientError
from app.services.moviepilot_completion_service import (
    MoviePilotCompletionError,
    moviepilot_completion_service,
)
from app.services.moviepilot_provider_service import (
    MoviePilotProviderError,
    moviepilot_provider_service,
)
from app.services.runtime_settings_service import runtime_settings_service

router = APIRouter(prefix="/moviepilot", tags=["MoviePilot"])


class MoviePilotSearchRequest(BaseModel):
    keyword: str


class MoviePilotSubscriptionCreate(BaseModel):
    title: str
    media_type: MediaType
    tmdb_id: Optional[int] = None
    douban_id: Optional[str] = None
    poster_path: Optional[str] = None
    overview: Optional[str] = None
    year: Optional[str] = None
    rating: Optional[float] = None
    auto_download: bool = True
    tv_scope: str = "all"
    tv_season_number: Optional[int] = None
    tv_episode_start: Optional[int] = None
    tv_episode_end: Optional[int] = None
    tv_follow_mode: str = "missing"
    tv_include_specials: bool = False
    moviepilot_quality: Optional[str] = None
    moviepilot_resolution: Optional[str] = None
    moviepilot_include: Optional[str] = None
    moviepilot_exclude: Optional[str] = None
    moviepilot_save_path: Optional[str] = None


class MoviePilotDownloadCreate(BaseModel):
    item: dict[str, Any] | None = None
    torrent: dict[str, Any] | None = None
    torrent_info: dict[str, Any] | None = None
    media: dict[str, Any] | None = None
    media_info: dict[str, Any] | None = None
    title: Optional[str] = None
    media_type: Optional[MediaType] = None
    tmdb_id: Optional[int] = None
    douban_id: Optional[str] = None
    downloader: Optional[str] = None
    save_path: Optional[str] = None
    moviepilot_save_path: Optional[str] = None


class MoviePilotMissingCompletionRun(BaseModel):
    refresh: bool = False
    dry_run: bool = False
    force: bool = False


def _serialize_subscription(subscription: Any) -> dict[str, Any]:
    media_type = getattr(subscription, "media_type", None)
    if isinstance(media_type, MediaType):
        media_type_value = media_type.value
    else:
        media_type_value = str(media_type) if media_type is not None else None
    return {
        "id": getattr(subscription, "id", None),
        "title": getattr(subscription, "title", None),
        "media_type": media_type_value,
        "tmdb_id": getattr(subscription, "tmdb_id", None),
        "douban_id": getattr(subscription, "douban_id", None),
        "provider": getattr(subscription, "provider", None),
        "external_system": getattr(subscription, "external_system", None),
        "external_subscription_id": getattr(
            subscription, "external_subscription_id", None
        ),
        "external_status": getattr(subscription, "external_status", None),
    }


@router.get("/config")
async def get_moviepilot_config() -> dict[str, Any]:
    return runtime_settings_service.get_moviepilot_config()


@router.get("/health")
async def check_moviepilot_health() -> dict[str, Any]:
    try:
        items = await moviepilot_provider_service.list_subscribes()
        return {"ok": True, "subscription_count": len(items)}
    except (MoviePilotClientError, MoviePilotProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/search")
async def search_moviepilot_resources(
    payload: MoviePilotSearchRequest,
) -> dict[str, Any]:
    try:
        items = await moviepilot_provider_service.search_title(payload.keyword)
    except (MoviePilotClientError, MoviePilotProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"items": items}


@router.post("/subscriptions")
async def create_moviepilot_subscription(
    payload: MoviePilotSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        subscription = await moviepilot_provider_service.create_subscription(
            db,
            payload.model_dump(),
        )
    except MoviePilotProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_subscription(subscription)


@router.post("/downloads")
async def push_moviepilot_download(
    payload: MoviePilotDownloadCreate,
) -> dict[str, Any]:
    try:
        return await moviepilot_provider_service.push_download(payload.model_dump())
    except MoviePilotProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MoviePilotClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/subscriptions/sync")
async def sync_moviepilot_subscriptions(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await moviepilot_provider_service.sync_execution_state(db)
    except (MoviePilotClientError, MoviePilotProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/subscriptions/{external_subscription_id}/search")
async def search_moviepilot_subscription(
    external_subscription_id: int,
) -> dict[str, Any]:
    try:
        result = await moviepilot_provider_service.search_subscribe(
            external_subscription_id
        )
    except (MoviePilotClientError, MoviePilotProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"result": result}


@router.get("/subscriptions/{subscription_id}/missing-completion/preview")
async def preview_moviepilot_missing_completion(
    subscription_id: int,
    refresh: bool = False,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await moviepilot_completion_service.preview_missing_completion(
            db,
            subscription_id,
            refresh=bool(refresh),
            force=bool(force),
        )
    except MoviePilotCompletionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (MoviePilotClientError, MoviePilotProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/subscriptions/{subscription_id}/missing-completion/run")
async def run_moviepilot_missing_completion(
    subscription_id: int,
    payload: MoviePilotMissingCompletionRun,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        return await moviepilot_completion_service.run_missing_completion(
            db,
            subscription_id,
            refresh=bool(payload.refresh),
            dry_run=bool(payload.dry_run),
            force=bool(payload.force),
        )
    except MoviePilotCompletionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (MoviePilotClientError, MoviePilotProviderError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

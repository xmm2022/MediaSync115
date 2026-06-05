"""演职员关注 API。"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.subscriptions import sanitize_poster_path
from app.core.database import get_db
from app.models.person_follow import PersonFollow
from app.services.person_follow_service import (
    enrich_person_follow_from_tmdb,
    enrich_person_follows_batch,
    get_person_follow_feed,
    get_person_follow_status_map,
    run_person_follow_sync,
)
from app.services.tmdb_service import tmdb_service

router = APIRouter(tags=["演职员关注"])


class PersonFollowCreate(BaseModel):
    tmdb_person_id: int
    name: str = Field(..., min_length=1, max_length=255)
    profile_path: Optional[str] = None
    known_for_department: Optional[str] = None
    auto_subscribe_new_works: bool = True


class PersonFollowUpdate(BaseModel):
    auto_subscribe_new_works: Optional[bool] = None


class PersonFollowToggleRequest(BaseModel):
    tmdb_person_id: int
    name: Optional[str] = None
    profile_path: Optional[str] = None
    known_for_department: Optional[str] = None
    auto_subscribe_new_works: bool = True


def _serialize_follow(row: PersonFollow) -> dict[str, Any]:
    return {
        "id": row.id,
        "tmdb_person_id": row.tmdb_person_id,
        "name": row.name,
        "profile_path": row.profile_path,
        "known_for_department": row.known_for_department,
        "auto_subscribe_new_works": row.auto_subscribe_new_works,
        "last_checked_at": row.last_checked_at.isoformat() if row.last_checked_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _normalize_credits(payload: dict[str, Any]) -> list[dict[str, Any]]:
    cast_rows = payload.get("cast") if isinstance(payload.get("cast"), list) else []
    crew_rows = payload.get("crew") if isinstance(payload.get("crew"), list) else []
    seen: set[tuple[int, str]] = set()
    items: list[dict[str, Any]] = []

    for raw in [*cast_rows, *crew_rows]:
        if not isinstance(raw, dict):
            continue
        media_type = str(raw.get("media_type") or "").strip().lower()
        if media_type not in {"movie", "tv"}:
            continue
        tmdb_id = raw.get("id")
        if tmdb_id is None:
            continue
        try:
            tmdb_id = int(tmdb_id)
        except (TypeError, ValueError):
            continue
        key = (tmdb_id, media_type)
        if key in seen:
            continue
        seen.add(key)
        title = str(raw.get("title") or raw.get("name") or "").strip()
        items.append(
            {
                "tmdb_id": tmdb_id,
                "media_type": media_type,
                "title": title,
                "poster_path": raw.get("poster_path") or "",
                "vote_average": raw.get("vote_average"),
                "release_date": raw.get("release_date") or "",
                "first_air_date": raw.get("first_air_date") or "",
                "character": raw.get("character") or "",
                "job": raw.get("job") or "",
            }
        )

    def sort_key(item: dict[str, Any]) -> str:
        return str(item.get("release_date") or item.get("first_air_date") or "")

    items.sort(key=sort_key, reverse=True)
    return items


@router.get("/persons/{person_id}")
async def get_person_detail(person_id: int) -> dict[str, Any]:
    try:
        payload = await tmdb_service.get_person_detail(person_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    combined = payload.get("combined_credits")
    if not isinstance(combined, dict):
        combined = await tmdb_service.get_person_combined_credits(person_id)

    return {
        "id": payload.get("id") or person_id,
        "tmdb_person_id": payload.get("id") or person_id,
        "name": payload.get("name") or "",
        "biography": payload.get("biography") or "",
        "birthday": payload.get("birthday") or "",
        "deathday": payload.get("deathday") or "",
        "place_of_birth": payload.get("place_of_birth") or "",
        "profile_path": payload.get("profile_path") or "",
        "known_for_department": payload.get("known_for_department") or "",
        "also_known_as": payload.get("also_known_as") or [],
        "imdb_id": (payload.get("external_ids") or {}).get("imdb_id"),
        "credits": _normalize_credits(combined),
    }


person_follow_router = APIRouter(prefix="/person-follows", tags=["演职员关注"])


@person_follow_router.get("")
async def list_person_follows(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    result = await db.execute(
        select(PersonFollow).order_by(PersonFollow.created_at.desc())
    )
    rows = list(result.scalars().all())
    rows = await enrich_person_follows_batch(rows)
    return [_serialize_follow(row) for row in rows]


@person_follow_router.get("/status-map")
async def get_person_follow_status_map_endpoint() -> dict[str, Any]:
    return await get_person_follow_status_map()


@person_follow_router.get("/feed")
async def get_person_follow_feed_endpoint(
    limit: int = Query(30, ge=1, le=100),
) -> list[dict[str, Any]]:
    return await get_person_follow_feed(limit=limit)


@person_follow_router.post("")
async def create_person_follow(
    payload: PersonFollowCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    name = str(payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="姓名不能为空")

    follow = PersonFollow(
        tmdb_person_id=int(payload.tmdb_person_id),
        name=name,
        profile_path=sanitize_poster_path(payload.profile_path),
        known_for_department=str(payload.known_for_department or "").strip() or None,
        auto_subscribe_new_works=bool(payload.auto_subscribe_new_works),
    )
    db.add(follow)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="已关注该演职员")
    await db.refresh(follow)
    return _serialize_follow(follow)


@person_follow_router.post("/toggle")
async def toggle_person_follow(
    payload: PersonFollowToggleRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(
        select(PersonFollow)
        .where(PersonFollow.tmdb_person_id == int(payload.tmdb_person_id))
        .limit(1)
    )
    existing = result.scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()
        return {"followed": False, "message": "已取消关注"}

    name = str(payload.name or "").strip()
    if not name:
        try:
            detail = await tmdb_service.get_person_detail(int(payload.tmdb_person_id))
            name = str(detail.get("name") or "").strip()
        except Exception:
            name = ""
    if not name:
        raise HTTPException(status_code=400, detail="无法识别演职员姓名")

    profile_path = sanitize_poster_path(payload.profile_path)
    known_for_department = str(payload.known_for_department or "").strip() or None

    follow = PersonFollow(
        tmdb_person_id=int(payload.tmdb_person_id),
        name=name,
        profile_path=profile_path,
        known_for_department=known_for_department,
        auto_subscribe_new_works=bool(payload.auto_subscribe_new_works),
    )
    db.add(follow)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="已关注该演职员")
    await db.refresh(follow)
    follow = await enrich_person_follow_from_tmdb(follow)
    return {"followed": True, "item": _serialize_follow(follow)}


@person_follow_router.put("/{follow_id}")
async def update_person_follow(
    follow_id: int,
    payload: PersonFollowUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    follow = await db.get(PersonFollow, follow_id)
    if not follow:
        raise HTTPException(status_code=404, detail="关注记录不存在")
    if payload.auto_subscribe_new_works is not None:
        follow.auto_subscribe_new_works = bool(payload.auto_subscribe_new_works)
    await db.commit()
    await db.refresh(follow)
    return _serialize_follow(follow)


@person_follow_router.delete("/{follow_id}")
async def delete_person_follow(
    follow_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    follow = await db.get(PersonFollow, follow_id)
    if not follow:
        raise HTTPException(status_code=404, detail="关注记录不存在")
    await db.delete(follow)
    await db.commit()
    return {"success": True, "message": "已取消关注"}


@person_follow_router.post("/sync")
async def sync_person_follows() -> dict[str, Any]:
    return await run_person_follow_sync()

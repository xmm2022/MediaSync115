"""片单 API。"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.subscriptions import sanitize_poster_path
from app.core.database import get_db
from app.models.watchlist import Watchlist, WatchlistItem
from app.services.watchlist_import_service import (
    import_catalog_to_watchlist,
    import_tmdb_to_watchlist,
    list_import_catalog,
    preview_catalog_import,
    preview_tmdb_import,
)
from app.services.watchlist_service import (
    fill_watchlist_missing_subscriptions,
    get_watchlist_item_status_map,
)

router = APIRouter(prefix="/watchlists", tags=["片单"])


class WatchlistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    auto_fill_enabled: bool = False


class WatchlistUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None
    auto_fill_enabled: Optional[bool] = None


class WatchlistItemCreate(BaseModel):
    tmdb_id: int
    media_type: str
    title: str
    poster_path: Optional[str] = None
    year: Optional[str] = None
    rating: Optional[float] = None
    notes: Optional[str] = None


class WatchlistImportPreviewRequest(BaseModel):
    source_key: Optional[str] = Field(None, min_length=1)
    reference: Optional[str] = None
    source_type: Optional[str] = Field(None, min_length=1)


class WatchlistImportRequest(BaseModel):
    source_key: Optional[str] = Field(None, min_length=1)
    reference: Optional[str] = None
    source_type: Optional[str] = Field(None, min_length=1)
    watchlist_id: Optional[int] = None
    name: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = None
    auto_fill_enabled: bool = False


def _serialize_watchlist(row: Watchlist, *, item_count: int = 0) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "auto_fill_enabled": row.auto_fill_enabled,
        "item_count": item_count,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _serialize_item(row: WatchlistItem) -> dict[str, Any]:
    return {
        "id": row.id,
        "watchlist_id": row.watchlist_id,
        "tmdb_id": row.tmdb_id,
        "media_type": row.media_type,
        "title": row.title,
        "poster_path": row.poster_path,
        "year": row.year,
        "rating": row.rating,
        "notes": row.notes,
        "added_at": row.added_at.isoformat() if row.added_at else None,
    }


@router.get("")
async def list_watchlists(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    result = await db.execute(
        select(
            Watchlist,
            func.count(WatchlistItem.id).label("item_count"),
        )
        .outerjoin(WatchlistItem, WatchlistItem.watchlist_id == Watchlist.id)
        .group_by(Watchlist.id)
        .order_by(Watchlist.updated_at.desc())
    )
    rows = result.all()
    return [_serialize_watchlist(watchlist, item_count=int(count or 0)) for watchlist, count in rows]


@router.post("")
async def create_watchlist(
    payload: WatchlistCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    name = str(payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="片单名称不能为空")

    watchlist = Watchlist(
        name=name,
        description=str(payload.description or "").strip() or None,
        auto_fill_enabled=bool(payload.auto_fill_enabled),
    )
    db.add(watchlist)
    await db.commit()
    await db.refresh(watchlist)
    return _serialize_watchlist(watchlist, item_count=0)


@router.get("/status-map")
async def get_watchlist_status_map() -> dict[str, Any]:
    return await get_watchlist_item_status_map()


@router.get("/import/catalog")
async def get_watchlist_import_catalog() -> dict[str, Any]:
    return {"categories": list_import_catalog()}


@router.get("/import/sources")
async def get_watchlist_import_sources() -> dict[str, Any]:
    """兼容旧前端：返回预设目录。"""
    return {"categories": list_import_catalog()}


@router.post("/import/preview")
async def preview_watchlist_import(payload: WatchlistImportPreviewRequest) -> dict[str, Any]:
    try:
        if payload.source_key:
            preview = await preview_catalog_import(
                source_key=payload.source_key,
                reference=payload.reference,
            )
        elif payload.source_type and payload.reference:
            preview = await preview_tmdb_import(
                source_type=payload.source_type,
                reference=payload.reference,
            )
        else:
            raise ValueError("请选择导入来源，或填写 TMDB 链接")
        preview.pop("items", None)
        return preview
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import")
async def import_watchlist(
    payload: WatchlistImportRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        if payload.source_key:
            return await import_catalog_to_watchlist(
                db,
                source_key=payload.source_key,
                reference=payload.reference,
                watchlist_id=payload.watchlist_id,
                name=payload.name,
                description=payload.description,
                auto_fill_enabled=payload.auto_fill_enabled,
            )
        if payload.source_type and payload.reference:
            return await import_tmdb_to_watchlist(
                db,
                source_type=payload.source_type,
                reference=payload.reference,
                watchlist_id=payload.watchlist_id,
                name=payload.name,
                description=payload.description,
                auto_fill_enabled=payload.auto_fill_enabled,
            )
        raise ValueError("请选择导入来源，或填写 TMDB 链接")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{watchlist_id}")
async def get_watchlist(
    watchlist_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    watchlist = await db.get(Watchlist, watchlist_id)
    if not watchlist:
        raise HTTPException(status_code=404, detail="片单不存在")

    result = await db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.watchlist_id == watchlist_id)
        .order_by(WatchlistItem.added_at.desc())
    )
    items = list(result.scalars().all())
    data = _serialize_watchlist(watchlist, item_count=len(items))
    data["items"] = [_serialize_item(item) for item in items]
    return data


@router.put("/{watchlist_id}")
async def update_watchlist(
    watchlist_id: int,
    payload: WatchlistUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    watchlist = await db.get(Watchlist, watchlist_id)
    if not watchlist:
        raise HTTPException(status_code=404, detail="片单不存在")

    if payload.name is not None:
        name = str(payload.name).strip()
        if not name:
            raise HTTPException(status_code=400, detail="片单名称不能为空")
        watchlist.name = name
    if payload.description is not None:
        watchlist.description = str(payload.description).strip() or None
    if payload.auto_fill_enabled is not None:
        watchlist.auto_fill_enabled = bool(payload.auto_fill_enabled)

    await db.commit()
    await db.refresh(watchlist)
    count_result = await db.execute(
        select(func.count(WatchlistItem.id)).where(WatchlistItem.watchlist_id == watchlist_id)
    )
    item_count = int(count_result.scalar() or 0)
    return _serialize_watchlist(watchlist, item_count=item_count)


@router.delete("/{watchlist_id}")
async def delete_watchlist(
    watchlist_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    watchlist = await db.get(Watchlist, watchlist_id)
    if not watchlist:
        raise HTTPException(status_code=404, detail="片单不存在")
    await db.delete(watchlist)
    await db.commit()
    return {"success": True, "message": "片单已删除"}


@router.post("/{watchlist_id}/items")
async def add_watchlist_item(
    watchlist_id: int,
    payload: WatchlistItemCreate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    watchlist = await db.get(Watchlist, watchlist_id)
    if not watchlist:
        raise HTTPException(status_code=404, detail="片单不存在")

    media_type = str(payload.media_type or "").strip().lower()
    if media_type not in {"movie", "tv"}:
        raise HTTPException(status_code=400, detail="仅支持电影或电视剧")

    title = str(payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    item = WatchlistItem(
        watchlist_id=watchlist_id,
        tmdb_id=int(payload.tmdb_id),
        media_type=media_type,
        title=title,
        poster_path=sanitize_poster_path(payload.poster_path),
        year=str(payload.year or "").strip()[:4] or None,
        rating=payload.rating,
        notes=str(payload.notes or "").strip() or None,
    )
    db.add(item)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="该片单中已存在此条目")
    await db.refresh(item)
    return _serialize_item(item)


@router.delete("/{watchlist_id}/items/{item_id}")
async def delete_watchlist_item(
    watchlist_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(
        select(WatchlistItem)
        .where(WatchlistItem.id == item_id, WatchlistItem.watchlist_id == watchlist_id)
        .limit(1)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="片单条目不存在")
    await db.delete(item)
    await db.commit()
    return {"success": True, "message": "条目已移除"}


@router.post("/{watchlist_id}/fill")
async def fill_watchlist(watchlist_id: int) -> dict[str, Any]:
    result = await fill_watchlist_missing_subscriptions(watchlist_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message") or "补缺失败")
    return result

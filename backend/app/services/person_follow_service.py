"""演职员关注服务：新作检测与自动订阅。"""

import logging
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.database import async_session_maker
from app.core.timezone_utils import beijing_now
from app.models.models import MediaType
from app.models.person_follow import PersonFollow, PersonFollowCredit
from app.services.chart_subscription_service import _create_subscription_if_not_exists
from app.services.operation_log_service import operation_log_service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.tmdb_service import tmdb_service

logger = logging.getLogger(__name__)


def _sanitize_tmdb_image_path(raw_path: Any) -> str | None:
    value = str(raw_path or "").strip()
    if not value:
        return None
    if value.startswith("/"):
        return value[:500]
    return None


async def enrich_person_follow_from_tmdb(follow: PersonFollow) -> PersonFollow:
    """从 TMDB 补全演职员头像与部门信息，并写回数据库。"""
    needs_profile = not str(follow.profile_path or "").strip()
    needs_dept = not str(follow.known_for_department or "").strip()
    needs_name = not str(follow.name or "").strip()
    if not needs_profile and not needs_dept and not needs_name:
        return follow

    try:
        detail = await tmdb_service.get_person_detail(follow.tmdb_person_id)
    except Exception as exc:
        logger.debug("补全演职员资料失败: %s — %s", follow.tmdb_person_id, exc)
        return follow

    changed = False
    if needs_name:
        name = str(detail.get("name") or "").strip()
        if name:
            follow.name = name
            changed = True
    if needs_profile:
        profile_path = _sanitize_tmdb_image_path(detail.get("profile_path"))
        if profile_path:
            follow.profile_path = profile_path
            changed = True
    if needs_dept:
        department = str(detail.get("known_for_department") or "").strip()
        if department:
            follow.known_for_department = department
            changed = True

    if changed:
        follow.updated_at = beijing_now()
        async with async_session_maker() as db:
            row = await db.get(PersonFollow, follow.id)
            if row:
                row.name = follow.name
                row.profile_path = follow.profile_path
                row.known_for_department = follow.known_for_department
                row.updated_at = follow.updated_at
                await db.commit()
    return follow


async def enrich_person_follows_batch(follows: list[PersonFollow]) -> list[PersonFollow]:
    """批量补全缺失头像的演职员关注记录。"""
    enriched: list[PersonFollow] = []
    for follow in follows:
        if not str(follow.profile_path or "").strip():
            follow = await enrich_person_follow_from_tmdb(follow)
        enriched.append(follow)
    return enriched


def _normalize_media_type(raw: Any) -> str | None:
    value = str(raw or "").strip().lower()
    if value in {"movie", "tv"}:
        return value
    return None


def _extract_credit_date(raw: dict[str, Any]) -> str | None:
    for key in ("release_date", "first_air_date"):
        value = str(raw.get(key) or "").strip()
        if value:
            return value[:10]
    return None


def _extract_year(raw: dict[str, Any]) -> str | None:
    date_value = _extract_credit_date(raw)
    if date_value and len(date_value) >= 4:
        return date_value[:4]
    return None


def _beijing_today() -> date:
    return beijing_now().date()


def _parse_credit_date(credit_date: str | None) -> date | None:
    raw = str(credit_date or "").strip()[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def is_upcoming_credit(credit_date: str | None, *, ref_date: date | None = None) -> bool:
    """新作：上映/首播日期严格晚于当前日期（北京时间）。"""
    parsed = _parse_credit_date(credit_date)
    if parsed is None:
        return False
    today = ref_date or _beijing_today()
    return parsed > today


async def run_person_follow_sync() -> dict[str, Any]:
    """扫描关注的演职员，发现新作并按配置自动订阅。"""
    settings_data = runtime_settings_service.get_all()
    enabled = bool(settings_data.get("person_follow_enabled", False))
    if not enabled:
        await operation_log_service.log_background_event(
            source_type="background_task",
            module="person_follow",
            action="person_follow.skip",
            status="info",
            message="演职员关注同步未启用，跳过执行",
        )
        return {"success": True, "message": "演职员关注同步未启用", "skipped": True}

    global_auto_subscribe = bool(
        settings_data.get("person_follow_auto_subscribe", True)
    )

    async with async_session_maker() as db:
        result = await db.execute(select(PersonFollow).order_by(PersonFollow.id.asc()))
        follows = list(result.scalars().all())

    if not follows:
        return {"success": True, "message": "暂无关注的演职员", "skipped": True}

    total_new_credits = 0
    total_subscribed = 0
    total_failed = 0
    person_results: list[dict[str, Any]] = []

    for follow in follows:
        try:
            summary = await _sync_single_person(
                follow,
                global_auto_subscribe=global_auto_subscribe,
            )
            total_new_credits += summary["new_credits"]
            total_subscribed += summary["new_subscriptions"]
            total_failed += summary["failed"]
            person_results.append(summary)
        except Exception as exc:
            logger.exception("演职员同步失败: %s", follow.name)
            total_failed += 1
            person_results.append(
                {
                    "person_follow_id": follow.id,
                    "tmdb_person_id": follow.tmdb_person_id,
                    "name": follow.name,
                    "error": str(exc),
                }
            )

    message = (
        f"演职员关注同步完成：检查 {len(follows)} 人，"
        f"新作 {total_new_credits} 部，自动订阅 {total_subscribed} 部，失败 {total_failed}"
    )
    await operation_log_service.log_background_event(
        source_type="background_task",
        module="person_follow",
        action="person_follow.sync_done",
        status="success" if total_failed == 0 else "partial",
        message=message,
        extra={
            "checked": len(follows),
            "new_credits": total_new_credits,
            "new_subscriptions": total_subscribed,
            "failed": total_failed,
        },
    )
    return {
        "success": True,
        "message": message,
        "checked": len(follows),
        "new_credits": total_new_credits,
        "new_subscriptions": total_subscribed,
        "failed": total_failed,
        "person_results": person_results,
    }


async def _sync_single_person(
    follow: PersonFollow,
    *,
    global_auto_subscribe: bool,
) -> dict[str, Any]:
    """同步单个演职员的作品列表。"""
    payload = await tmdb_service.get_person_combined_credits(follow.tmdb_person_id)
    cast_rows = payload.get("cast") if isinstance(payload.get("cast"), list) else []
    crew_rows = payload.get("crew") if isinstance(payload.get("crew"), list) else []
    credit_rows = [*cast_rows, *crew_rows]

    known_keys: set[tuple[int, str]] = set()
    async with async_session_maker() as db:
        result = await db.execute(
            select(PersonFollowCredit).where(
                PersonFollowCredit.person_follow_id == follow.id
            )
        )
        for credit in result.scalars().all():
            known_keys.add((credit.tmdb_id, credit.media_type))

    new_credits = 0
    new_subscriptions = 0
    failed = 0
    now = beijing_now()

    for raw in credit_rows:
        if not isinstance(raw, dict):
            continue
        media_type = _normalize_media_type(raw.get("media_type"))
        tmdb_id = raw.get("id")
        if media_type is None or tmdb_id is None:
            continue
        try:
            tmdb_id = int(tmdb_id)
        except (TypeError, ValueError):
            continue

        key = (tmdb_id, media_type)
        if key in known_keys:
            continue

        title = str(raw.get("title") or raw.get("name") or "").strip() or f"TMDB {tmdb_id}"
        poster_path = str(raw.get("poster_path") or "").strip() or None
        credit_date = _extract_credit_date(raw)
        if not is_upcoming_credit(credit_date):
            continue
        year = _extract_year(raw)
        vote_average = raw.get("vote_average")
        rating = float(vote_average) if vote_average else None

        subscribed = False
        should_subscribe = follow.auto_subscribe_new_works and global_auto_subscribe
        if should_subscribe:
            media_enum = MediaType.TV if media_type == "tv" else MediaType.MOVIE
            try:
                created = await _create_subscription_if_not_exists(
                    tmdb_id=tmdb_id,
                    media_type=media_enum,
                    title=title,
                    year=year,
                    rating=rating,
                    overview="",
                    poster_path=poster_path,
                    douban_id=None,
                )
                subscribed = True
                if created:
                    new_subscriptions += 1
            except Exception as exc:
                logger.warning("演职员新作自动订阅失败: %s — %s", title, exc)
                failed += 1

        async with async_session_maker() as db:
            credit = PersonFollowCredit(
                person_follow_id=follow.id,
                tmdb_id=tmdb_id,
                media_type=media_type,
                title=title,
                poster_path=poster_path,
                credit_date=credit_date,
                subscribed=subscribed,
            )
            db.add(credit)
            try:
                await db.commit()
                known_keys.add(key)
                new_credits += 1
            except IntegrityError:
                await db.rollback()
                known_keys.add(key)

    await enrich_person_follow_from_tmdb(follow)

    async with async_session_maker() as db:
        row = await db.get(PersonFollow, follow.id)
        if row:
            row.last_checked_at = now
            row.updated_at = now
            await db.commit()

    return {
        "person_follow_id": follow.id,
        "tmdb_person_id": follow.tmdb_person_id,
        "name": follow.name,
        "new_credits": new_credits,
        "new_subscriptions": new_subscriptions,
        "failed": failed,
    }


async def get_person_follow_status_map() -> dict[str, Any]:
    """返回已关注演职员 ID 映射。"""
    async with async_session_maker() as db:
        result = await db.execute(
            select(PersonFollow).order_by(PersonFollow.created_at.desc())
        )
        follows = list(result.scalars().all())

    items = [
        {
            "id": row.id,
            "tmdb_person_id": row.tmdb_person_id,
            "name": row.name,
            "profile_path": row.profile_path,
            "known_for_department": row.known_for_department,
        }
        for row in follows
    ]
    person_id_map = {str(row.tmdb_person_id): row.id for row in follows}
    return {"items": items, "person_id_map": person_id_map}


async def get_person_follow_feed(limit: int = 30) -> list[dict[str, Any]]:
    """获取关注演职员的新作动态（仅上映/首播日期晚于今天的作品）。"""
    limit = max(1, min(100, int(limit or 30)))
    today = _beijing_today()
    async with async_session_maker() as db:
        result = await db.execute(
            select(PersonFollowCredit, PersonFollow)
            .join(PersonFollow, PersonFollow.id == PersonFollowCredit.person_follow_id)
            .order_by(PersonFollowCredit.discovered_at.desc())
        )
        rows = result.all()

    feed: list[dict[str, Any]] = []
    for credit, follow in rows:
        if not is_upcoming_credit(credit.credit_date, ref_date=today):
            continue
        feed.append(
            {
                "id": credit.id,
                "person_follow_id": follow.id,
                "tmdb_person_id": follow.tmdb_person_id,
                "person_name": follow.name,
                "person_profile_path": follow.profile_path,
                "tmdb_id": credit.tmdb_id,
                "media_type": credit.media_type,
                "title": credit.title,
                "poster_path": credit.poster_path,
                "credit_date": credit.credit_date,
                "discovered_at": credit.discovered_at.isoformat() if credit.discovered_at else None,
                "subscribed": credit.subscribed,
            }
        )
        if len(feed) >= limit:
            break
    return feed

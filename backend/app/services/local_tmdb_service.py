import asyncio
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from app.core.config import settings


TMDB_GENRE_NAMES = {
    12: "冒险",
    14: "奇幻",
    16: "动画",
    18: "剧情",
    27: "恐怖",
    28: "动作",
    35: "喜剧",
    36: "历史",
    37: "西部",
    53: "惊悚",
    80: "犯罪",
    99: "纪录",
    878: "科幻",
    9648: "悬疑",
    10402: "音乐",
    10749: "爱情",
    10751: "家庭",
    10752: "战争",
    10759: "动作冒险",
    10762: "儿童",
    10763: "新闻",
    10764: "真人秀",
    10765: "科幻奇幻",
    10766: "肥皂剧",
    10767: "脱口秀",
    10768: "战争政治",
    10770: "电视电影",
}


class LocalTmdbService:
    """Read-only adapter for NextFind-style local TMDB SQLite databases."""

    def _configured_path(self) -> Path | None:
        raw_path = str(getattr(settings, "TMDB_LOCAL_DB_PATH", "") or "").strip()
        if not raw_path:
            return None
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        return path

    def _connect(self) -> sqlite3.Connection | None:
        path = self._configured_path()
        if not path or not path.is_file():
            return None
        conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn

    async def status(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._status_sync)

    def _status_sync(self) -> dict[str, Any]:
        path = self._configured_path()
        if not path:
            return {
                "enabled": False,
                "available": False,
                "path": "",
                "message": "未配置本地 TMDB 数据库路径",
            }
        if not path.is_file():
            return {
                "enabled": True,
                "available": False,
                "path": str(path),
                "message": "本地 TMDB 数据库文件不存在",
            }

        try:
            conn = self._connect()
            if not conn:
                raise RuntimeError("无法打开数据库")
            try:
                tables = {
                    str(row["name"])
                    for row in conn.execute(
                        "select name from sqlite_master where type='table'"
                    ).fetchall()
                }
                if "tmdb_media" not in tables:
                    return {
                        "enabled": True,
                        "available": False,
                        "path": str(path),
                        "message": "数据库缺少 tmdb_media 表",
                    }
                media_count = int(
                    conn.execute("select count(*) from tmdb_media").fetchone()[0] or 0
                )
                cache_count = 0
                if "tmdb_api_cache" in tables:
                    cache_count = int(
                        conn.execute("select count(*) from tmdb_api_cache").fetchone()[0]
                        or 0
                    )
                latest_row = conn.execute(
                    "select max(updated_at) from tmdb_media"
                ).fetchone()
                return {
                    "enabled": True,
                    "available": media_count > 0,
                    "path": str(path),
                    "size_bytes": path.stat().st_size,
                    "media_count": media_count,
                    "api_cache_count": cache_count,
                    "latest_updated_at": latest_row[0] if latest_row else "",
                    "message": "本地 TMDB 数据库可用" if media_count > 0 else "本地 TMDB 数据库为空",
                }
            finally:
                conn.close()
        except Exception as exc:
            return {
                "enabled": True,
                "available": False,
                "path": str(path),
                "message": f"本地 TMDB 数据库读取失败: {exc}",
            }

    async def is_available(self) -> bool:
        status = await self.status()
        return bool(status.get("available"))

    async def search_multi(self, query: str, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        return await self._search(query=query, media_type="", page=page, page_size=page_size)

    async def search_by_media_type(
        self,
        query: str,
        media_type: str,
        page: int = 1,
        year: int | None = None,
        page_size: int = 20,
    ) -> dict[str, Any]:
        return await self._search(
            query=query,
            media_type=media_type,
            page=page,
            year=year,
            page_size=page_size,
        )

    async def _search(
        self,
        *,
        query: str,
        media_type: str,
        page: int,
        year: int | None = None,
        page_size: int = 20,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._search_sync,
            str(query or "").strip(),
            str(media_type or "").strip().lower(),
            max(1, int(page or 1)),
            year,
            max(1, min(50, int(page_size or 20))),
        )

    def _search_sync(
        self,
        query: str,
        media_type: str,
        page: int,
        year: int | None,
        page_size: int,
    ) -> dict[str, Any]:
        empty = self._empty_search(query, page)
        if not query:
            return empty
        conn = self._connect()
        if not conn:
            return empty

        try:
            where, params = self._build_search_where(query, media_type, year)
            order_sql, order_params = self._build_search_order(query, year)
            count_sql = f"select count(*) from tmdb_media where {where}"
            total_results = int(conn.execute(count_sql, params).fetchone()[0] or 0)
            if total_results <= 0:
                return empty

            offset = (page - 1) * page_size
            sql = f"""
                select *
                from tmdb_media
                where {where}
                order by {order_sql}
                limit ? offset ?
            """
            rows = conn.execute(sql, [*params, *order_params, page_size, offset]).fetchall()
            items = [self._row_to_search_item(row) for row in rows]
            total_pages = max(1, (total_results + page_size - 1) // page_size)
            return {
                "query": query,
                "page": page,
                "total_pages": total_pages,
                "total_results": total_results,
                "items": items,
                "results": items,
                "search_service": "local_tmdb",
                "search_services": ["local_tmdb"],
                "source_counts": {"local_tmdb": len(items)},
                "fallback_used": False,
                "attempts": [
                    {"service": "local_tmdb", "status": "ok", "count": len(items)}
                ],
            }
        finally:
            conn.close()

    def _build_search_where(
        self, query: str, media_type: str, year: int | None
    ) -> tuple[str, list[Any]]:
        lowered = query.lower()
        alpha = re.sub(r"[^a-z0-9]", "", lowered)
        params: list[Any] = [
            f"%{query}%",
            f"%{query}%",
            f"%{lowered}%",
            f"%{lowered}%",
            f"%{query}%",
        ]
        title_conditions = [
            "title like ?",
            "original_title like ?",
            "title_pinyin like ?",
            "title_pinyin_initial like ?",
            "cast_text like ?",
        ]
        if alpha:
            title_conditions.extend(
                [
                    "replace(lower(coalesce(title_pinyin, '')), ' ', '') like ?",
                    "replace(lower(coalesce(title_pinyin_initial, '')), ' ', '') like ?",
                ]
            )
            params.extend([f"%{alpha}%", f"%{alpha}%"])
        if query.isdigit():
            title_conditions.append("cast(id as text) = ?")
            params.append(query)

        where_parts = [f"({' or '.join(title_conditions)})", "title is not null", "title != ''"]
        normalized_type = "tv" if media_type == "tv" else "movie" if media_type == "movie" else ""
        if normalized_type:
            where_parts.append("type = ?")
            params.append(normalized_type)
        if isinstance(year, int) and year > 1800:
            where_parts.append("year = ?")
            params.append(year)
        return " and ".join(where_parts), params

    def _build_search_order(self, query: str, year: int | None) -> tuple[str, list[Any]]:
        lowered = query.lower()
        alpha = re.sub(r"[^a-z0-9]", "", lowered)
        id_query = query if query.isdigit() else ""
        year_value = year if isinstance(year, int) and year > 1800 else None
        order_sql = """
            (
                case when ? != '' and cast(id as text) = ? then 100000 else 0 end
                + case when lower(coalesce(title, '')) = ? then 90000 else 0 end
                + case when lower(coalesce(original_title, '')) = ? then 85000 else 0 end
                + case when lower(coalesce(title, '')) like ? then 70000 else 0 end
                + case when lower(coalesce(original_title, '')) like ? then 65000 else 0 end
                + case when ? != '' and replace(lower(coalesce(title_pinyin, '')), ' ', '') = ? then 60000 else 0 end
                + case when ? != '' and lower(coalesce(title_pinyin_initial, '')) = ? then 58000 else 0 end
                + case when ? != '' and lower(coalesce(title_pinyin_initial, '')) like ? then 56000 else 0 end
                + case when ? != '' and replace(lower(coalesce(title_pinyin, '')), ' ', '') like ? then 54000 else 0 end
                + case when ? != '' and lower(coalesce(title_pinyin_initial, '')) like ? then 52000 else 0 end
                + case when lower(coalesce(title_pinyin, '')) like ? then 50000 else 0 end
                + case when lower(coalesce(title, '')) like ? then 45000 else 0 end
                + case when lower(coalesce(original_title, '')) like ? then 43000 else 0 end
                + case when lower(coalesce(cast_text, '')) like ? then 20000 else 0 end
                + case when ? is not null and year = ? then 1000 else 0 end
            ) desc,
            popularity desc,
            vote_average desc,
            year desc
        """
        return order_sql, [
            id_query,
            id_query,
            lowered,
            lowered,
            f"{lowered}%",
            f"{lowered}%",
            alpha,
            alpha,
            alpha,
            alpha,
            alpha,
            f"{alpha} %",
            alpha,
            f"%{alpha}%",
            alpha,
            f"{alpha}%",
            f"%{lowered}%",
            f"%{lowered}%",
            f"%{lowered}%",
            f"%{lowered}%",
            year_value,
            year_value,
        ]

    def _empty_search(self, query: str, page: int) -> dict[str, Any]:
        return {
            "query": query,
            "page": page,
            "total_pages": 0,
            "total_results": 0,
            "items": [],
            "results": [],
            "search_service": "local_tmdb",
            "search_services": [],
            "source_counts": {},
            "fallback_used": False,
            "attempts": [{"service": "local_tmdb", "status": "skipped", "count": 0}],
        }

    def _row_to_search_item(self, row: sqlite3.Row) -> dict[str, Any]:
        media_type = str(row["type"] or "").strip().lower()
        title = str(row["title"] or row["original_title"] or "").strip()
        release_date = str(row["release_date"] or "").strip()
        item = {
            "id": row["id"],
            "tmdb_id": row["id"],
            "media_type": media_type,
            "title": title,
            "name": title,
            "original_title": row["original_title"] or "",
            "original_name": row["original_title"] or "",
            "overview": "",
            "poster_path": row["poster"] or "",
            "vote_average": row["vote_average"],
            "rating": row["vote_average"],
            "release_date": release_date if media_type == "movie" else "",
            "first_air_date": release_date if media_type == "tv" else "",
            "year": row["year"] or (release_date[:4] if release_date else ""),
            "popularity": row["popularity"],
            "source_service": "local_tmdb",
            "cast_text": row["cast_text"] or "",
        }
        return item

    async def get_detail(self, media_type: str, tmdb_id: int) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._get_detail_sync,
            "tv" if str(media_type or "").lower() == "tv" else "movie",
            int(tmdb_id),
        )

    def _get_detail_sync(self, media_type: str, tmdb_id: int) -> dict[str, Any]:
        conn = self._connect()
        if not conn:
            return {}
        try:
            row = conn.execute(
                "select * from tmdb_media where id = ? and type = ?",
                (tmdb_id, media_type),
            ).fetchone()
            cached = self._get_cached_detail(conn, media_type, tmdb_id)
            if cached:
                cached["source_service"] = "local_tmdb_cache"
                cached.setdefault("local_tmdb", True)
                self._merge_row_extras(cached, row)
                return cached
            if row:
                return self._row_to_detail(row)
            return {}
        finally:
            conn.close()

    def _get_cached_detail(
        self, conn: sqlite3.Connection, media_type: str, tmdb_id: int
    ) -> dict[str, Any]:
        try:
            key = f"{media_type}_info_{tmdb_id}"
            row = conn.execute(
                "select response_data from tmdb_api_cache where url_key = ?",
                (key,),
            ).fetchone()
            if not row:
                return {}
            payload = json.loads(str(row["response_data"] or "{}"))
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    def _row_to_detail(self, row: sqlite3.Row) -> dict[str, Any]:
        media_type = str(row["type"] or "").strip().lower()
        release_date = str(row["release_date"] or "").strip()
        seasons = self._parse_json_list(row["seasons"])
        cast = self._cast_from_text(row["cast_text"] or "")
        detail: dict[str, Any] = {
            "id": row["id"],
            "tmdb_id": row["id"],
            "media_type": media_type,
            "poster_path": row["poster"] or "",
            "vote_average": row["vote_average"],
            "popularity": row["popularity"],
            "genres": self._genres_from_ids(row["genre_ids"] or ""),
            "overview": "",
            "status": row["status"] or "",
            "source_service": "local_tmdb",
            "local_tmdb": True,
            "credits": {"cast": cast},
        }
        if media_type == "tv":
            detail.update(
                {
                    "name": row["title"] or "",
                    "original_name": row["original_title"] or "",
                    "first_air_date": release_date,
                    "number_of_seasons": len([s for s in seasons if s.get("season_number", 0) > 0]),
                    "number_of_episodes": row["total_episodes"] or 0,
                    "seasons": seasons,
                }
            )
        else:
            detail.update(
                {
                    "title": row["title"] or "",
                    "original_title": row["original_title"] or "",
                    "release_date": release_date,
                }
            )
        return detail

    def _merge_row_extras(self, payload: dict[str, Any], row: sqlite3.Row | None) -> None:
        if not row:
            return
        payload.setdefault("genres", self._genres_from_ids(row["genre_ids"] or ""))
        if not payload.get("credits") and row["cast_text"]:
            payload["credits"] = {"cast": self._cast_from_text(row["cast_text"])}
        if not payload.get("poster_path"):
            payload["poster_path"] = row["poster"] or ""
        if not payload.get("release_date") and str(row["type"] or "") == "movie":
            payload["release_date"] = row["release_date"] or ""
        if not payload.get("first_air_date") and str(row["type"] or "") == "tv":
            payload["first_air_date"] = row["release_date"] or ""

    def _parse_json_list(self, value: Any) -> list[dict[str, Any]]:
        try:
            parsed = json.loads(str(value or "[]"))
        except Exception:
            return []
        if not isinstance(parsed, list):
            return []
        return [item for item in parsed if isinstance(item, dict)]

    def _genres_from_ids(self, value: Any) -> list[dict[str, Any]]:
        ids = self._parse_json_list(value)
        normalized_ids: list[int] = []
        if not ids:
            try:
                parsed = json.loads(str(value or "[]"))
            except Exception:
                parsed = []
            if isinstance(parsed, list):
                normalized_ids = [int(item) for item in parsed if str(item).isdigit()]
        else:
            normalized_ids = [
                int(item.get("id"))
                for item in ids
                if isinstance(item.get("id"), int) or str(item.get("id", "")).isdigit()
            ]
        return [
            {"id": genre_id, "name": TMDB_GENRE_NAMES.get(genre_id, str(genre_id))}
            for genre_id in normalized_ids
        ]

    def _cast_from_text(self, value: str) -> list[dict[str, Any]]:
        names = [item.strip() for item in re.split(r"[,，]", str(value or "")) if item.strip()]
        return [
            {
                "id": -(index + 1),
                "name": name,
                "character": "",
                "profile_path": "",
            }
            for index, name in enumerate(names[:30])
        ]


local_tmdb_service = LocalTmdbService()

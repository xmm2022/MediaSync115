"""
飞牛影视服务 - nas-tools FnOSClient 模式 v/api 门面。
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.services.feiniu_vapi_client import FeiniuVapiClient

logger = logging.getLogger(__name__)


class FeiniuService:
    """飞牛影视服务门面，委托 FeiniuVapiClient 完成 v/api 调用。"""

    def __init__(self) -> None:
        self.base_url = ""
        self._client = FeiniuVapiClient()

    def configure_client(
        self,
        *,
        base_url: str = "",
        username: str = "",
        password: str = "",
        token: str = "",
    ) -> None:
        """从外部注入客户端配置，避免与 runtime_settings 循环导入。"""
        self.base_url = str(base_url or "").strip().rstrip("/")
        self._client = FeiniuVapiClient(
            base_url=self.base_url,
            username=str(username or "").strip(),
            password=str(password or "").strip(),
            token=str(token or "").strip(),
        )

    def apply_runtime_config(self) -> None:
        """从运行时设置加载飞牛影视客户端配置。"""
        from app.services.runtime_settings_service import runtime_settings_service

        self.base_url = runtime_settings_service.get_feiniu_url().rstrip("/")
        self._client = FeiniuVapiClient(
            base_url=self.base_url,
            username=runtime_settings_service.get_feiniu_login_username(),
            password=runtime_settings_service.get_feiniu_password(),
            token=runtime_settings_service.get_feiniu_session_token(),
        )

    def _build_client(
        self,
        base_url: str = "",
        username: str = "",
        password: str = "",
        token: str = "",
    ) -> FeiniuVapiClient:
        from app.services.runtime_settings_service import runtime_settings_service

        resolved_base = str(base_url or self.base_url or runtime_settings_service.get_feiniu_url()).strip().rstrip("/")
        return FeiniuVapiClient(
            base_url=resolved_base,
            username=str(username or runtime_settings_service.get_feiniu_login_username()).strip(),
            password=str(password or runtime_settings_service.get_feiniu_password()).strip(),
            token=str(token or runtime_settings_service.get_feiniu_session_token()).strip(),
        )

    def set_config(self, base_url: str, secret: str = "", api_key: str = "") -> None:
        """兼容旧调用：仅更新 base_url。"""
        self.base_url = str(base_url or "").strip().rstrip("/")
        self._client.set_base_url(self.base_url)

    def set_session_token(self, token: str) -> None:
        self._client.set_token(token)

    @staticmethod
    def is_trim_vapi_token(token: str) -> bool:
        return FeiniuVapiClient.is_trim_vapi_token(token)

    async def login(self, username: str, password: str) -> dict[str, Any]:
        """HTTP v/api 登录飞牛影视。"""
        client = self._build_client(username=username, password=password)
        result = await client.login(username, password)
        if result.get("success") and result.get("token"):
            self._client = client
        return result

    async def ensure_authenticated(self) -> bool:
        """确保客户端已登录（必要时用已存凭据自动换票）。"""
        from app.services.runtime_settings_service import runtime_settings_service

        self.apply_runtime_config()
        previous_token = runtime_settings_service.get_feiniu_session_token()
        ok = await self._client.ensure_token()
        if ok and self._client.token and self._client.token != previous_token:
            runtime_settings_service.update_bulk(
                {"feiniu_session_token": self._client.token}
            )
        return ok

    async def check_connection(self) -> dict[str, Any]:
        """检查飞牛影视连接状态。"""
        self.apply_runtime_config()
        if not self._client.base_url:
            return {
                "valid": False,
                "message": "飞牛影视 URL 未配置",
                "user": None,
            }
        if not await self._client.ensure_token():
            return {
                "valid": False,
                "message": "请先登录飞牛影视获取凭证",
                "user": None,
            }
        return await self._client.get_user_info()

    async def check_connection_with_config(
        self, base_url: str, secret: str, api_key: str
    ) -> dict[str, Any]:
        """兼容旧接口：使用 URL + 已存凭据检测连接。"""
        previous = self.base_url
        try:
            self.set_config(base_url, secret, api_key)
            return await self.check_connection()
        finally:
            self.base_url = previous

    async def check_connection_with_session(self) -> dict[str, Any]:
        return await self.check_connection()

    async def fetch_all_items(self) -> list[dict[str, Any]]:
        """分页拉取全部媒体条目。"""
        if not await self.ensure_authenticated():
            raise RuntimeError("飞牛影视未登录，无法拉取媒体列表")
        return await self._client.fetch_all_items()

    async def list_items_page(self, page: int = 1) -> dict[str, Any]:
        """兼容旧分页接口。"""
        try:
            if not await self.ensure_authenticated():
                return {
                    "success": False,
                    "message": "飞牛影视未登录",
                    "data": None,
                }
            body = {
                "tags": {"type": ["Movie", "TV", "Directory", "Video"]},
                "sort_type": "DESC",
                "sort_column": "create_time",
                "exclude_grouped_video": 1,
                "page": max(1, int(page)),
                "page_size": 50,
            }
            payload = await self._client.request(
                "v/api/v1/item/list",
                method="post",
                data=body,
            )
            if payload.get("code") != 0:
                return {
                    "success": False,
                    "message": payload.get("msg") or "获取媒体条目失败",
                    "data": None,
                }
            return {
                "success": True,
                "message": "查询成功",
                "data": payload.get("data") or {},
            }
        except Exception as exc:
            return {
                "success": False,
                "message": str(exc),
                "data": None,
            }

    async def list_seasons(self, tv_guid: str) -> dict[str, Any]:
        try:
            if not await self.ensure_authenticated():
                return {"success": False, "message": "飞牛影视未登录", "data": []}
            data = await self._client.list_seasons(tv_guid)
            return {"success": True, "message": "查询成功", "data": data}
        except Exception as exc:
            return {"success": False, "message": str(exc), "data": []}

    async def list_episodes(self, season_guid: str) -> dict[str, Any]:
        try:
            if not await self.ensure_authenticated():
                return {"success": False, "message": "飞牛影视未登录", "data": []}
            data = await self._client.list_episodes(season_guid)
            return {"success": True, "message": "查询成功", "data": data}
        except Exception as exc:
            return {"success": False, "message": str(exc), "data": []}

    async def get_item_detail(self, guid: str) -> dict[str, Any]:
        item_guid = str(guid or "").strip()
        if not item_guid:
            return {"success": False, "message": "参数无效", "data": None}
        try:
            if not await self.ensure_authenticated():
                return {"success": False, "message": "飞牛影视未登录", "data": None}
            payload = await self._client.request(
                f"v/api/v1/item/{item_guid}",
                method="get",
                data={},
            )
            if payload.get("code") != 0:
                return {
                    "success": False,
                    "message": payload.get("msg") or "获取条目详情失败",
                    "data": None,
                }
            return {
                "success": True,
                "message": "查询成功",
                "data": payload.get("data") or {},
            }
        except Exception as exc:
            return {"success": False, "message": str(exc), "data": None}

    async def get_movie_status_by_tmdb(self, tmdb_id: int) -> dict[str, Any]:
        if not await self.ensure_authenticated():
            return {
                "status": "not_logged_in",
                "message": "未登录，无法查询媒体状态",
                "exists": False,
                "item_ids": [],
            }
        try:
            items = await self._client.search_by_tmdb(tmdb_id, "movie")
            item_ids = [str(item.get("id") or "") for item in items if item.get("id")]
            return {
                "status": "ok",
                "message": "查询成功" if item_ids else "飞牛影视中未匹配到该 TMDB 电影",
                "exists": bool(item_ids),
                "item_ids": item_ids,
            }
        except Exception as exc:
            return {
                "status": "request_failed",
                "message": str(exc),
                "exists": False,
                "item_ids": [],
            }

    async def get_tv_episode_status_by_tmdb(self, tmdb_id: int) -> dict[str, Any]:
        if not await self.ensure_authenticated():
            return {
                "status": "not_logged_in",
                "message": "未登录，无法查询媒体状态",
                "existing_episodes": set(),
            }
        try:
            items = await self._client.search_by_tmdb(tmdb_id, "tv")
            existing_episodes: set[tuple[int, int]] = set()
            for item in items:
                season = int(item.get("season") or item.get("seasonNumber") or 1)
                episode = int(item.get("episode") or item.get("episodeNumber") or 0)
                if episode > 0:
                    existing_episodes.add((season, episode))
            return {
                "status": "ok",
                "message": "查询成功",
                "existing_episodes": existing_episodes,
            }
        except Exception as exc:
            return {
                "status": "request_failed",
                "message": str(exc),
                "existing_episodes": set(),
            }

    async def refresh_library(self, path: Optional[str] = None) -> dict[str, Any]:
        """触发媒体库扫描（v/api mdb/scan）。"""
        if not self._client.base_url and not self.base_url:
            self.apply_runtime_config()
        if not await self.ensure_authenticated():
            return {"status": "not_configured", "message": "飞牛影视未登录"}
        item_id = str(path or "").strip()
        endpoint = f"v/api/v1/mdb/scan/{item_id}" if item_id else "v/api/v1/mdb/scan"
        try:
            payload = await self._client.request(endpoint, method="post", data={})
            if payload.get("code") == 0:
                return {"status": "ok", "message": "扫描任务已触发"}
            msg = str(payload.get("msg") or "")
            if "-14" in msg:
                return {"status": "duplicate", "message": "扫描任务冲突，请稍后重试"}
            return {"status": "error", "message": msg or "扫描失败"}
        except Exception as exc:
            return {"status": "request_failed", "message": str(exc)}


feiniu_service = FeiniuService()

"""
飞牛影视 v/api HTTP 客户端（nas-tools FnOSClient 异步移植）。
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import time
from typing import Any, Optional
from urllib.parse import urlencode, urlparse, unquote

import httpx

from app.utils.proxy import create_direct_httpx_client

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
_HTTP_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)
_TOKEN_TTL_SECONDS = 3600
_TRIM_VAPI_TOKEN_RE = re.compile(r"^[a-f0-9]{32}$")
_DEFAULT_ITEM_LIST_BODY: dict[str, Any] = {
    "tags": {"type": ["Movie", "TV", "Directory", "Video"]},
    "sort_type": "DESC",
    "sort_column": "create_time",
    "exclude_grouped_video": 1,
}


class FeiniuVapiClient:
    """飞牛影视 v/api 客户端，对标 nas-tools FnOSClient。"""

    API_KEY = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh"
    API_SECRET = "16CCEB3D-AB42-077D-36A1-F355324E4237"
    APP_NAME = "trimemedia-web"

    def __init__(
        self,
        base_url: str = "",
        username: str = "",
        password: str = "",
        token: str = "",
    ) -> None:
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.username = str(username or "").strip()
        self.password = str(password or "").strip()
        self._token = str(token or "").strip()
        self._token_expiry: float = 0.0
        self._http_client: httpx.AsyncClient | None = None

    def set_base_url(self, base_url: str) -> None:
        self.base_url = str(base_url or "").strip().rstrip("/")

    def set_credentials(self, username: str, password: str) -> None:
        self.username = str(username or "").strip()
        self.password = str(password or "").strip()

    def set_token(self, token: str) -> None:
        cleaned = str(token or "").strip()
        if cleaned and not self.is_trim_vapi_token(cleaned):
            logger.warning("忽略非 Trim-MC-token 格式的 session token")
            cleaned = ""
        self._token = cleaned
        if self._token:
            self._token_expiry = time.time() + _TOKEN_TTL_SECONDS
        else:
            self._token_expiry = 0.0

    @property
    def token(self) -> str:
        return self._token

    @staticmethod
    def is_trim_vapi_token(token: str) -> bool:
        return bool(_TRIM_VAPI_TOKEN_RE.match(str(token or "").strip()))

    def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = create_direct_httpx_client(
                timeout=_HTTP_TIMEOUT,
                follow_redirects=True,
                limits=_HTTP_LIMITS,
            )
        return self._http_client

    async def aclose(self) -> None:
        if self._http_client is not None and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None

    @staticmethod
    def _md5(data: str | bytes) -> str:
        if isinstance(data, str):
            data = data.encode("utf-8")
        return hashlib.md5(data).hexdigest()

    @staticmethod
    def _parse_request_path(url: str) -> str:
        return urlparse(url).path or "/"

    @staticmethod
    def _build_get_query_string(params: Optional[dict[str, Any]] = None) -> str:
        merged: dict[str, str] = {}
        for key, value in sorted((params or {}).items()):
            if value is None:
                continue
            merged[str(key)] = str(value)
        if not merged:
            return ""
        return urlencode(merged).replace("+", "%20")

    def _hash_get_payload(self, payload: str) -> str:
        if not payload:
            return self._md5("")
        try:
            normalized = unquote(payload.replace("%", "%25"))
            return self._md5(normalized)
        except Exception:
            return self._md5(payload)

    def _generate_authx(
        self,
        method: str,
        url: str,
        *,
        data: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> str:
        path = self._parse_request_path(url)
        if method.upper() == "GET":
            query = self._build_get_query_string(params)
            payload_hash = self._hash_get_payload(query)
        else:
            body_json = json.dumps(data or {}, separators=(",", ":"))
            payload_hash = self._md5(body_json)
        nonce = str(random.randint(100000, 999999))
        timestamp = int(time.time() * 1000)
        sign_str = "_".join(
            [
                self.API_KEY,
                path,
                nonce,
                str(timestamp),
                payload_hash,
                self.API_SECRET,
            ]
        )
        sign_hash = self._md5(sign_str)
        return f"nonce={nonce}&timestamp={timestamp}&sign={sign_hash}"

    def _build_headers(
        self,
        method: str,
        url: str,
        *,
        data: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
        token: Optional[str] = None,
    ) -> dict[str, str]:
        headers = {
            "authx": self._generate_authx(method, url, data=data, params=params),
            "Accept": "application/json, text/plain, */*",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
            ),
        }
        session_token = str(token if token is not None else self._token or "").strip()
        if session_token:
            headers["Authorization"] = session_token
            headers["Cookie"] = f"mode=relay; Trim-MC-token={session_token}"
        if method.upper() != "GET":
            headers["Content-Type"] = "application/json"
        return headers

    def _is_token_expired(self) -> bool:
        if not self._token or not self.is_trim_vapi_token(self._token):
            return True
        if self._token_expiry and time.time() > self._token_expiry:
            return True
        return False

    async def login(self, username: str = "", password: str = "") -> dict[str, Any]:
        """HTTP 登录飞牛影视 v/api，获取 Trim-MC-token。"""
        user = str(username or self.username or "").strip()
        pwd = str(password or self.password or "").strip()
        if not self.base_url:
            return {"success": False, "message": "飞牛影视 URL 未配置", "token": None}
        if not user or not pwd:
            return {"success": False, "message": "用户名或密码未配置", "token": None}

        url = f"{self.base_url}/v/api/v1/login"
        body = {
            "username": user,
            "password": pwd,
            "app_name": self.APP_NAME,
        }
        client = self._get_client()
        try:
            response = await client.post(
                url,
                headers=self._build_headers("POST", url, data=body),
                content=json.dumps(body, separators=(",", ":")),
                timeout=15.0,
            )
            if response.status_code != 200:
                return {
                    "success": False,
                    "message": f"登录请求失败 (HTTP {response.status_code})",
                    "token": None,
                }
            payload = response.json()
            code = payload.get("code")
            msg = str(payload.get("msg") or "")
            if code == 0:
                data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
                token = str(data.get("token") or "").strip()
                if token:
                    self.username = user
                    self.password = pwd
                    self.set_token(token)
                    logger.info("[Feiniu v/api] 登录成功, token=%s...", token[:8])
                    return {
                        "success": True,
                        "message": "登录成功",
                        "token": token,
                        "user": data,
                    }
                return {
                    "success": False,
                    "message": f"登录成功但未返回 Token: {msg}",
                    "token": None,
                }
            if code == -15:
                return {"success": False, "message": "密码错误", "token": None}
            if code == -2:
                return {
                    "success": False,
                    "message": "认证失败，请检查用户名",
                    "token": None,
                }
            return {
                "success": False,
                "message": f"登录失败: {msg} (code={code})",
                "token": None,
            }
        except Exception as exc:
            logger.exception("[Feiniu v/api] 登录异常")
            return {"success": False, "message": f"登录异常: {exc}", "token": None}

    async def ensure_token(self) -> bool:
        """确保持有有效 Token，必要时自动登录。"""
        if self._token and not self._is_token_expired():
            return True
        if not self.username or not self.password:
            return bool(self._token)
        result = await self.login(self.username, self.password)
        return bool(result.get("success") and result.get("token"))

    async def request(
        self,
        endpoint: str,
        *,
        method: str = "post",
        params: Optional[dict[str, Any]] = None,
        data: Optional[dict[str, Any]] = None,
        retry_login: bool = True,
    ) -> dict[str, Any]:
        """发送 v/api 请求并返回 JSON。"""
        if not await self.ensure_token():
            raise RuntimeError("飞牛影视未登录或自动登录失败")

        endpoint_path = str(endpoint or "").lstrip("/")
        url = f"{self.base_url}/{endpoint_path}"
        req_method = method.upper()
        req_params = dict(params or {})
        req_data = dict(data or {}) if data is not None else {}
        client = self._get_client()

        async def _send() -> dict[str, Any]:
            headers = self._build_headers(
                req_method,
                url,
                data=req_data if req_method != "GET" else None,
                params=req_params if req_method == "GET" else None,
            )
            cookies = {"Trim-MC-token": self._token}
            if req_method == "GET":
                response = await client.get(
                    url,
                    headers=headers,
                    params=req_params or None,
                    cookies=cookies,
                    timeout=30.0,
                )
            else:
                response = await client.post(
                    url,
                    headers=headers,
                    content=json.dumps(req_data, separators=(",", ":")),
                    cookies=cookies,
                    timeout=30.0,
                )
            if response.status_code != 200:
                raise RuntimeError(f"请求失败 (HTTP {response.status_code})")
            return response.json()

        payload = await _send()
        code = payload.get("code")
        if retry_login and code in {-2, -15, 5000} and self.username and self.password:
            self._token = ""
            self._token_expiry = 0.0
            if await self.login(self.username, self.password):
                payload = await _send()
        return payload

    async def get_user_info(self) -> dict[str, Any]:
        """获取当前登录用户信息。"""
        payload = await self.request("v/api/v1/user/info", method="get", data={})
        if payload.get("code") != 0:
            return {
                "valid": False,
                "message": str(payload.get("msg") or "连接失败"),
                "user": None,
            }
        return {
            "valid": True,
            "message": "飞牛影视连接成功",
            "user": payload.get("data") or {},
        }

    async def fetch_all_items(
        self,
        *,
        page_size: int = 50,
        max_pages: int = 1000,
    ) -> list[dict[str, Any]]:
        """分页拉取全部媒体条目（nas-tools fetch_all_pages）。"""
        all_items: list[dict[str, Any]] = []
        page = 1
        total_items: Optional[int] = None

        while page <= max_pages:
            body = {
                **_DEFAULT_ITEM_LIST_BODY,
                "page": page,
                "page_size": page_size,
            }
            payload = await self.request("v/api/v1/item/list", method="post", data=body)
            if payload.get("code") != 0:
                raise RuntimeError(str(payload.get("msg") or "获取飞牛媒体列表失败"))
            data = payload.get("data") or {}
            rows = data.get("list") or []
            if not isinstance(rows, list):
                break
            all_items.extend([row for row in rows if isinstance(row, dict)])
            if total_items is None:
                total_items = int(data.get("total") or 0)
                if total_items == 0:
                    break
            if not rows:
                break
            if total_items > 0 and len(all_items) >= total_items:
                break
            page += 1

        if page > max_pages:
            raise RuntimeError("飞牛媒体列表分页异常")
        return all_items

    async def list_seasons(self, tv_guid: str) -> list[dict[str, Any]]:
        """获取剧集季列表。"""
        item_guid = str(tv_guid or "").strip()
        if not item_guid:
            return []
        payload = await self.request(
            f"v/api/v1/season/list/{item_guid}",
            method="get",
            data={},
        )
        if payload.get("code") != 0:
            return []
        data = payload.get("data") or []
        return data if isinstance(data, list) else []

    async def list_episodes(self, season_guid: str) -> list[dict[str, Any]]:
        """获取单季分集列表。"""
        item_guid = str(season_guid or "").strip()
        if not item_guid:
            return []
        payload = await self.request(
            f"v/api/v1/episode/list/{item_guid}",
            method="get",
            data={},
        )
        if payload.get("code") != 0:
            return []
        data = payload.get("data") or []
        return data if isinstance(data, list) else []

    async def search_by_tmdb(
        self, tmdb_id: int, media_type: str
    ) -> list[dict[str, Any]]:
        """按 TMDB ID 搜索媒体。"""
        payload = await self.request(
            "v/api/v1/mdb/search",
            method="get",
            params={"tmdb": str(tmdb_id), "type": media_type},
            data={},
        )
        if payload.get("code") != 0:
            return []
        data = payload.get("data") or {}
        items = data.get("items") or []
        return items if isinstance(items, list) else []

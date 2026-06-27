from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx


class MoviePilotClientError(RuntimeError):
    """MoviePilot API 调用失败。"""


class MoviePilotClient:
    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        access_token: str = "",
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
        token_updater: Callable[[str], None] | None = None,
    ) -> None:
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.username = str(username or "").strip()
        self.password = str(password or "")
        self.access_token = str(access_token or "").strip()
        self.timeout = timeout
        self.transport = transport
        self.token_updater = token_updater

    def _ensure_configured(self) -> None:
        if not self.base_url:
            raise MoviePilotClientError("MoviePilot 地址未配置")
        if not self.username or not self.password:
            raise MoviePilotClientError("MoviePilot 用户名或密码未配置")

    async def login(self) -> str:
        self._ensure_configured()
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self.transport,
        ) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/login/access-token",
                data={"username": self.username, "password": self.password},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if response.status_code >= 400:
            raise MoviePilotClientError(f"MoviePilot 登录失败：HTTP {response.status_code}")
        payload = response.json()
        access_token = str(payload.get("access_token") or "").strip()
        token_type = str(payload.get("token_type") or "bearer").strip()
        if not access_token:
            raise MoviePilotClientError("MoviePilot 登录响应缺少 access_token")
        self.access_token = f"{token_type} {access_token}".strip()
        if self.token_updater:
            self.token_updater(self.access_token)
        return self.access_token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        retry_auth: bool = True,
        **kwargs: Any,
    ) -> Any:
        if not self.access_token:
            await self.login()
        headers = dict(kwargs.pop("headers", {}) or {})
        headers["Authorization"] = self.access_token
        async with httpx.AsyncClient(
            timeout=self.timeout,
            transport=self.transport,
        ) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                **kwargs,
            )
        if response.status_code in {401, 403} and retry_auth:
            await self.login()
            return await self._request(method, path, retry_auth=False, **kwargs)
        if response.status_code >= 400:
            raise MoviePilotClientError(
                f"MoviePilot API 调用失败：HTTP {response.status_code}"
            )
        return response.json()

    async def search_title(self, keyword: str) -> list[dict[str, Any]]:
        cleaned = str(keyword or "").strip()
        if not cleaned:
            return []
        payload = await self._request(
            "GET",
            "/api/v1/search/title",
            params={"keyword": cleaned},
        )
        if isinstance(payload, dict) and payload.get("success") is True:
            data = payload.get("data")
            return data if isinstance(data, list) else []
        if isinstance(payload, list):
            return payload
        return []

    async def create_subscribe(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/v1/subscribe/", json=payload)

    async def list_subscribes(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v1/subscribe/")
        return payload if isinstance(payload, list) else []

    async def search_subscribe(self, subscribe_id: int) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/api/v1/subscribe/search/{int(subscribe_id)}",
        )

    async def list_downloads(self, name: str | None = None) -> list[dict[str, Any]]:
        params = {"name": name} if name else None
        payload = await self._request("GET", "/api/v1/download", params=params)
        return payload if isinstance(payload, list) else []

    async def transfer_history(
        self,
        *,
        title: str = "",
        page: int = 1,
        count: int = 50,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/api/v1/history/transfer",
            params={"title": title, "page": page, "count": count},
        )

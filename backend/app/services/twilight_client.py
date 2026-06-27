from __future__ import annotations

from typing import Any

import httpx


class TwilightClientError(RuntimeError):
    """Twilight API 调用失败。"""


class TwilightClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        timeout: float = 15.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.timeout = timeout
        self.transport = transport

    def _ensure_base_url(self) -> None:
        if not self.base_url:
            raise TwilightClientError("Twilight 地址未配置")

    async def _get(self, path: str, *, api_key: bool = False) -> Any:
        self._ensure_base_url()
        headers = {}
        if api_key:
            if not self.api_key:
                raise TwilightClientError("Twilight API Key 未配置")
            headers["X-API-Key"] = self.api_key
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            response = await client.get(f"{self.base_url}{path}", headers=headers)
        if response.status_code >= 400:
            raise TwilightClientError(f"Twilight API 调用失败：HTTP {response.status_code}")
        return response.json()

    async def health(self) -> Any:
        return await self._get("/api/v1/system/health")

    async def api_key_status(self) -> Any:
        payload = await self._get("/api/v1/apikey/status", api_key=True)
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload

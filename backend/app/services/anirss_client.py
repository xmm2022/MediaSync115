from __future__ import annotations

from typing import Any

import httpx


class AniRssClientError(RuntimeError):
    """ANI-RSS API 调用失败。"""


class AniRssClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = str(base_url or "").strip().rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.timeout = timeout
        self.transport = transport

    def _ensure_configured(self) -> None:
        if not self.base_url:
            raise AniRssClientError("ANI-RSS 地址未配置")
        if not self.api_key:
            raise AniRssClientError("ANI-RSS API Key 未配置")

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        self._ensure_configured()
        headers = {
            "api-key": self.api_key,
            "Accept": "application/json",
            **dict(kwargs.pop("headers", {}) or {}),
        }
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
        if response.status_code >= 400:
            raise AniRssClientError(f"ANI-RSS API 调用失败：HTTP {response.status_code}")
        payload = response.json()
        if isinstance(payload, dict):
            code = payload.get("code")
            if code is not None and int(code) >= 400:
                raise AniRssClientError(str(payload.get("message") or "ANI-RSS 返回错误"))
        return payload

    @staticmethod
    def unwrap_result(payload: Any) -> Any:
        if isinstance(payload, dict) and "data" in payload:
            return payload.get("data")
        return payload

    async def list_ani(self) -> dict[str, Any]:
        payload = await self._request("POST", "/api/listAni")
        data = self.unwrap_result(payload)
        return data if isinstance(data, dict) else {}

    async def rss_to_ani(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self._request("POST", "/api/rssToAni", json=payload)
        data = self.unwrap_result(response)
        return data if isinstance(data, dict) else {}

    async def mikan(self, text: str, season: dict[str, Any] | None = None) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/api/mikan",
            params={"text": str(text or "")},
            json=season or {},
        )
        data = self.unwrap_result(response)
        return data if isinstance(data, dict) else {}

    async def mikan_group(self, url: str) -> list[Any]:
        response = await self._request(
            "POST",
            "/api/mikanGroup",
            params={"url": str(url or "")},
        )
        data = self.unwrap_result(response)
        return data if isinstance(data, list) else []

    async def ani_bt(self, *, season: str = "", bgm_url: str = "") -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/api/aniBT",
            params={"season": str(season or ""), "bgmUrl": str(bgm_url or "")},
        )
        data = self.unwrap_result(response)
        return data if isinstance(data, dict) else {}

    async def ani_bt_group(self, bgm_id: str) -> list[Any]:
        response = await self._request(
            "POST",
            "/api/aniBTGroup",
            params={"bgmId": str(bgm_id or "")},
        )
        data = self.unwrap_result(response)
        return data if isinstance(data, list) else []

    async def anime_garden_list(self, *, bgm_url: str = "") -> list[Any]:
        response = await self._request(
            "POST",
            "/api/animeGardenList",
            params={"bgmUrl": str(bgm_url or "")},
        )
        data = self.unwrap_result(response)
        return data if isinstance(data, list) else []

    async def anime_garden_group(self, bgm_id: str) -> list[Any]:
        response = await self._request(
            "POST",
            "/api/animeGardenGroup",
            params={"bgmId": str(bgm_id or "")},
        )
        data = self.unwrap_result(response)
        return data if isinstance(data, list) else []

    async def preview_ani(self, ani: dict[str, Any]) -> dict[str, Any]:
        response = await self._request("POST", "/api/previewAni", json=ani)
        data = self.unwrap_result(response)
        return data if isinstance(data, dict) else {}

    async def add_ani(self, ani: dict[str, Any]) -> dict[str, Any]:
        response = await self._request("POST", "/api/addAni", json=ani)
        return response if isinstance(response, dict) else {"data": response}

    async def set_ani(self, ani: dict[str, Any], *, move: bool = False) -> dict[str, Any]:
        response = await self._request(
            "POST",
            f"/api/setAni?move={str(bool(move)).lower()}",
            json=ani,
        )
        return response if isinstance(response, dict) else {"data": response}

    async def delete_ani(self, ani_ids: list[str], *, delete_files: bool = False) -> dict[str, Any]:
        response = await self._request(
            "POST",
            f"/api/deleteAni?deleteFiles={str(bool(delete_files)).lower()}",
            json=[str(ani_id) for ani_id in ani_ids if str(ani_id or "").strip()],
        )
        return response if isinstance(response, dict) else {"data": response}

    async def refresh_ani(self, ani_id: str) -> dict[str, Any]:
        response = await self._request("POST", "/api/refreshAni", json={"id": ani_id})
        return response if isinstance(response, dict) else {"data": response}

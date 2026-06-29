from __future__ import annotations

from typing import Any

import httpx


BANGUMI_BASE_URL = "https://api.bgm.tv"
BANGUMI_USER_AGENT = "MediaSync115/0.1 (https://github.com/wangsy1007/mediasync115)"


class BangumiClientError(RuntimeError):
    """Bangumi API 调用失败。"""


class BangumiClient:
    def __init__(
        self,
        *,
        base_url: str = BANGUMI_BASE_URL,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = str(base_url or BANGUMI_BASE_URL).strip().rstrip("/")
        self.timeout = timeout
        self.transport = transport

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {
            "User-Agent": BANGUMI_USER_AGENT,
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
            raise BangumiClientError(f"Bangumi API 调用失败：HTTP {response.status_code}")
        return response.json()

    async def search_anime(
        self,
        keyword: str,
        *,
        limit: int = 12,
        offset: int = 0,
    ) -> dict[str, Any]:
        cleaned = str(keyword or "").strip()
        if not cleaned:
            return {"data": [], "total": 0, "limit": limit, "offset": offset}
        payload = {
            "keyword": cleaned,
            "sort": "match",
            "filter": {"type": [2]},
        }
        data = await self._request(
            "POST",
            "/v0/search/subjects",
            params={"limit": max(1, min(int(limit), 50)), "offset": max(0, int(offset))},
            json=payload,
        )
        return data if isinstance(data, dict) else {"data": [], "total": 0}

    async def get_subject(self, subject_id: int | str) -> dict[str, Any]:
        subject = str(subject_id or "").strip()
        if not subject:
            raise BangumiClientError("Bangumi subject_id 不能为空")
        data = await self._request("GET", f"/v0/subjects/{subject}")
        return data if isinstance(data, dict) else {}


bangumi_client = BangumiClient()

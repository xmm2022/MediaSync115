from __future__ import annotations

import re
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, quote, urljoin, urlparse

import httpx

from app.utils.proxy import proxy_manager


DEFAULT_MIKAN_BASE_URL = "https://mikanani.me"
MIKAN_USER_AGENT = "MediaSync115/0.1"


class MikanClientError(RuntimeError):
    """Mikan RSS 发现失败。"""


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(str(value or ""))).strip()


def _extract_mikan_id(path_or_url: str) -> str:
    match = re.search(r"/Home/Bangumi/(\d+)", str(path_or_url or ""))
    return match.group(1) if match else ""


def _extract_subject_id(url: str) -> str:
    match = re.search(r"(?:bgm\.tv|bangumi\.tv)/subject/(\d+)", str(url or ""))
    return match.group(1) if match else ""


def _extract_subgroup_id(url: str) -> str:
    parsed = urlparse(str(url or ""))
    values = parse_qs(parsed.query).get("subgroupid") or []
    return str(values[0]).strip() if values else ""


@dataclass
class MikanSearchItem:
    mikan_id: str
    title: str
    url: str


class _AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[dict[str, Any]] = []
        self._current: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        self._current = {
            "attrs": {key: value or "" for key, value in attrs},
            "text": "",
        }

    def handle_data(self, data: str) -> None:
        if self._current is not None:
            self._current["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._current is None:
            return
        item = dict(self._current["attrs"])
        item["text"] = _normalize_text(self._current.get("text", ""))
        self.anchors.append(item)
        self._current = None


class _BangumiTitleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: value or "" for key, value in attrs}
        if tag.lower() == "p" and "bangumi-title" in attr_map.get("class", ""):
            self._in_title = True
            self._depth = 1
            return
        if self._in_title:
            self._depth += 1

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data

    def handle_endtag(self, tag: str) -> None:
        if not self._in_title:
            return
        self._depth -= 1
        if self._depth <= 0:
            self._in_title = False


class MikanClient:
    def __init__(
        self,
        *,
        base_url: str = DEFAULT_MIKAN_BASE_URL,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = self.normalize_base_url(base_url)
        self.timeout = timeout
        self.transport = transport

    @staticmethod
    def normalize_base_url(base_url: str) -> str:
        cleaned = str(base_url or "").strip().rstrip("/")
        if not cleaned:
            return DEFAULT_MIKAN_BASE_URL
        if not cleaned.startswith(("http://", "https://")):
            cleaned = f"https://{cleaned}"
        return cleaned.rstrip("/")

    async def _request_text(self, path: str, params: dict[str, Any] | None = None) -> str:
        headers = {
            "User-Agent": MIKAN_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        url = urljoin(f"{self.base_url}/", path.lstrip("/"))
        try:
            if self.transport is not None:
                async with httpx.AsyncClient(
                    timeout=self.timeout,
                    transport=self.transport,
                    follow_redirects=True,
                ) as client:
                    response = await client.get(url, params=params, headers=headers)
            else:
                async with proxy_manager.create_httpx_client(
                    timeout=self.timeout,
                    follow_redirects=True,
                ) as client:
                    response = await client.get(url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise MikanClientError(f"Mikan 请求失败：{exc}") from exc
        if response.status_code >= 400:
            raise MikanClientError(f"Mikan 请求失败：HTTP {response.status_code}")
        return response.text

    async def search_bangumi(self, keyword: str, *, limit: int = 8) -> list[MikanSearchItem]:
        cleaned = str(keyword or "").strip()
        if not cleaned:
            return []
        html = await self._request_text("/Home/Search", {"searchstr": cleaned})
        parser = _AnchorParser()
        parser.feed(html)
        seen: set[str] = set()
        items: list[MikanSearchItem] = []
        for anchor in parser.anchors:
            href = str(anchor.get("href") or "")
            mikan_id = _extract_mikan_id(href)
            if not mikan_id or mikan_id in seen:
                continue
            seen.add(mikan_id)
            title = _normalize_text(str(anchor.get("text") or ""))
            items.append(
                MikanSearchItem(
                    mikan_id=mikan_id,
                    title=title,
                    url=urljoin(self.base_url, href),
                )
            )
            if len(items) >= max(1, int(limit)):
                break
        return items

    async def get_bangumi_candidates(self, item: MikanSearchItem) -> dict[str, Any]:
        html = await self._request_text(f"/Home/Bangumi/{quote(item.mikan_id)}")
        parser = _AnchorParser()
        parser.feed(html)

        title_parser = _BangumiTitleParser()
        title_parser.feed(html)
        title = _normalize_text(title_parser.title) or item.title

        bgm_url = ""
        subgroup_names: dict[str, str] = {}
        rss_urls: list[str] = []
        for anchor in parser.anchors:
            href = str(anchor.get("href") or "").strip()
            classes = str(anchor.get("class") or "")
            text = _normalize_text(str(anchor.get("text") or ""))
            if not bgm_url and _extract_subject_id(href):
                bgm_url = href
            if "subgroup-name" in classes:
                subgroup_id = ""
                for part in classes.split():
                    if part.startswith("subgroup-") and part.removeprefix("subgroup-").isdigit():
                        subgroup_id = part.removeprefix("subgroup-")
                        break
                if not subgroup_id:
                    subgroup_id = str(anchor.get("data-anchor") or "").lstrip("#")
                if subgroup_id and text:
                    subgroup_names[subgroup_id] = text
            if "/RSS/Bangumi" in href:
                rss_urls.append(urljoin(self.base_url, href))

        candidates: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        for rss_url in rss_urls:
            if rss_url in seen_urls:
                continue
            seen_urls.add(rss_url)
            subgroup_id = _extract_subgroup_id(rss_url)
            subgroup = subgroup_names.get(subgroup_id, "") if subgroup_id else "全部字幕组"
            candidates.append(
                {
                    "source": "mikan",
                    "mikan_id": item.mikan_id,
                    "title": title,
                    "rss_url": rss_url,
                    "rss_type": "mikan",
                    "subgroup_id": subgroup_id or None,
                    "subgroup": subgroup,
                    "mikan_url": item.url,
                    "bgm_url": bgm_url,
                    "bangumi_id": _extract_subject_id(bgm_url) or None,
                }
            )

        candidates.sort(key=lambda candidate: (1 if candidate.get("subgroup_id") else 0, str(candidate.get("subgroup") or "")))
        return {
            "source": "mikan",
            "mikan_id": item.mikan_id,
            "title": title,
            "mikan_url": item.url,
            "bgm_url": bgm_url,
            "bangumi_id": _extract_subject_id(bgm_url) or None,
            "candidates": candidates,
        }

    async def discover_rss_candidates(
        self,
        keyword: str,
        *,
        bangumi_id: str | int | None = None,
        limit: int = 24,
    ) -> dict[str, Any]:
        subject_id = str(bangumi_id or "").strip()
        cleaned_keyword = str(keyword or "").strip()
        pages: list[dict[str, Any]] = []
        exact_page: dict[str, Any] | None = None
        errors: list[str] = []

        search_items = await self.search_bangumi(cleaned_keyword, limit=6)
        for item in search_items[:6]:
            try:
                page = await self.get_bangumi_candidates(item)
            except MikanClientError as exc:
                errors.append(str(exc) or f"Mikan 条目 {item.mikan_id} 读取失败")
                continue
            pages.append(page)
            if subject_id and str(page.get("bangumi_id") or "") == subject_id:
                exact_page = page
                break

        if subject_id:
            selected_pages = [exact_page] if exact_page else []
        else:
            selected_pages = [
                page for page in pages[:2]
                if isinstance(page.get("candidates"), list) and page.get("candidates")
            ]

        candidates: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        for page in selected_pages:
            if not page:
                continue
            for candidate in page.get("candidates", []):
                rss_url = str(candidate.get("rss_url") or "")
                if not rss_url or rss_url in seen_urls:
                    continue
                seen_urls.add(rss_url)
                candidates.append(candidate)
                if len(candidates) >= max(1, min(int(limit), 80)):
                    break
            if len(candidates) >= max(1, min(int(limit), 80)):
                break

        return {
            "source": "mikan",
            "keyword": keyword,
            "base_url": self.base_url,
            "matched": bool(exact_page),
            "matched_mikan_id": exact_page.get("mikan_id") if exact_page else None,
            "items": pages,
            "candidates": candidates,
            "errors": errors,
        }


mikan_client = MikanClient()

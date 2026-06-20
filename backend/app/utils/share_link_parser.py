"""从多行文本中解析网盘分享链接（TG Bot 批量转存等场景）。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import parse_qs, urlparse

PanType = Literal["115", "quark"]

_PAN115_URL_PATTERN = re.compile(
    r"https?://(?:115(?:cdn)?\.com/s/[A-Za-z0-9]+(?:\?[^\s（）<>\"']*)?"
    r"|share\.115\.com/[A-Za-z0-9]+(?:\?[^\s（）<>\"']*)?"
    r"|anxia\.com/s/[A-Za-z0-9]+(?:\?[^\s（）<>\"']*)?)",
    re.IGNORECASE,
)
_QUARK_URL_PATTERN = re.compile(
    r"https?://pan\.quark\.cn/s/[A-Za-z0-9]+",
    re.IGNORECASE,
)
_ACCESS_CODE_PATTERN = re.compile(
    r"(?:访问码|提取码|提取碼|密码|密碼|password|pwd)\s*[:：=]?\s*([A-Za-z0-9]{4})",
    re.IGNORECASE,
)
_URL_IN_LINE_PATTERN = re.compile(r"https?://", re.IGNORECASE)


@dataclass
class ParsedShareItem:
    """单条解析出的分享资源。"""

    pan_type: PanType
    share_url: str
    title: str = ""
    receive_code: str = ""


@dataclass
class BatchShareParseResult:
    """批量解析结果。"""

    items_115: list[ParsedShareItem] = field(default_factory=list)
    items_quark: list[ParsedShareItem] = field(default_factory=list)

    @property
    def has_115(self) -> bool:
        return bool(self.items_115)

    @property
    def has_quark(self) -> bool:
        return bool(self.items_quark)


def _clean_share_url(url: str) -> str:
    cleaned = str(url or "").strip().rstrip(")]}>,.;")
    if cleaned.endswith("#"):
        cleaned = cleaned[:-1]
    return cleaned


def _extract_receive_code(*texts: str) -> str:
    for text in texts:
        raw = str(text or "")
        if not raw:
            continue
        match = _ACCESS_CODE_PATTERN.search(raw)
        if match:
            return str(match.group(1) or "").strip()
        parsed = urlparse(raw)
        if parsed.query:
            for key in ("password", "pwd"):
                values = parse_qs(parsed.query).get(key) or []
                if values and str(values[0]).strip():
                    return str(values[0]).strip()[:4]
    return ""


def _is_title_candidate(line: str) -> bool:
    text = str(line or "").strip()
    if not text:
        return False
    if _URL_IN_LINE_PATTERN.search(text):
        return False
    if _ACCESS_CODE_PATTERN.fullmatch(text):
        return False
    return True


def _find_title_before(lines: list[str], url_line_index: int) -> str:
    for idx in range(url_line_index - 1, -1, -1):
        candidate = str(lines[idx] or "").strip()
        if _is_title_candidate(candidate):
            return candidate
    return ""


def _append_unique_item(
    items: list[ParsedShareItem],
    seen: set[str],
    *,
    pan_type: PanType,
    share_url: str,
    title: str,
    receive_code: str,
) -> None:
    normalized_url = _clean_share_url(share_url)
    if not normalized_url:
        return
    dedupe_key = f"{pan_type}:{normalized_url.lower()}"
    if dedupe_key in seen:
        return
    seen.add(dedupe_key)
    items.append(
        ParsedShareItem(
            pan_type=pan_type,
            share_url=normalized_url,
            title=str(title or "").strip(),
            receive_code=str(receive_code or "").strip(),
        )
    )


def parse_batch_share_text(text: str) -> BatchShareParseResult:
    """解析多行文本中的 115 / 夸克分享链接及可选标题、提取码。"""
    raw = str(text or "").strip()
    result = BatchShareParseResult()
    if not raw:
        return result

    lines = [str(line or "").rstrip() for line in raw.splitlines()]
    seen_115: set[str] = set()
    seen_quark: set[str] = set()

    for line_index, line in enumerate(lines):
        stripped = str(line or "").strip()
        if not stripped:
            continue

        for match in _PAN115_URL_PATTERN.finditer(stripped):
            share_url = _clean_share_url(match.group(0))
            title = _find_title_before(lines, line_index)
            receive_code = _extract_receive_code(stripped, raw)
            _append_unique_item(
                result.items_115,
                seen_115,
                pan_type="115",
                share_url=share_url,
                title=title,
                receive_code=receive_code,
            )

        for match in _QUARK_URL_PATTERN.finditer(stripped):
            share_url = _clean_share_url(match.group(0))
            title = _find_title_before(lines, line_index)
            _append_unique_item(
                result.items_quark,
                seen_quark,
                pan_type="quark",
                share_url=share_url,
                title=title,
                receive_code="",
            )

    return result

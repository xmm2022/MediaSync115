"""归档影片/文件夹命名格式配置与渲染"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from app.services.archive_subdir_config import INVALID_FOLDER_CHARS
from app.utils.resource_tags import extract_tags

DEFAULT_ARCHIVE_NAMING: dict[str, str] = {
    "movie_file": "{title} ({year}){ext}",
    "tv_file": "{title} ({year}) - S{season2}E{episode2}{ext}",
    "movie_folder": "{title} ({year})",
    "tv_folder": "{title} ({year})",
    "tv_season_folder": "第{season}季",
}

NAMING_TEMPLATE_KEYS = tuple(DEFAULT_ARCHIVE_NAMING.keys())

NAMING_TEMPLATE_LABELS: dict[str, str] = {
    "movie_file": "电影文件名",
    "tv_file": "剧集文件名",
    "movie_folder": "电影文件夹",
    "tv_folder": "剧集文件夹",
    "tv_season_folder": "剧集季文件夹",
}

HDR_LABELS = ("Dolby Vision", "HDR10+", "HDR10", "HDR", "SDR")
SOURCE_LABELS = ("REMUX", "BluRay", "WEB-DL")
CODEC_LABELS = ("HEVC", "H.264", "AV1")
AUDIO_LABELS = ("Atmos", "DTS-HD", "TrueHD", "DTS", "AAC", "FLAC")

NAMING_VARIABLES: list[dict[str, str]] = [
    {"key": "title", "label": "标题", "example": "黑客帝国", "group": "基础"},
    {"key": "year", "label": "年份", "example": "1999", "group": "基础"},
    {"key": "season", "label": "季（数字）", "example": "1", "group": "基础"},
    {"key": "season2", "label": "季（两位）", "example": "01", "group": "基础"},
    {"key": "episode", "label": "集（数字）", "example": "2", "group": "基础"},
    {"key": "episode2", "label": "集（两位）", "example": "02", "group": "基础"},
    {"key": "ext", "label": "扩展名", "example": ".mkv", "group": "基础"},
    {"key": "tmdb_id", "label": "TMDB ID", "example": "603", "group": "元数据"},
    {"key": "media_type", "label": "类型", "example": "movie", "group": "元数据"},
    {"key": "category", "label": "归档分类", "example": "华语电影", "group": "元数据"},
    {"key": "resolution", "label": "分辨率", "example": "4K", "group": "画质"},
    {"key": "hdr", "label": "HDR/动态范围", "example": "HDR10", "group": "画质"},
    {"key": "source", "label": "片源", "example": "WEB-DL", "group": "画质"},
    {"key": "codec", "label": "视频编码", "example": "HEVC", "group": "画质"},
    {"key": "audio", "label": "音频", "example": "Atmos", "group": "画质"},
    {"key": "format", "label": "常用画质组合", "example": "4K HDR HEVC", "group": "画质"},
    {"key": "formats", "label": "全部画质标签", "example": "4K.HDR.HEVC.WEB-DL", "group": "画质"},
]

NAMING_VARIABLE_GROUPS: list[dict[str, Any]] = [
    {"key": "basic", "label": "基础信息", "variables": ["title", "year", "season", "season2", "episode", "episode2", "ext"]},
    {"key": "meta", "label": "TMDB / 分类", "variables": ["tmdb_id", "media_type", "category"]},
    {"key": "quality", "label": "画质 / 格式", "variables": ["resolution", "hdr", "source", "codec", "audio", "format", "formats"]},
]

_INVALID_TEMPLATE_CHARS = re.compile(r'[\\/:*?"<>|]')


def sanitize_name_part(value: str) -> str:
    """清理标题等片段中的非法文件名字符"""
    return INVALID_FOLDER_CHARS.sub("", str(value or "")).strip()


def _pick_first_label(labels: tuple[str, ...], candidates: list[str]) -> str:
    for label in labels:
        if label in candidates:
            return label
    return ""


def extract_naming_media_tags(source_filename: str = "") -> dict[str, str]:
    """从源文件名提取分辨率、HDR、编码等画质标签"""
    filename = str(source_filename or "").strip()
    if not filename:
        return {
            "resolution": "",
            "hdr": "",
            "source": "",
            "codec": "",
            "audio": "",
            "format": "",
            "formats": "",
        }

    tags = extract_tags({"resource_name": filename})
    resolution = str(tags.get("resolution") or "").strip()
    format_list = [str(item).strip() for item in (tags.get("formats") or []) if str(item).strip()]
    hdr = _pick_first_label(HDR_LABELS, format_list)
    source = _pick_first_label(SOURCE_LABELS, format_list)
    codec = _pick_first_label(CODEC_LABELS, format_list)
    audio = _pick_first_label(AUDIO_LABELS, format_list)

    compact_parts = [part for part in (resolution, hdr, codec) if part]
    format_text = " ".join(compact_parts)

    all_parts: list[str] = []
    seen: set[str] = set()
    for part in [resolution, *format_list]:
        if not part or part in seen:
            continue
        all_parts.append(part)
        seen.add(part)
    formats_text = ".".join(all_parts)

    return {
        "resolution": resolution,
        "hdr": hdr,
        "source": source,
        "codec": codec,
        "audio": audio,
        "format": format_text,
        "formats": formats_text,
    }


def _cleanup_rendered_name(text: str) -> str:
    """渲染后清理多余空白与空括号"""
    cleaned = str(text or "")
    cleaned = re.sub(r"\s*\(\s*\)", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+-\s+-", " - ", cleaned)
    cleaned = re.sub(r"\.{2,}", ".", cleaned)
    cleaned = re.sub(r"\s+\.", ".", cleaned)
    return cleaned.strip(" -.").strip()


def _validate_template(key: str, template: str) -> str:
    normalized = str(template or "").strip()
    if not normalized:
        return DEFAULT_ARCHIVE_NAMING[key]
    if _INVALID_TEMPLATE_CHARS.search(normalized):
        raise ValueError(f"命名模板「{NAMING_TEMPLATE_LABELS.get(key, key)}」包含非法字符")
    if len(normalized) > 200:
        raise ValueError(f"命名模板「{NAMING_TEMPLATE_LABELS.get(key, key)}」过长")
    return normalized


def normalize_archive_naming(raw: dict[str, Any] | None = None) -> dict[str, str]:
    """归一化命名格式配置"""
    source = raw if isinstance(raw, dict) else {}
    result: dict[str, str] = {}
    for key in NAMING_TEMPLATE_KEYS:
        result[key] = _validate_template(key, source.get(key) or DEFAULT_ARCHIVE_NAMING[key])
    return result


def build_naming_context(
    *,
    title: str,
    year: str = "",
    season: int | None = None,
    episode: int | None = None,
    ext: str = "",
    tmdb_id: int | str | None = None,
    media_type: str = "",
    category: str = "",
    source_filename: str = "",
) -> dict[str, str]:
    """构建模板渲染上下文"""
    season_num = max(1, int(season or 1))
    episode_num = max(1, int(episode or 1))
    safe_title = sanitize_name_part(title)
    safe_year = str(year or "").strip()
    safe_ext = str(ext or "")
    if safe_ext and not safe_ext.startswith("."):
        safe_ext = f".{safe_ext.lstrip('.')}"

    media_tags = extract_naming_media_tags(source_filename)
    tmdb_text = str(tmdb_id or "").strip()
    media_type_text = str(media_type or "").strip().lower()
    if media_type_text not in {"movie", "tv"}:
        media_type_text = ""

    context = {
        "title": safe_title,
        "year": safe_year,
        "season": str(season_num),
        "season2": f"{season_num:02d}",
        "episode": str(episode_num),
        "episode2": f"{episode_num:02d}",
        "ext": safe_ext,
        "tmdb_id": tmdb_text,
        "media_type": media_type_text,
        "category": sanitize_name_part(category),
        **media_tags,
    }
    return context


def render_archive_template(template: str, context: dict[str, str]) -> str:
    """按模板渲染名称"""
    result = str(template or "")
    for key, value in context.items():
        result = result.replace(f"{{{key}}}", str(value or ""))
    return _cleanup_rendered_name(result)


def render_archive_name(
    naming: dict[str, str] | None,
    template_key: str,
    *,
    title: str,
    year: str = "",
    season: int | None = None,
    episode: int | None = None,
    ext: str = "",
    tmdb_id: int | str | None = None,
    media_type: str = "",
    category: str = "",
    source_filename: str = "",
) -> str:
    """渲染指定类型的归档名称"""
    config = normalize_archive_naming(naming)
    template = config.get(template_key) or DEFAULT_ARCHIVE_NAMING[template_key]
    context = build_naming_context(
        title=title,
        year=year,
        season=season,
        episode=episode,
        ext=ext,
        tmdb_id=tmdb_id,
        media_type=media_type,
        category=category,
        source_filename=source_filename,
    )
    rendered = render_archive_template(template, context)
    if not rendered:
        fallback_title = context["title"] or "未命名"
        if template_key.endswith("_file"):
            return f"{fallback_title}{context['ext']}"
        return fallback_title
    return rendered


def get_archive_naming_options() -> dict[str, Any]:
    """前端可视化配置所需的变量说明"""
    variable_map = {item["key"]: item for item in NAMING_VARIABLES}
    groups = []
    for group in NAMING_VARIABLE_GROUPS:
        groups.append(
            {
                "key": group["key"],
                "label": group["label"],
                "variables": [variable_map[key] for key in group["variables"] if key in variable_map],
            }
        )
    return {
        "defaults": deepcopy(DEFAULT_ARCHIVE_NAMING),
        "templates": [
            {"key": key, "label": NAMING_TEMPLATE_LABELS[key]}
            for key in NAMING_TEMPLATE_KEYS
        ],
        "variables": deepcopy(NAMING_VARIABLES),
        "variable_groups": groups,
        "examples": {
            "title": "黑客帝国",
            "year": "1999",
            "season": 1,
            "episode": 2,
            "ext": ".mkv",
            "tmdb_id": 603,
            "media_type": "movie",
            "category": "华语电影",
            "source_filename": "The.Matrix.1999.2160p.HDR10.HEVC.WEB-DL.Atmos.mkv",
        },
    }

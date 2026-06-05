"""片单导入预设目录：流媒体平台与奖项盛典。"""

from typing import Any, TypedDict


class ImportCatalogItem(TypedDict, total=False):
    key: str
    label: str
    description: str
    fetcher: str
    provider_names: list[str]
    fallback_provider_ids: list[int]
    media: str
    list_id: int
    search_queries: list[str]
    source_type: str
    example_url: str


class ImportCatalogCategory(TypedDict):
    key: str
    label: str
    description: str
    items: list[ImportCatalogItem]


# TMDB 无中国大陆（CN）流媒体片库数据，导入时会自动回退到 HK / TW / US 等地区
_STREAMING_ITEMS: list[ImportCatalogItem] = [
    {
        "key": "netflix",
        "label": "Netflix",
        "description": "Netflix 可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["Netflix"],
        "fallback_provider_ids": [8],
        "media": "both",
    },
    {
        "key": "disney_plus",
        "label": "Disney+",
        "description": "Disney+ 可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["Disney Plus", "Disney+"],
        "fallback_provider_ids": [337],
        "media": "both",
    },
    {
        "key": "amazon_prime",
        "label": "Prime Video",
        "description": "Amazon Prime Video 可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["Amazon Prime Video", "Prime Video"],
        "fallback_provider_ids": [9, 119],
        "media": "both",
    },
    {
        "key": "apple_tv_plus",
        "label": "Apple TV+",
        "description": "Apple TV+ 原创与片库内容",
        "fetcher": "watch_provider",
        "provider_names": ["Apple TV"],
        "fallback_provider_ids": [350],
        "media": "both",
    },
    {
        "key": "hbo_max",
        "label": "Max (HBO)",
        "description": "Max / HBO 可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["HBO Max", "Max"],
        "fallback_provider_ids": [384, 1899],
        "media": "both",
    },
    {
        "key": "paramount_plus",
        "label": "Paramount+",
        "description": "Paramount+ 可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["Paramount Plus", "Paramount+"],
        "fallback_provider_ids": [531, 2303, 2616],
        "media": "both",
    },
    {
        "key": "iqiyi",
        "label": "爱奇艺",
        "description": "爱奇艺可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["iQIYI", "iQiyi"],
        "fallback_provider_ids": [581, 133],
        "media": "both",
    },
    {
        "key": "youku",
        "label": "优酷",
        "description": "优酷可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["Youku"],
        "fallback_provider_ids": [190],
        "media": "both",
    },
    {
        "key": "tencent_video",
        "label": "腾讯视频",
        "description": "腾讯视频 / WeTV 可观看的电影与剧集",
        "fetcher": "watch_provider",
        "provider_names": ["WeTV", "Tencent Video"],
        "fallback_provider_ids": [623, 1170],
        "media": "both",
    },
    {
        "key": "bilibili",
        "label": "哔哩哔哩",
        "description": "哔哩哔哩可观看的影视内容（TMDB 片库覆盖有限）",
        "fetcher": "watch_provider",
        "provider_names": ["Bilibili"],
        "fallback_provider_ids": [12444],
        "media": "both",
    },
]

_AWARD_ITEMS: list[ImportCatalogItem] = [
    {
        "key": "oscar_best_picture",
        "label": "奥斯卡 · 最佳影片",
        "description": "历年奥斯卡最佳影片获奖作品",
        "fetcher": "tmdb_list",
        "list_id": 101353,
    },
    {
        "key": "golden_globe_drama",
        "label": "金球奖 · 剧情片最佳",
        "description": "金球奖剧情类最佳影片",
        "fetcher": "tmdb_list",
        "list_id": 2469,
    },
    {
        "key": "bafta_best_film",
        "label": "英国电影学院奖 · 最佳影片",
        "description": "BAFTA 最佳影片获奖作品",
        "fetcher": "tmdb_list",
        "list_id": 3681,
    },
    {
        "key": "cannes_palme_dor",
        "label": "戛纳 · 金棕榈奖",
        "description": "戛纳电影节金棕榈奖获奖影片",
        "fetcher": "tmdb_list",
        "list_id": 229,
    },
    {
        "key": "berlin_golden_bear",
        "label": "柏林 · 金熊奖精选",
        "description": "柏林电影节金熊奖经典获奖作品",
        "fetcher": "tmdb_list",
        "list_id": 17434,
    },
    {
        "key": "golden_horse_best_film",
        "label": "金马奖 · 最佳剧情片",
        "description": "台北金马影展最佳剧情片（社区维护 TMDB 片单）",
        "fetcher": "tmdb_list_search",
        "search_queries": [
            "Golden Horse Award Best Feature Film",
            "Golden Horse Best Picture",
            "金马奖最佳剧情片",
        ],
    },
    {
        "key": "hong_kong_film_award_best_film",
        "label": "香港电影金像奖 · 最佳影片",
        "description": "香港电影金像奖最佳影片（社区维护 TMDB 片单）",
        "fetcher": "tmdb_list_search",
        "search_queries": [
            "Hong Kong Film Award Best Film",
            "香港电影金像奖最佳电影",
            "HKFA Best Film winners",
        ],
    },
    {
        "key": "huabiao_best_film",
        "label": "华表奖 · 优秀故事片",
        "description": "中国电影华表奖优秀故事片（社区维护 TMDB 片单）",
        "fetcher": "tmdb_list_search",
        "search_queries": [
            "Huabiao Award best film",
            "中国电影华表奖",
            "华表奖优秀故事片",
        ],
    },
]

_ADVANCED_ITEMS: list[ImportCatalogItem] = [
    {
        "key": "tmdb_list",
        "label": "TMDB 公开片单",
        "description": "粘贴 TMDB 用户创建的公开片单链接（/list/ID）",
        "fetcher": "tmdb_reference",
        "source_type": "tmdb_list",
        "example_url": "https://www.themoviedb.org/list/634",
    },
    {
        "key": "tmdb_collection",
        "label": "TMDB 影视合集",
        "description": "粘贴 TMDB 官方合集链接（/collection/ID）",
        "fetcher": "tmdb_reference",
        "source_type": "tmdb_collection",
        "example_url": "https://www.themoviedb.org/collection/9485",
    },
    {
        "key": "tmdb_keyword",
        "label": "TMDB 关键词",
        "description": "粘贴 TMDB 关键词链接（/keyword/ID）",
        "fetcher": "tmdb_reference",
        "source_type": "tmdb_keyword",
        "example_url": "https://www.themoviedb.org/keyword/210024",
    },
]

IMPORT_CATALOG: list[ImportCatalogCategory] = [
    {
        "key": "streaming",
        "label": "流媒体平台",
        "description": "按 TMDB 片库导入（CN 无数据时会自动使用 HK / TW / US 等地区）",
        "items": _STREAMING_ITEMS,
    },
    {
        "key": "awards",
        "label": "奖项盛典",
        "description": "奥斯卡、金像奖、华表奖等获奖或提名片单（数据来自 TMDB 社区片单）",
        "items": _AWARD_ITEMS,
    },
    {
        "key": "advanced",
        "label": "高级",
        "description": "手动粘贴 TMDB 链接或 ID 导入自定义片单",
        "items": _ADVANCED_ITEMS,
    },
]

_CATALOG_INDEX: dict[str, tuple[str, ImportCatalogItem]] = {}
for category in IMPORT_CATALOG:
    for item in category["items"]:
        _CATALOG_INDEX[item["key"]] = (category["key"], item)


def get_import_catalog() -> list[dict[str, Any]]:
    """返回可序列化的导入目录（不含内部 fetcher 细节）。"""
    result: list[dict[str, Any]] = []
    for category in IMPORT_CATALOG:
        items: list[dict[str, Any]] = []
        for item in category["items"]:
            serialized: dict[str, Any] = {
                "key": item["key"],
                "label": item["label"],
                "description": item.get("description", ""),
            }
            if item.get("example_url"):
                serialized["example_url"] = item["example_url"]
            if item.get("fetcher") == "tmdb_reference":
                serialized["requires_reference"] = True
                serialized["source_type"] = item.get("source_type")
            else:
                serialized["requires_reference"] = False
            items.append(serialized)
        result.append(
            {
                "key": category["key"],
                "label": category["label"],
                "description": category["description"],
                "items": items,
            }
        )
    return result


def resolve_catalog_item(source_key: str) -> tuple[str, ImportCatalogItem]:
    """根据 source_key 解析目录项。"""
    normalized = str(source_key or "").strip()
    if not normalized:
        raise ValueError("请选择要导入的片单来源")
    matched = _CATALOG_INDEX.get(normalized)
    if not matched:
        raise ValueError(f"不支持的导入来源: {normalized}")
    return matched

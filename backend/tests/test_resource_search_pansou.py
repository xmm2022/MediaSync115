from __future__ import annotations

from app.services.resource_search import normalize_pansou_pan115_list


def test_normalize_pansou_pan115_list_extracts_nested_115_links() -> None:
    payload = {
        "data": {
            "results": [
                {
                    "title": "示例电影 2026 2160p",
                    "size": "18 GB",
                    "resolution": "2160p",
                    "links": [
                        {"type": "quark", "url": "https://pan.quark.cn/s/not-used"},
                        {"type": "115", "url": "https://115.com/s/abc123?password=xy12"},
                    ],
                },
                {
                    "name": "重复链接",
                    "share_url": "https://115.com/s/abc123?password=xy12",
                },
                {
                    "name": "无效网盘",
                    "share_link": "https://example.com/not-115",
                },
                {
                    "content": "分享码：def456 提取码：zz99",
                    "quality": "BluRay",
                },
            ]
        }
    }

    items = normalize_pansou_pan115_list(payload)

    assert [item["share_link"] for item in items] == [
        "https://115.com/s/abc123?password=xy12",
        "def456-zz99",
    ]
    assert items[0]["title"] == "示例电影 2026 2160p"
    assert items[0]["size"] == "18 GB"
    assert items[0]["resolution"] == "2160p"
    assert items[0]["source_service"] == "pansou"
    assert items[0]["raw_item"]["title"] == "示例电影 2026 2160p"
    assert items[1]["title"] == "115资源 #2"
    assert items[1]["quality"] == "BluRay"


def test_normalize_pansou_pan115_list_accepts_plain_share_codes() -> None:
    payload = {
        "items": [
            {"title": "纯分享码", "share_code": "ABCDEF-1234"},
            {"title": "anxia 域名", "url": "https://anxia.com/s/xyz789"},
            {"title": "115cdn 域名", "url": "https://115cdn.com/s/cdn789"},
        ]
    }

    items = normalize_pansou_pan115_list(payload)

    assert [item["share_link"] for item in items] == [
        "ABCDEF-1234",
        "https://anxia.com/s/xyz789",
        "https://115cdn.com/s/cdn789",
    ]

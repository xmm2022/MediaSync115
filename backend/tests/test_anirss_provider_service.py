import pytest

from app.api.anime import AniRssSubscriptionPayload
from app.services.anirss_provider_service import (
    AniRssProviderError,
    AniRssProviderService,
)


def test_anirss_create_payload_defaults_to_disabled():
    payload = AniRssSubscriptionPayload(
        rss_url="https://mikanani.me/RSS/Bangumi?bangumiId=3141"
    )

    assert payload.enable is False


def test_build_rss_payload_defaults_to_disabled():
    payload = AniRssProviderService._build_rss_payload(
        {"rss_url": "https://mikanani.me/RSS/Bangumi?bangumiId=3141"}
    )

    assert payload["enable"] is False


def test_build_rss_payload_ignores_enable_true():
    payload = AniRssProviderService._build_rss_payload(
        {
            "rss_url": "https://mikanani.me/RSS/Bangumi?bangumiId=3141",
            "enable": True,
        }
    )

    assert payload["enable"] is False


def test_apply_payload_overrides_keeps_new_subscription_disabled():
    ani = {"id": "ani-1", "title": "Test Anime", "enable": True}

    AniRssProviderService._apply_payload_overrides(ani, {"enable": True})

    assert ani["enable"] is False


def test_flatten_ani_items_reads_week_list():
    data = {
        "total": 1,
        "weekList": [
            {"items": []},
            {"items": [{"id": "ani-1", "title": "Test Anime"}]},
        ],
    }

    assert AniRssProviderService._flatten_ani_items(data) == [
        {"id": "ani-1", "title": "Test Anime"}
    ]


def test_normalize_ani_item_exposes_status_and_preview_summary():
    item = AniRssProviderService._normalize_ani_item(
        {
            "id": "ani-1",
            "title": "Test Anime",
            "enable": False,
            "currentEpisodeNumber": 3,
            "totalEpisodeNumber": 12,
            "url": "https://example.test/rss.xml",
            "downloadPath": "/Media/番剧/Test Anime/Season 1",
            "customDownloadPath": True,
        },
        preview_summary={
            "matched_count": 2,
            "duplicate_ignored_count": 1,
            "matched_items": [{"title": "Test Anime 03"}],
            "duplicate_ignored_items": [{"title": "Test Anime 01"}],
        },
    )

    assert item["status"] == "paused"
    assert item["enabled"] is False
    assert item["current_episode"] == 3
    assert item["total_episodes"] == 12
    assert item["rss_url"] == "https://example.test/rss.xml"
    assert item["custom_download_path"] is True
    assert item["matched_count"] == 2
    assert item["duplicate_ignored_count"] == 1
    assert item["recent_hit"] == {"title": "Test Anime 03"}


class _FakeReadOnlyAniRssClient:
    base_url = "http://ani-rss:7789"

    def __init__(self):
        self.preview_calls = []

    async def list_ani(self):
        return {
            "total": 1,
            "items": [
                {
                    "id": "ani-1",
                    "title": "Test Anime",
                    "enable": False,
                    "url": "https://example.test/rss.xml",
                }
            ],
        }

    async def preview_ani(self, ani):
        self.preview_calls.append(ani["id"])
        return {"items": [], "omitList": []}


@pytest.mark.asyncio
async def test_list_subscriptions_without_db_is_read_only_and_lightweight():
    fake = _FakeReadOnlyAniRssClient()
    service = AniRssProviderService(client_factory=lambda: fake)

    result = await service.list_subscriptions(None, include_preview=False)

    assert fake.preview_calls == []
    assert result["sync"]["sync_local"] is False
    assert result["sync"]["local_count"] == 0
    assert result["sync"]["include_preview"] is False
    assert result["sync"]["updated_local"] is False
    assert result["items"][0]["external_subscription_id"] == "ani-1"


def test_extract_download_client_config_is_sanitized():
    config = {
        "downloadToolType": "qBittorrent",
        "downloadToolHost": "http://qbittorrent:8080",
        "downloadToolUsername": "admin",
        "downloadToolPassword": "mediasync-docker-whitelist",
        "qbUseDownloadPath": True,
        "rss": True,
        "downloadNew": False,
        "autoStart": False,
        "downloadPathTemplate": "/Media/番剧/${title}/Season ${season}",
    }

    status = AniRssProviderService._extract_download_client_config(config)

    assert status["download_tool_type"] == "qBittorrent"
    assert status["download_tool_host"] == "http://qbittorrent:8080"
    assert status["download_tool_password_configured"] is True
    assert status["download_tool_password_matches_default"] is True
    assert "downloadToolPassword" not in status


def test_collect_download_client_issues_keeps_download_disabled_safe():
    actual = AniRssProviderService._extract_download_client_config(
        AniRssProviderService.DEFAULT_DOWNLOAD_CLIENT
    )

    assert AniRssProviderService._collect_download_client_issues(
        actual,
        AniRssProviderService.DEFAULT_DOWNLOAD_CLIENT,
    ) == []
    assert actual["download_new"] is False
    assert actual["auto_start"] is False


class _FakeMikanAniRssClient:
    base_url = "http://ani-rss:7789"

    def __init__(self, data, groups=None):
        self.data = data
        self.groups = groups or []
        self.mikan_calls = []
        self.group_calls = []

    async def mikan(self, text, season):
        self.mikan_calls.append((text, season))
        return self.data

    async def mikan_group(self, url):
        self.group_calls.append(url)
        return self.groups


@pytest.mark.asyncio
async def test_discover_mikan_candidates_uses_anirss_exact_bangumi_id():
    fake = _FakeMikanAniRssClient(
        {
            "weeks": [
                {
                    "weekLabel": "Search",
                    "items": [
                        {
                            "title": "Test Anime",
                            "url": "https://mikanani.me/Home/Bangumi/3906",
                        }
                    ],
                }
            ]
        },
        groups=[
            {
                "subgroupId": "370",
                "label": "ANi",
                "rss": "https://mikanani.me/RSS/Bangumi?bangumiId=3906&subgroupid=370",
                "bgmUrl": "https://bgm.tv/subject/3141",
            }
        ],
    )
    service = AniRssProviderService(client_factory=lambda: fake)

    result = await service.discover_mikan_rss_candidates(
        "Test Anime",
        bangumi_id="3141",
    )

    assert fake.mikan_calls == [("Test Anime", {})]
    assert fake.group_calls == ["https://mikanani.me/Home/Bangumi/3906"]
    assert result["provider"] == "anirss"
    assert result["matched"] is True
    assert result["candidates"][0]["rss_url"].endswith("subgroupid=370")
    assert result["candidates"][0]["subgroup"] == "ANi"
    assert result["candidates"][0]["mikan_id"] == "3906"
    assert result["candidates"][0]["bangumi_id"] == "3141"


@pytest.mark.asyncio
async def test_discover_mikan_candidates_rejects_bangumi_mismatch():
    fake = _FakeMikanAniRssClient(
        {
            "weeks": [
                {
                    "weekLabel": "Search",
                    "items": [
                        {
                            "title": "Wrong Anime",
                            "url": "https://mikanani.me/Home/Bangumi/9999",
                        }
                    ],
                }
            ]
        },
        groups=[
            {
                "subgroupId": "370",
                "label": "ANi",
                "rss": "https://mikanani.me/RSS/Bangumi?bangumiId=9999&subgroupid=370",
                "bgmUrl": "https://bgm.tv/subject/9999",
            }
        ],
    )
    service = AniRssProviderService(client_factory=lambda: fake)

    result = await service.discover_mikan_rss_candidates(
        "Test Anime",
        bangumi_id="3141",
    )

    assert result["matched"] is False
    assert result["candidates"] == []


class _FakeMultiSourceAniRssClient:
    base_url = "http://ani-rss:7789"

    async def mikan(self, text, season):
        return {
            "weeks": [
                {
                    "items": [
                        {
                            "title": "Test Anime",
                            "url": "https://mikanani.me/Home/Bangumi/3906",
                        }
                    ]
                }
            ]
        }

    async def mikan_group(self, url):
        return [
            {
                "subgroupId": "370",
                "label": "ANi",
                "rss": "https://mikanani.me/RSS/Bangumi?bangumiId=3906&subgroupid=370",
                "bgmUrl": "https://bgm.tv/subject/3141",
            }
        ]

    async def ani_bt(self, *, season="", bgm_url=""):
        return {
            "byWeekday": [
                {
                    "animes": [
                        {
                            "animeId": "ani-bt-1",
                            "bgmId": "3141",
                            "title": {"primary": "Test Anime"},
                        }
                    ]
                }
            ]
        }

    async def ani_bt_group(self, bgm_id):
        return [
            {
                "bgmId": bgm_id,
                "groupId": "group-1",
                "slug": "fansub",
                "name": "AniBT Fansub",
                "rss": f"https://anibt.net/rss/anime.xml?bgmId={bgm_id}&groupSlug=fansub",
            }
        ]

    async def anime_garden_list(self, *, bgm_url=""):
        return [
            {
                "weekLabel": "搜索",
                "subjects": [
                    {
                        "id": "3141",
                        "name": "Test Anime",
                    }
                ],
            }
        ]

    async def anime_garden_group(self, bgm_id):
        return [
            {
                "id": "garden-group",
                "bgmId": bgm_id,
                "name": "Garden Fansub",
                "rss": f"https://api.animes.garden/feed.xml?subject={bgm_id}&fansub=Garden",
            }
        ]


@pytest.mark.asyncio
async def test_discover_anirss_candidates_collects_supported_sources():
    service = AniRssProviderService(client_factory=_FakeMultiSourceAniRssClient)

    result = await service.discover_anirss_rss_candidates(
        "Test Anime",
        bangumi_id="3141",
        limit=12,
    )

    sources = {candidate["source"] for candidate in result["candidates"]}
    assert result["source"] == "anirss"
    assert result["matched"] is True
    assert sources == {"mikan", "ani-bt", "anime-garden"}
    assert {candidate["rss_type"] for candidate in result["candidates"]} == {
        "mikan",
        "ani-bt",
        "anime-garden",
    }
    assert all(candidate["bangumi_id"] == "3141" for candidate in result["candidates"])


class _FakePreviewExistingAniRssClient:
    base_url = "http://ani-rss:7789"

    def __init__(self):
        self.preview_calls = []

    async def list_ani(self):
        return {
            "items": [
                {
                    "id": "ani-1",
                    "title": "Test Anime",
                    "enable": False,
                    "url": "https://example.test/rss.xml",
                    "downloadPath": "/Media/番剧/Test Anime",
                    "currentEpisodeNumber": 3,
                    "totalEpisodeNumber": 12,
                }
            ]
        }

    async def preview_ani(self, ani):
        self.preview_calls.append(ani["id"])
        return {
            "downloadPath": "/Media/番剧/Test Anime",
            "items": [{"title": "Test Anime 04"}],
            "omitList": [{"title": "Test Anime 01"}],
        }


@pytest.mark.asyncio
async def test_preview_existing_subscription_summarizes_single_ani():
    fake = _FakePreviewExistingAniRssClient()
    service = AniRssProviderService(client_factory=lambda: fake)

    result = await service.preview_existing_subscription("ani-1", preview_limit=5)

    assert fake.preview_calls == ["ani-1"]
    assert result["ok"] is True
    assert result["external_subscription_id"] == "ani-1"
    assert result["summary"]["matched_count"] == 1
    assert result["summary"]["duplicate_ignored_count"] == 1
    assert result["item"]["matched_count"] == 1
    assert result["item"]["recent_hit"] == {"title": "Test Anime 04", "episode": None, "subgroup": None, "info_hash": None, "pub_date": None}
    assert result["item"]["enabled"] is False


@pytest.mark.asyncio
async def test_preview_existing_subscription_requires_existing_ani():
    service = AniRssProviderService(client_factory=_FakePreviewExistingAniRssClient)

    with pytest.raises(AniRssProviderError, match="订阅不存在"):
        await service.preview_existing_subscription("missing")


class _FakeDeleteAniRssClient:
    base_url = "http://ani-rss:7789"

    def __init__(self):
        self.delete_calls = []

    async def list_ani(self):
        return {
            "items": [
                {
                    "id": "ani-1",
                    "title": "Test Anime",
                    "enable": False,
                }
            ]
        }

    async def delete_ani(self, ani_ids, *, delete_files=False):
        self.delete_calls.append((ani_ids, delete_files))
        return {"code": 200, "message": "删除订阅成功"}


@pytest.mark.asyncio
async def test_delete_subscription_calls_remote_without_deleting_files():
    fake = _FakeDeleteAniRssClient()
    service = AniRssProviderService(client_factory=lambda: fake)

    result = await service.delete_subscription("ani-1")

    assert fake.delete_calls == [(["ani-1"], False)]
    assert result["ok"] is True
    assert result["external_subscription_id"] == "ani-1"
    assert result["delete_files"] is False
    assert result["deleted_local"] is False


@pytest.mark.asyncio
async def test_delete_subscription_requires_existing_ani():
    fake = _FakeDeleteAniRssClient()
    service = AniRssProviderService(client_factory=lambda: fake)

    with pytest.raises(AniRssProviderError, match="订阅不存在"):
        await service.delete_subscription("missing")

    assert fake.delete_calls == []

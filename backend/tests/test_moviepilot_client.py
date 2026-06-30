import httpx
import pytest

from app.services.moviepilot_client import MoviePilotClient


@pytest.mark.asyncio
async def test_search_logs_in_and_uses_bearer_token() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/v1/login/access-token":
            assert request.method == "POST"
            assert request.headers["content-type"].startswith(
                "application/x-www-form-urlencoded"
            )
            body = request.content.decode("utf-8")
            assert "username=admin" in body
            assert "password=secret" in body
            return httpx.Response(
                200,
                json={"token_type": "bearer", "access_token": "fresh-token"},
            )
        if request.url.path == "/api/v1/search/title":
            assert request.headers["authorization"] == "bearer fresh-token"
            assert request.url.params["keyword"] == "Dune"
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "data": [
                        {
                            "meta_info": {"title": "Dune", "year": "2021"},
                            "torrent_info": {"title": "Dune.2021", "size": 1024},
                        }
                    ],
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    saved_tokens: list[str] = []
    client = MoviePilotClient(
        base_url="http://moviepilot.local",
        username="admin",
        password="secret",
        transport=httpx.MockTransport(handler),
        token_updater=saved_tokens.append,
    )

    results = await client.search_title("Dune")

    assert results == [
        {
            "meta_info": {"title": "Dune", "year": "2021"},
            "torrent_info": {"title": "Dune.2021", "size": 1024},
        }
    ]
    assert saved_tokens == ["bearer fresh-token"]
    assert [request.url.path for request in requests] == [
        "/api/v1/login/access-token",
        "/api/v1/search/title",
    ]


@pytest.mark.asyncio
async def test_request_refreshes_token_once_after_unauthorized() -> None:
    search_attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal search_attempts
        if request.url.path == "/api/v1/search/title":
            search_attempts += 1
            if search_attempts == 1:
                assert request.headers["authorization"] == "bearer stale-token"
                return httpx.Response(401, json={"detail": "expired"})
            assert request.headers["authorization"] == "bearer fresh-token"
            return httpx.Response(200, json={"success": True, "data": []})
        if request.url.path == "/api/v1/login/access-token":
            return httpx.Response(
                200,
                json={"token_type": "bearer", "access_token": "fresh-token"},
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = MoviePilotClient(
        base_url="http://moviepilot.local",
        username="admin",
        password="secret",
        access_token="bearer stale-token",
        transport=httpx.MockTransport(handler),
    )

    assert await client.search_title("Dune") == []
    assert search_attempts == 2


@pytest.mark.asyncio
async def test_add_download_uses_media_endpoint_when_media_in_present() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "bearer token"
        if request.url.path == "/api/v1/download/":
            return httpx.Response(200, json={"success": True, "data": {"download_id": "d1"}})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = MoviePilotClient(
        base_url="http://moviepilot.local",
        username="admin",
        password="secret",
        access_token="bearer token",
        transport=httpx.MockTransport(handler),
    )

    result = await client.add_download(
        {
            "media_in": {"title": "Dune", "type": "movie"},
            "torrent_in": {"title": "Dune.2021", "enclosure": "https://example/torrent"},
        }
    )

    assert result["success"] is True
    assert [request.url.path for request in requests] == ["/api/v1/download/"]


@pytest.mark.asyncio
async def test_add_download_uses_add_endpoint_without_media_in() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/download/add"
        return httpx.Response(200, json={"success": True})

    client = MoviePilotClient(
        base_url="http://moviepilot.local",
        username="admin",
        password="secret",
        access_token="bearer token",
        transport=httpx.MockTransport(handler),
    )

    assert (await client.add_download({"torrent_in": {"title": "Dune", "enclosure": "u"}}))["success"] is True

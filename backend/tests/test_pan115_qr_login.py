"""115 扫码登录设备列表测试"""

from datetime import timedelta

import pytest

from app.constants.pan115_qr_login import (
    PAN115_QR_LOGIN_ALLOWED_APPS,
    list_pan115_qr_login_app_options,
    normalize_pan115_qr_login_app,
)
from app.core.timezone_utils import beijing_now
from app.services import pan115_service as pan115_service_module
from app.services.pan115_service import Pan115Service


class TestPan115QrLoginApps:
    def test_normalize_rejects_unknown_app(self) -> None:
        assert normalize_pan115_qr_login_app("web") == "ios"
        assert normalize_pan115_qr_login_app("bios") == "ios"
        assert normalize_pan115_qr_login_app("os_windows") == "ios"

    def test_normalize_keeps_valid_app(self) -> None:
        assert normalize_pan115_qr_login_app("wechatmini") == "wechatmini"
        assert normalize_pan115_qr_login_app("qandroid") == "qandroid"

    def test_list_options_match_allowed_set(self) -> None:
        items = list_pan115_qr_login_app_options()
        values = {item["value"] for item in items}
        assert values == set(PAN115_QR_LOGIN_ALLOWED_APPS)
        assert "web" not in values
        assert "alipaymini" in values


@pytest.fixture()
def clear_qr_sessions():
    Pan115Service._QR_LOGIN_PENDING.clear()
    yield
    Pan115Service._QR_LOGIN_PENDING.clear()


def _store_qr_session(
    token: str,
    *,
    uid: str = "uid-test",
    app: str = "ios",
    qr_url: str = "https://115.com/scan/dg-uid-test",
    qr_url_source: str = "token",
) -> None:
    Pan115Service._QR_LOGIN_PENDING[token] = {
        "token": token,
        "uid": uid,
        "scan_payload": {"uid": uid, "time": 1, "sign": "sign"},
        "qr_url": qr_url,
        "qr_url_source": qr_url_source,
        "app": app,
        "state": "pending",
        "message": "等待扫码",
        "created_at": beijing_now(),
        "expires_at": beijing_now() + timedelta(seconds=180),
        "cookie": "",
    }


@pytest.mark.asyncio
async def test_qr_login_image_builds_token_qrcode_locally(
    monkeypatch: pytest.MonkeyPatch,
    clear_qr_sessions,
) -> None:
    token = "token-with-qrcode"
    qr_url = "https://115.com/scan/dg-token-uid"
    _store_qr_session(token, uid="token-uid", app="wechatmini", qr_url=qr_url)

    async def fail_fetch(uid: str, app: str) -> bytes:
        raise AssertionError("token qrcode should not fetch upstream image")

    def fake_build(content: str) -> bytes:
        assert content == qr_url
        return b"local-qr"

    monkeypatch.setattr(Pan115Service, "_fetch_qr_login_image", staticmethod(fail_fetch))
    monkeypatch.setattr(Pan115Service, "_build_qr_login_image", staticmethod(fake_build))

    assert await Pan115Service().get_qr_login_image(token) == b"local-qr"


@pytest.mark.asyncio
async def test_qr_login_image_fetches_uid_bound_image_for_fallback_qrcode(
    monkeypatch: pytest.MonkeyPatch,
    clear_qr_sessions,
) -> None:
    token = "token-fallback-qrcode"
    _store_qr_session(
        token,
        uid="ipad-uid",
        app="ipad",
        qr_url="https://115.com/scan/dg-ipad-uid",
        qr_url_source="fallback",
    )

    async def fake_fetch(uid: str, app: str) -> bytes:
        assert uid == "ipad-uid"
        assert app == "ipad"
        return b"\x89PNG\r\n\x1a\nuid-bound"

    def fail_build(content: str) -> bytes:
        raise AssertionError("uid-bound upstream image should be returned directly")

    monkeypatch.setattr(Pan115Service, "_fetch_qr_login_image", staticmethod(fake_fetch))
    monkeypatch.setattr(Pan115Service, "_build_qr_login_image", staticmethod(fail_build))

    assert await Pan115Service().get_qr_login_image(token) == b"\x89PNG\r\n\x1a\nuid-bound"


@pytest.mark.asyncio
async def test_qr_login_image_falls_back_to_local_generated_content(
    monkeypatch: pytest.MonkeyPatch,
    clear_qr_sessions,
) -> None:
    token = "token-fallback-local"
    qr_url = "https://115.com/scan/dg-fallback-uid"
    _store_qr_session(
        token,
        uid="fallback-uid",
        app="qipad",
        qr_url=qr_url,
        qr_url_source="fallback",
    )

    async def empty_fetch(uid: str, app: str) -> bytes:
        return b""

    def fake_build(content: str) -> bytes:
        assert content == qr_url
        return b"local-fallback"

    monkeypatch.setattr(Pan115Service, "_fetch_qr_login_image", staticmethod(empty_fetch))
    monkeypatch.setattr(Pan115Service, "_build_qr_login_image", staticmethod(fake_build))

    assert await Pan115Service().get_qr_login_image(token) == b"local-fallback"


@pytest.mark.asyncio
async def test_fetch_qr_login_image_requests_explicit_uid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested_urls: list[str] = []

    class FakeResponse:
        def __enter__(self) -> "FakeResponse":
            return self

        def __exit__(self, *args) -> None:
            return None

        def read(self) -> bytes:
            return b"\x89PNG\r\n\x1a\nuid-bound"

    def fake_urlopen(request, timeout: int):
        requested_urls.append(request.full_url)
        assert timeout == 8
        return FakeResponse()

    monkeypatch.setattr(pan115_service_module, "urlopen", fake_urlopen)

    assert await Pan115Service._fetch_qr_login_image("uid/with space", "ipad") == (
        b"\x89PNG\r\n\x1a\nuid-bound"
    )
    assert requested_urls == [
        "https://qrcodeapi.115.com/api/1.0/ipad/1.0/qrcode?uid=uid%2Fwith%20space"
    ]

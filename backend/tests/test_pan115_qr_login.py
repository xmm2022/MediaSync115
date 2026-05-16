"""115 扫码登录设备列表测试"""

from app.constants.pan115_qr_login import (
    PAN115_QR_LOGIN_ALLOWED_APPS,
    list_pan115_qr_login_app_options,
    normalize_pan115_qr_login_app,
)


class TestPan115QrLoginApps:
    def test_normalize_rejects_unknown_app(self) -> None:
        assert normalize_pan115_qr_login_app("web") == "alipaymini"
        assert normalize_pan115_qr_login_app("bios") == "alipaymini"
        assert normalize_pan115_qr_login_app("os_windows") == "alipaymini"

    def test_normalize_keeps_valid_app(self) -> None:
        assert normalize_pan115_qr_login_app("wechatmini") == "wechatmini"
        assert normalize_pan115_qr_login_app("qandroid") == "qandroid"

    def test_list_options_match_allowed_set(self) -> None:
        items = list_pan115_qr_login_app_options()
        values = {item["value"] for item in items}
        assert values == set(PAN115_QR_LOGIN_ALLOWED_APPS)
        assert "web" not in values
        assert "alipaymini" in values

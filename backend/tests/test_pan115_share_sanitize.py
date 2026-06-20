"""115 分享链接清洗测试"""

from app.api.pan115 import _sanitize_receive_code, _sanitize_share_url


def test_sanitize_receive_code_strips_emoji_suffix() -> None:
    assert _sanitize_receive_code("0jd3⚠️") == "0jd3"


def test_sanitize_receive_code_keeps_plain_code() -> None:
    assert _sanitize_receive_code("a1b2") == "a1b2"


def test_sanitize_share_url_cleans_password_query() -> None:
    raw = "https://115.com/s/swswnu83np7?password=0jd3⚠️"
    assert _sanitize_share_url(raw) == "https://115.com/s/swswnu83np7?password=0jd3"


def test_sanitize_share_url_extracts_url_from_mixed_text() -> None:
    raw = "分享链接 https://115.com/s/abcd1234?password=zz11 提取码"
    assert _sanitize_share_url(raw) == "https://115.com/s/abcd1234?password=zz11"

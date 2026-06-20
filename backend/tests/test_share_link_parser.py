"""分享链接批量解析测试。"""

from app.utils.share_link_parser import parse_batch_share_text


class TestShareLinkParser:
    """批量分享链接解析。"""

    def test_parse_user_example(self) -> None:
        text = """诺斯费拉图 (1922)
https://115cdn.com/s/swwgdbr3wbf（访问码：z686）

凶兆前传 (2024)
https://115.com/s/swhqd0y3h0m?password=zc39#

云图 (2012)
https://pan.quark.cn/s/f7af2f8357a0
"""
        parsed = parse_batch_share_text(text)
        assert len(parsed.items_115) == 2
        assert len(parsed.items_quark) == 1

        first = parsed.items_115[0]
        assert first.title == "诺斯费拉图 (1922)"
        assert first.share_url == "https://115cdn.com/s/swwgdbr3wbf"
        assert first.receive_code == "z686"

        second = parsed.items_115[1]
        assert second.title == "凶兆前传 (2024)"
        assert second.share_url == "https://115.com/s/swhqd0y3h0m?password=zc39"
        assert second.receive_code == "zc39"

        quark = parsed.items_quark[0]
        assert quark.title == "云图 (2012)"
        assert quark.share_url == "https://pan.quark.cn/s/f7af2f8357a0"

    def test_parse_plain_search_text_returns_empty(self) -> None:
        parsed = parse_batch_share_text("诺兰 电影")
        assert not parsed.has_115
        assert not parsed.has_quark

    def test_deduplicate_same_link(self) -> None:
        text = (
            "测试\n"
            "https://115.com/s/abc123?password=aaaa\n"
            "https://115.com/s/abc123?password=aaaa"
        )
        parsed = parse_batch_share_text(text)
        assert len(parsed.items_115) == 1

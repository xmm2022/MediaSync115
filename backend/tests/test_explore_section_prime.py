"""探索「更多」页首屏 TMDB 同步解析上限测试

首屏同步解析前 6 条 TMDB ID 用于角标（平衡首屏速度与角标可用性），
分页（start>0）不同步解析。
"""

from app.api.search import _douban_explore_sync_prime_limit


class TestExploreSectionPrimeLimit:
    def test_first_screen_sync_prime_capped_at_6(self) -> None:
        """首屏同步解析上限为 6，用于角标显示。"""
        assert _douban_explore_sync_prime_limit(30, 0) == 6

    def test_pagination_disables_sync_prime(self) -> None:
        """分页（滚动触底）不同步解析 TMDB ID。"""
        assert _douban_explore_sync_prime_limit(30, 30) == 0

    def test_first_screen_small_limit(self) -> None:
        """当 limit 小于 6 时，取 limit 本身。"""
        assert _douban_explore_sync_prime_limit(3, 0) == 3

    def test_first_screen_large_limit(self) -> None:
        """当 limit 大于 6 时，仍然上限为 6。"""
        assert _douban_explore_sync_prime_limit(50, 0) == 6

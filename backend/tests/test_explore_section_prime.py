"""探索「更多」页首屏 TMDB 同步解析上限测试

历史上首屏会同步解析前 N 条 TMDB ID 用于角标，但每条解析对外串行 2 次 TMDB 调用，
冷启动会成为首屏阻塞瓶颈。现已统一改为 0，全部交给后台异步回填 + 前端 badge syncer 补齐。
"""

from app.api.search import _douban_explore_sync_prime_limit


class TestExploreSectionPrimeLimit:
    def test_first_screen_disables_sync_prime(self) -> None:
        """首屏不再同步解析 TMDB ID，避免阻塞首屏响应。"""
        assert _douban_explore_sync_prime_limit(30, 0) == 0

    def test_pagination_disables_sync_prime(self) -> None:
        """分页（滚动触底）也不再同步解析 TMDB ID。"""
        assert _douban_explore_sync_prime_limit(30, 30) == 0

    def test_disabled_regardless_of_limit(self) -> None:
        """无论 limit 多大都应返回 0。"""
        assert _douban_explore_sync_prime_limit(50, 0) == 0
        assert _douban_explore_sync_prime_limit(1, 0) == 0

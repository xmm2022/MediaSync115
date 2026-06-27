from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read_source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


class FrontendContractsTest(unittest.TestCase):
    def test_unauthorized_requests_use_spa_auth_flow(self) -> None:
        client = read_source("src/api/client.ts")

        self.assertIn("AUTH_REQUIRED_EVENT", client)
        self.assertNotIn("window.location.href = '/login'", client)

    def test_service_credential_401_does_not_trigger_web_logout(self) -> None:
        client = read_source("src/api/client.ts")
        errors = read_source("src/api/errors.ts")

        self.assertIn("isWebSessionAuthError", client)
        self.assertIn("isWebSessionAuthError", errors)
        self.assertIn("请先登录", errors)
        self.assertIn('return detail === "请先登录"', errors)
        self.assertIn("!isWebSessionAuthError(error)", client)

    def test_explore_errors_are_user_facing(self) -> None:
        explore = read_source("src/components/ExploreTab.tsx")

        self.assertIn("getApiErrorMessage", explore)
        self.assertNotIn("err instanceof Error ? err.message", explore)

    def test_app_exposes_real_auth_session_controls(self) -> None:
        app = read_source("src/App.tsx")

        self.assertIn("authApi.getSession", app)
        self.assertIn("authApi.login", app)
        self.assertIn("authApi.logout", app)
        self.assertNotIn("高级云端站长", app)
        self.assertNotIn("nhxdev@gmail.com", app)

    def test_settings_hides_unsupported_backend_capabilities(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")

        self.assertNotIn("Plex Server", settings)
        self.assertNotIn("plexUrl", settings)
        self.assertNotIn("maxThreads", settings)
        self.assertNotIn("离线仿真模拟服务已全开", settings)

    def test_settings_exposes_runtime_settings_backed_controls(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")
        advanced = read_source("src/components/RuntimeAdvancedSettingsPanel.tsx")

        self.assertIn("RuntimeAdvancedSettingsPanel", settings)
        for key in (
            "subscription_enabled",
            "subscription_offline_transfer_enabled",
            "subscription_hdhive_auto_unlock_enabled",
            "subscription_resource_priority",
            "resource_preferred_resolutions",
            "resource_preferred_hdr",
            "resource_preferred_codec",
            "resource_preferred_audio",
            "resource_preferred_subtitles",
            "resource_exclude_tags",
            "resource_min_size_gb",
            "resource_max_size_gb",
            "tg_index_enabled",
            "tg_index_realtime_fallback_enabled",
            "tg_index_query_limit_per_channel",
            "tg_backfill_batch_size",
            "tg_incremental_interval_minutes",
            "emby_sync_enabled",
            "emby_sync_interval_minutes",
            "feiniu_url",
            "feiniu_api_key",
            "feiniu_session_token",
            "feiniu_sync_enabled",
            "feiniu_sync_interval_minutes",
            "pansou_base_url",
            "chart_subscription_enabled",
            "person_follow_enabled",
        ):
            self.assertIn(key, advanced)

    def test_settings_exposes_remaining_runtime_settings_gaps(self) -> None:
        advanced = read_source("src/components/RuntimeAdvancedSettingsPanel.tsx")

        for key in (
            "hdhive_cookie",
            "hdhive_base_url",
            "hdhive_login_username",
            "hdhive_auto_checkin_enabled",
            "hdhive_auto_checkin_mode",
            "hdhive_auto_checkin_method",
            "hdhive_auto_checkin_run_time",
            "update_source_type",
            "update_repository",
            "detail_visible_tabs",
        ):
            self.assertIn(key, advanced)

    def test_settings_exposes_archive_quark_and_auth_configuration(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")

        for key in (
            "archive_interval_minutes",
            "archive_auto_on_transfer",
            "archive_auto_on_offline",
            "offline_monitor_interval_minutes",
            "archive_subdirs",
            "archive_naming",
            "quarkApi.getDefaultFolder",
            "quarkApi.setDefaultFolder",
            "authApi.changeCredentials",
        ):
            self.assertIn(key, settings)

    def test_pan115_page_does_not_eager_load_protected_api_without_valid_cookie(self) -> None:
        pan115 = read_source("src/components/Pan115FilesTab.tsx")

        self.assertIn("loadInitialPan115Data", pan115)
        self.assertNotIn('loadFiles("0");\n    loadOfflineTasks();', pan115)

    def test_dashboard_uses_real_pan115_cookie_status(self) -> None:
        dashboard = read_source("src/components/DashboardTab.tsx")

        self.assertIn("pan115Api", dashboard)
        self.assertIn("checkCookie", dashboard)
        self.assertNotIn(">已连接</span>", dashboard)
        self.assertNotIn(">Cookie 会话有效</span>", dashboard)

    def test_strm_redirect_mode_matches_backend_contract(self) -> None:
        strm = read_source("src/components/StrmTab.tsx")

        self.assertIn('useState("auto")', strm)
        self.assertIn('value="auto"', strm)
        self.assertIn('value="redirect"', strm)
        self.assertIn('value="proxy"', strm)
        self.assertNotIn('value="302"', strm)

    def test_pan115_mobile_setting_buttons_keep_readable_width(self) -> None:
        pan115 = read_source("src/components/Pan115FilesTab.tsx")

        self.assertGreaterEqual(pan115.count("shrink-0 min-w-[3.5rem]"), 2)
        self.assertGreaterEqual(pan115.count("grid-cols-[minmax(0,1fr)_5.5rem_3.5rem]"), 2)

    def test_search_disables_keyword_search_without_tmdb_key(self) -> None:
        search = read_source("src/components/SearchTab.tsx")

        self.assertIn('getExploreMeta("tmdb")', search)
        self.assertIn("tmdbSearchConfigured", search)
        self.assertIn("!tmdbSearchConfigured", search)
        self.assertIn("TMDB API Key 未配置", search)

    def test_settings_primary_save_includes_tmdb_key(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")

        self.assertIn("tmdbApiKey", settings)
        self.assertIn("tmdb_api_key", settings)
        self.assertIn("tmdbApiKeyConfigured", settings)
        self.assertIn("TMDB API Key", settings)

    def test_search_exposes_direct_resource_keyword_search_without_tmdb(self) -> None:
        search = read_source("src/components/SearchTab.tsx")

        self.assertIn("资源直搜", search)
        self.assertIn("runDirectResourceSearch", search)
        self.assertIn("getHdhivePan115ByKeyword", search)
        self.assertIn("getTgPan115ByKeyword", search)
        self.assertIn("getSeedhubMagnetByKeyword", search)
        self.assertIn('searchScope === "media" && !tmdbSearchConfigured', search)
        self.assertNotIn("disabled={isLoading || !tmdbSearchConfigured}", search)

    def test_search_ignores_stale_async_results(self) -> None:
        search = read_source("src/components/SearchTab.tsx")

        self.assertIn("requestSeqRef", search)
        self.assertGreaterEqual(search.count("requestSeqRef.current += 1"), 3)
        self.assertIn("requestId !== requestSeqRef.current", search)

    def test_search_copy_matches_supported_media_servers(self) -> None:
        search = read_source("src/components/SearchTab.tsx")

        self.assertIn("Emby / 飞牛", search)
        self.assertNotIn("Emby / Plex", search)

    def test_scheduler_jobs_are_rendered_as_user_facing_status(self) -> None:
        scheduler = read_source("src/components/SchedulerTab.tsx")

        self.assertNotIn("JSON.stringify(jobs", scheduler)
        self.assertIn("SchedulerJob", scheduler)
        self.assertIn("内置调度状态", scheduler)
        self.assertIn("next_run_time", scheduler)

    def test_library_person_feed_and_license_are_user_facing(self) -> None:
        library = read_source("src/components/LibraryPlusTab.tsx")
        types = read_source("src/api/types.ts")
        person_api = read_source("src/api/personFollow.ts")

        self.assertNotIn("JSON.stringify(feed", library)
        self.assertNotIn("JSON.stringify(status", library)
        self.assertIn("PersonFollowFeedItem", types)
        self.assertIn("PersonFollowFeedItem", person_api)
        self.assertIn("getLicenseTierLabel", library)
        self.assertIn("许可证功能", library)
        self.assertIn('status?.tier === "pro"', library)

    def test_library_person_follow_form_is_responsive_on_mobile(self) -> None:
        library = read_source("src/components/LibraryPlusTab.tsx")

        self.assertIn("sm:grid-cols-[8rem_minmax(0,1fr)_auto]", library)
        self.assertIn("w-full sm:w-auto", library)
        self.assertNotIn('className="flex gap-2">\\n          <input type="number"', library)


if __name__ == "__main__":
    unittest.main()

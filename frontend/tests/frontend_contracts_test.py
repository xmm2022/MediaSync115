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
            self.assertIn(key, settings)

    def test_settings_exposes_remaining_runtime_settings_gaps(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")

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
            self.assertIn(key, settings)

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
        self.assertNotIn("startQrLogin", pan115)
        self.assertNotIn("扫码登录二维码", pan115)
        self.assertIn("配置中心的网盘集成", pan115)

    def test_dashboard_uses_real_pan115_cookie_status(self) -> None:
        dashboard = read_source("src/components/DashboardTab.tsx")

        self.assertIn("pan115Api", dashboard)
        self.assertIn("checkCookie", dashboard)
        self.assertNotIn(">已连接</span>", dashboard)
        self.assertNotIn(">Cookie 会话有效</span>", dashboard)

    def test_strm_redirect_mode_matches_backend_contract(self) -> None:
        strm = read_source("src/components/StrmTab.tsx")

        self.assertIn('strm_redirect_mode', strm)
        self.assertIn('>("auto")', strm)
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

    def test_tmdb_key_stays_in_resource_settings(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")
        resource_metadata = read_source("src/components/settings/ResourceMetadataSettings.tsx")

        self.assertNotIn("TMDB 搜索配置", settings + resource_metadata)
        self.assertNotIn("tmdbApiKeyConfigured", settings)
        self.assertIn("tmdbApiKey", settings)
        self.assertIn("tmdb_api_key", settings)
        self.assertIn("tmdbApiKey", resource_metadata)
        self.assertIn("TMDB API", resource_metadata)

    def test_douban_movie_board_uses_movie_section_endpoints(self) -> None:
        explore = read_source("src/components/ExploreTab.tsx")

        self.assertNotIn('getExploreSections("douban"', explore)
        self.assertIn("getExploreDoubanSection", explore)
        self.assertIn("DOUBAN_MOVIE_SECTION_KEYS.map", explore)

    def test_search_discover_uses_douban_section_endpoints(self) -> None:
        search = read_source("src/components/SearchTab.tsx")

        self.assertNotIn('getExploreSections("douban"', search)
        self.assertIn("getExploreDoubanSection", search)
        self.assertIn("DOUBAN_DISCOVER_SECTION_KEYS.map", search)

    def test_settings_exposes_runtime_resource_tabs_and_pt_source(self) -> None:
        detail = read_source("src/components/MediaDetailTab.tsx")
        search = read_source("src/components/SearchTab.tsx")
        settings = read_source("src/components/SettingsTab.tsx")
        detail_panel = read_source("src/components/settings/DetailVisibleTabsPanel.tsx")
        runtime = read_source("../backend/app/services/runtime_settings_service.py")

        self.assertIn("settingsApi.getRuntime", detail)
        self.assertIn("detail_visible_tabs", settings)
        self.assertIn("detailVisibleTabs", settings)
        self.assertIn("settingsApi.getRuntime", search)
        self.assertIn("RESOURCE_SOURCE_DETAIL_KEYS", search)
        self.assertIn("visibleResourceSources", search)
        self.assertIn('key: "moviepilot_pt"', detail_panel)
        self.assertIn("PT·MoviePilot", detail_panel)
        self.assertIn('"moviepilot_pt"', runtime)

    def test_settings_ia_uses_focused_subcomponents(self) -> None:
        settings = read_source("src/components/SettingsTab.tsx")
        cloud_drives = read_source("src/components/settings/CloudDrivesSettings.tsx")
        resource_metadata = read_source("src/components/settings/ResourceMetadataSettings.tsx")
        telegram_settings = read_source("src/components/settings/TelegramSettings.tsx")

        for component in (
            "SettingsSectionNav",
            "CloudDrivesSettings",
            "DiagnosticStatusGrid",
            "ResourcePriorityOptions",
            "ResourceMetadataSettings",
            "TelegramSettings",
            "SettingsLogsPanel",
        ):
            self.assertIn(f'./settings/{component}', settings)
            self.assertIn(f"<{component}", settings)

        for label in ("115 云盘授权设置", "115 扫码登录", "夸克网盘授权集成"):
            self.assertIn(label, cloud_drives)
        self.assertIn("settings-pan115-qr-login-app", cloud_drives)
        self.assertIn("115 手机确认页可能显示通用 Web 登录文案", cloud_drives)
        self.assertIn("listQrLoginApps", settings)
        self.assertIn("extractPan115QrLoginAppOptions", settings)
        self.assertIn('DEFAULT_PAN115_QR_LOGIN_APP = "ios"', read_source("src/utils/pan115QrLogin.ts"))
        self.assertNotIn("settingsApi", cloud_drives)
        self.assertNotIn("quarkApi", cloud_drives)
        self.assertNotIn("pan115Api", cloud_drives)
        self.assertNotIn("runAction(", cloud_drives)
        self.assertIn('./DetailVisibleTabsPanel', resource_metadata)
        self.assertIn("<DetailVisibleTabsPanel", resource_metadata)
        for label in ("ANI-RSS", "HDHive", "TMDB", "Pansou"):
            self.assertIn(label, resource_metadata)
        self.assertNotIn("settingsApi", resource_metadata)
        self.assertNotIn("animeApi", resource_metadata)
        for label in ("Telegram 客户端扫码与凭据", "Telegram Bot 接收服务", "Telegram 索引调度器参数"):
            self.assertIn(label, telegram_settings)
        self.assertNotIn("settingsApi", telegram_settings)
        self.assertNotIn("runAction(", telegram_settings)

    def test_operation_logs_panel_does_not_run_business_tasks(self) -> None:
        logs_panel = read_source("src/components/settings/SettingsLogsPanel.tsx")

        self.assertIn("日志级别", logs_panel)
        self.assertIn("日志模块", logs_panel)
        self.assertIn("logsApi.clear", logs_panel)
        self.assertIn("logsApi.modules", logs_panel)
        self.assertIn("logsApi.prune", logs_panel)
        self.assertNotIn("archiveApi", logs_panel)
        self.assertNotIn("runChartSubscription", logs_panel)
        self.assertNotIn("runPersonFollow", logs_panel)
        self.assertNotIn("立即触发归档扫描", logs_panel)

    def test_search_resource_sources_honor_detail_visible_tabs(self) -> None:
        search = read_source("src/components/SearchTab.tsx")

        self.assertIn("settingsApi.getRuntime", search)
        self.assertIn("RESOURCE_SOURCE_DETAIL_KEYS", search)
        self.assertIn("isResourceSourceVisible", search)
        self.assertIn("visibleResourceSources", search)
        self.assertIn("pan115_pansou", search)
        self.assertIn('"115_pansou"', search)

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

    def test_moviepilot_delete_copy_is_local_mirror_only(self) -> None:
        dialog = read_source("src/components/SubscriptionDialog.tsx")
        subscription_tab = read_source("src/components/SubscriptionTab.tsx")

        self.assertIn("删除 PT 镜像", dialog)
        self.assertIn("已删除 MoviePilot 本地镜像", dialog)
        self.assertNotIn("已取消 PT订阅", dialog)
        self.assertIn("只删除 [${sub.title}] 的 MoviePilot 本地镜像", subscription_tab)
        self.assertIn("外部 PT 订阅仍需在 MoviePilot 中管理", subscription_tab)

    def test_fixed_pan115_source_create_rolls_back_subscription_on_failure(self) -> None:
        dialog = read_source("src/components/SubscriptionDialog.tsx")

        self.assertIn("rollbackCreatedSubscription", dialog)
        self.assertIn("await subscriptionApi.delete(subId)", dialog)
        self.assertIn("固定 115 来源绑定失败，已回滚订阅", dialog)
        self.assertLess(
            dialog.index("if (manualSelected && !manualShareUrl.trim())"),
            dialog.index("const createResp = await subscriptionApi.create"),
        )

    def test_subscription_source_mutations_refresh_parent_state(self) -> None:
        tab = read_source("src/components/SubscriptionTab.tsx")

        self.assertIn("refreshSourceDerivedState", tab)
        self.assertIn("loadSubscriptions()", tab)
        self.assertIn("loadMissingOverview()", tab)
        self.assertGreaterEqual(tab.count("await refreshSourceDerivedState(sub)"), 4)

    def test_npm_test_runs_typescript_contract_tests(self) -> None:
        package_json = read_source("package.json")

        self.assertIn("npm run lint", package_json)
        self.assertIn("tests/*.test.ts", package_json)
        self.assertIn("--import tsx", package_json)

    def test_strm_copy_matches_supported_media_servers(self) -> None:
        strm = read_source("src/components/StrmTab.tsx")

        self.assertIn("Emby/飞牛", strm)
        self.assertNotIn("Emby / Plex", strm)

    def test_scheduler_jobs_are_rendered_as_user_facing_status(self) -> None:
        scheduler = read_source("src/components/SchedulerTab.tsx")

        self.assertNotIn("JSON.stringify(jobs", scheduler)
        self.assertIn("SchedulerJob", scheduler)
        self.assertIn("当前调度器 Jobs", scheduler)
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

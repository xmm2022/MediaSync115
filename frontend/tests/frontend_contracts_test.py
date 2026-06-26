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


if __name__ == "__main__":
    unittest.main()

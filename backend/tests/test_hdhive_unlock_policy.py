import asyncio
from pathlib import Path

from app.services.subscription_service import SubscriptionService
from app.services.subscriptions.resource_candidates import extract_resource_url
from app.services.subscriptions.hdhive_unlock import (
    build_hdhive_unlock_context,
    prepare_hdhive_locked_resources,
    should_stop_unlocking_on_message,
)


ROOT = Path(__file__).resolve().parents[2]


class TestHDHiveUnlockPolicy:
    def test_build_hdhive_unlock_context_uses_explicit_settings(self) -> None:
        context = build_hdhive_unlock_context(
            enabled=True,
            max_points_per_item=8,
            budget_total=20,
            threshold_inclusive=False,
            request_interval_seconds=0,
        )

        assert context["enabled"] is True
        assert context["max_points_per_item"] == 8
        assert context["budget_total"] == 20
        assert context["budget_left"] == 20
        assert context["threshold_inclusive"] is False
        assert context["max_unlocks_per_run"] == 1
        assert context["consecutive_failed_limit"] == 3
        assert context["stats"] == {
            "attempted": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "points_spent": 0,
        }

    def test_prepare_hdhive_locked_resources_helper_stops_after_first_success(
        self,
    ) -> None:
        unlock_calls: list[str] = []
        sleep_calls: list[float] = []

        async def fake_unlock(slug: str) -> dict:
            unlock_calls.append(slug)
            return {
                "success": True,
                "message": "资源解锁成功",
                "share_link": f"https://115.com/s/{slug}?password=abcd",
            }

        async def fake_sleep(delay: float) -> None:
            sleep_calls.append(delay)

        resources = [
            {
                "source_service": "hdhive",
                "slug": "slug-a",
                "hdhive_locked": True,
                "unlock_points": 3,
                "resource_name": "资源 A",
            },
            {
                "source_service": "hdhive",
                "slug": "slug-b",
                "hdhive_locked": True,
                "unlock_points": 3,
                "resource_name": "资源 B",
            },
        ]
        context = build_hdhive_unlock_context(
            enabled=True,
            max_points_per_item=10,
            budget_total=30,
            threshold_inclusive=True,
            request_interval_seconds=0,
        )
        traces: list[dict] = []

        result = asyncio.run(
            prepare_hdhive_locked_resources(
                resources,
                context,
                traces,
                normalize_items=lambda items: [dict(item) for item in items],
                extract_resource_url=lambda item: str(
                    item.get("pan115_share_link")
                    or item.get("share_link")
                    or ""
                ).strip(),
                normalize_share_url=lambda url: url.strip(),
                unlock_resource=fake_unlock,
                sleep=fake_sleep,
            )
        )

        assert unlock_calls == ["slug-a"]
        assert sleep_calls == []
        assert result[0]["pan115_share_link"] == "https://115.com/s/slug-a?password=abcd"
        assert result[0]["share_link"] == "https://115.com/s/slug-a?password=abcd"
        assert result[0]["pan115_savable"] is True
        assert result[1].get("share_link") is None
        assert context["budget_left"] == 27
        assert context["stats"]["attempted"] == 1
        assert context["stats"]["success"] == 1
        assert context["stats"]["points_spent"] == 3
        assert any(
            trace.get("step") == "hdhive_unlock_stop"
            and trace.get("payload", {}).get("reason") == "max_unlocks_reached"
            for trace in traces
        )

    def test_hdhive_unlock_stop_message_policy_marks_auth_and_budget_errors(
        self,
    ) -> None:
        assert should_stop_unlocking_on_message("积分不足，请充值")
        assert should_stop_unlocking_on_message("token expired")
        assert should_stop_unlocking_on_message("Cookie 无效")
        assert not should_stop_unlocking_on_message("临时网络错误")
        assert not should_stop_unlocking_on_message("")

    def test_hdhive_unlock_module_does_not_import_service_runtime_or_db_layers(
        self,
    ) -> None:
        source = (
            ROOT / "backend/app/services/subscriptions/hdhive_unlock.py"
        ).read_text(encoding="utf-8")

        assert "subscription_service" not in source
        assert "runtime_settings_service" not in source
        assert "hdhive_service" not in source
        assert "AsyncSession" not in source
        assert "app.models" not in source
        assert "app.api" not in source

    def test_prepare_hdhive_locked_resources_stops_after_first_success(self) -> None:
        service = SubscriptionService()
        unlock_calls: list[str] = []

        async def fake_unlock(slug: str) -> dict:
            unlock_calls.append(slug)
            return {
                "success": True,
                "message": "资源解锁成功",
                "share_link": f"https://115.com/s/{slug}?password=abcd",
            }

        from app.services import subscription_service as subscription_service_module

        original_unlock = subscription_service_module.hdhive_service.unlock_resource
        subscription_service_module.hdhive_service.unlock_resource = fake_unlock  # type: ignore[method-assign]
        try:
            resources = [
                {
                    "source_service": "hdhive",
                    "slug": "slug-a",
                    "hdhive_locked": True,
                    "unlock_points": 0,
                    "resource_name": "资源 A",
                },
                {
                    "source_service": "hdhive",
                    "slug": "slug-b",
                    "hdhive_locked": True,
                    "unlock_points": 0,
                    "resource_name": "资源 B",
                },
                {
                    "source_service": "hdhive",
                    "slug": "slug-c",
                    "hdhive_locked": True,
                    "unlock_points": 0,
                    "resource_name": "资源 C",
                },
            ]
            context = {
                "enabled": True,
                "max_points_per_item": 10,
                "budget_total": 30,
                "budget_left": 30,
                "threshold_inclusive": True,
                "max_unlocks_per_run": 1,
                "consecutive_failed_limit": 3,
                "consecutive_failed_count": 0,
                "request_interval_seconds": 0,
                "stopped_by_circuit": False,
                "stopped_reason": "",
                "stats": {
                    "attempted": 0,
                    "success": 0,
                    "failed": 0,
                    "skipped": 0,
                    "points_spent": 0,
                },
            }
            traces: list[dict] = []

            result = asyncio.run(
                service._prepare_hdhive_locked_resources(resources, context, traces)
            )
        finally:
            subscription_service_module.hdhive_service.unlock_resource = original_unlock  # type: ignore[method-assign]

        assert unlock_calls == ["slug-a"]
        assert extract_resource_url(result[0]) == (
            "https://115.com/s/slug-a?password=abcd"
        )
        assert not extract_resource_url(result[1])
        assert any(
            trace.get("step") == "hdhive_unlock_stop"
            and trace.get("payload", {}).get("reason") == "max_unlocks_reached"
            for trace in traces
        )

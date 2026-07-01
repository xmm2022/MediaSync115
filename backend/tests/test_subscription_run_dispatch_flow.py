from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
async def test_dispatch_subscription_checks_empty_list_does_not_process() -> None:
    events: list[Any] = []

    async def process_subscription(sub: Any) -> None:
        events.append(("process", sub))

    await dispatch_subscription_checks(
        subscriptions=[],
        concurrency=2,
        dependencies=SubscriptionRunDispatchDependencies(
            process_subscription=process_subscription,
        ),
    )

    assert events == []


@pytest.mark.asyncio
async def test_dispatch_subscription_checks_respects_concurrency_limit() -> None:
    active_count = 0
    max_active_count = 0
    processed: list[int] = []

    async def process_subscription(sub: int) -> None:
        nonlocal active_count, max_active_count
        active_count += 1
        max_active_count = max(max_active_count, active_count)
        processed.append(sub)
        await asyncio.sleep(0.01)
        active_count -= 1

    await dispatch_subscription_checks(
        subscriptions=[1, 2, 3, 4, 5],
        concurrency=2,
        dependencies=SubscriptionRunDispatchDependencies(
            process_subscription=process_subscription,
        ),
    )

    assert sorted(processed) == [1, 2, 3, 4, 5]
    assert max_active_count == 2
    assert active_count == 0


@pytest.mark.asyncio
async def test_dispatch_subscription_checks_propagates_process_errors() -> None:
    async def process_subscription(sub: int) -> None:
        if sub == 2:
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        await dispatch_subscription_checks(
            subscriptions=[1, 2, 3],
            concurrency=2,
            dependencies=SubscriptionRunDispatchDependencies(
                process_subscription=process_subscription,
            ),
        )


def test_run_dispatch_flow_keeps_runtime_dependencies_injected() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_dispatch_flow.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "runtime_settings_service" not in source
    assert "pan115_service" not in source
    assert "pansou_service" not in source
    assert "hdhive_service" not in source
    assert "tg_service" not in source
    assert "AsyncSession" not in source
    assert "app.models" not in source
    assert "app.api" not in source

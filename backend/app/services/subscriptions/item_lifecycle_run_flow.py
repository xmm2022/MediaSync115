from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.run_counters import increment_processed_count
from app.services.subscriptions.run_lifecycle_logs import (
    build_subscription_start_step,
)
from app.services.subscriptions.run_state import build_processing_progress_payload


@dataclass(frozen=True, slots=True)
class SubscriptionItemLifecycleDependencies:
    create_step_log: Callable[..., Awaitable[None]]


async def start_subscription_item_processing(
    *,
    db: Any,
    run_id: str,
    channel: str,
    subscription_id: int,
    subscription_title: str,
    dependencies: SubscriptionItemLifecycleDependencies,
) -> None:
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        **build_subscription_start_step(subscription_title),
    )


async def publish_subscription_item_progress(
    *,
    result: dict[str, Any],
    result_lock: Any,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None,
) -> dict[str, Any]:
    async with result_lock:
        increment_processed_count(result)
        progress_payload = build_processing_progress_payload(result)

    if progress_callback:
        await progress_callback(progress_payload)

    return progress_payload

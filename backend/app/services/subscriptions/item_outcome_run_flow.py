from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from app.services.subscriptions.run_lifecycle_logs import (
    build_subscription_done_event_kwargs,
    build_subscription_done_step,
    build_subscription_failed_event_kwargs,
    build_subscription_failed_step,
)


@dataclass(frozen=True, slots=True)
class SubscriptionItemOutcomeDependencies:
    create_step_log: Callable[..., Awaitable[None]]
    log_background_event: Callable[..., Awaitable[None]]
    apply_subscription_failure: Callable[
        [int, str, BaseException],
        Awaitable[None],
    ]


async def complete_subscription_item_success(
    *,
    db: Any,
    run_id: str,
    channel: str,
    subscription_id: int,
    subscription_title: str,
    new_record_count: int,
    should_auto_download: bool,
    sub_saved_count: int,
    sub_failed_transfer_count: int,
    dependencies: SubscriptionItemOutcomeDependencies,
) -> None:
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        **build_subscription_done_step(),
    )
    await dependencies.log_background_event(
        **build_subscription_done_event_kwargs(
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            channel=channel,
            trace_id=run_id,
            new_record_count=new_record_count,
            should_auto_download=should_auto_download,
            sub_saved_count=sub_saved_count,
            sub_failed_transfer_count=sub_failed_transfer_count,
        )
    )
    await db.commit()


async def handle_subscription_item_failure(
    *,
    db: Any,
    run_id: str,
    channel: str,
    subscription_id: int,
    subscription_title: str,
    error: BaseException,
    dependencies: SubscriptionItemOutcomeDependencies,
) -> None:
    await db.rollback()
    await dependencies.apply_subscription_failure(
        subscription_id,
        subscription_title,
        error,
    )
    await dependencies.create_step_log(
        db,
        run_id=run_id,
        channel=channel,
        subscription_id=subscription_id,
        subscription_title=subscription_title,
        **build_subscription_failed_step(error),
    )
    await dependencies.log_background_event(
        **build_subscription_failed_event_kwargs(
            subscription_id=subscription_id,
            subscription_title=subscription_title,
            channel=channel,
            trace_id=run_id,
            error=error,
        )
    )
    await db.commit()

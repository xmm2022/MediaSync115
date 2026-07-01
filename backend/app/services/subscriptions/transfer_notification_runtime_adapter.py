from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.transfer_notifications import (
    TransferNotificationDependencies,
    notify_transfer_success,
)


logger = logging.getLogger(__name__)

Notify = Callable[..., Awaitable[None]]
LogWarning = Callable[..., None]
RunNotifyTransferSuccess = Callable[..., Awaitable[None]]


@dataclass(frozen=True, slots=True)
class TransferNotificationRuntimeDependencies:
    notify: Notify
    log_warning: LogWarning
    run_notify_transfer_success: RunNotifyTransferSuccess


async def send_tg_bot_notification(
    message: str,
    *,
    poster_path: str | None = None,
) -> None:
    from app.services.tg_bot.notifications import tg_bot_notify

    await tg_bot_notify(message, poster_path=poster_path)


def build_default_transfer_notification_runtime_dependencies() -> TransferNotificationRuntimeDependencies:
    return TransferNotificationRuntimeDependencies(
        notify=send_tg_bot_notification,
        log_warning=logger.warning,
        run_notify_transfer_success=notify_transfer_success,
    )


async def notify_transfer_success_with_runtime_adapter(
    sub_title: str,
    resource_name: str,
    source: str,
    method: str,
    *,
    poster_path: str | None = None,
    dependencies: TransferNotificationRuntimeDependencies | None = None,
) -> None:
    current_dependencies = (
        dependencies
        or build_default_transfer_notification_runtime_dependencies()
    )
    await current_dependencies.run_notify_transfer_success(
        sub_title,
        resource_name,
        source,
        method,
        poster_path=poster_path,
        dependencies=TransferNotificationDependencies(
            notify=current_dependencies.notify,
            log_warning=current_dependencies.log_warning,
        ),
    )

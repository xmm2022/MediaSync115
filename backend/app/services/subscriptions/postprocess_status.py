from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any


TriggerArchiveAfterTransfer = Callable[..., Awaitable[dict[str, Any]]]
Now = Callable[[], datetime]


@dataclass(frozen=True)
class PostprocessStatusDependencies:
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer
    archiving_status: Any
    completed_status: Any
    now: Now


async def apply_precise_transfer_postprocess_status(
    record: Any,
    *,
    dependencies: PostprocessStatusDependencies,
) -> dict[str, Any]:
    archive_result = await dependencies.trigger_archive_after_transfer(
        trigger="subscription_transfer"
    )
    if archive_result.get("triggered"):
        record.status = dependencies.archiving_status
        record.completed_at = None
    else:
        record.status = dependencies.completed_status
        record.completed_at = dependencies.now()
    record.error_message = None
    return archive_result

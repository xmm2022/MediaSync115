from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.timezone_utils import beijing_now
from app.models.models import MediaStatus
from app.services.media_postprocess_service import media_postprocess_service
from app.services.subscriptions.postprocess_status import (
    PostprocessStatusDependencies,
    apply_precise_transfer_postprocess_status,
)


TriggerArchiveAfterTransfer = Callable[..., Awaitable[dict[str, Any]]]
Now = Callable[[], datetime]
RunApplyPreciseTransferPostprocessStatus = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class PostprocessStatusRuntimeDependencies:
    trigger_archive_after_transfer: TriggerArchiveAfterTransfer
    archiving_status: Any
    completed_status: Any
    now: Now
    run_apply_precise_transfer_postprocess_status: (
        RunApplyPreciseTransferPostprocessStatus
    )


def build_default_postprocess_status_runtime_dependencies() -> (
    PostprocessStatusRuntimeDependencies
):
    return PostprocessStatusRuntimeDependencies(
        trigger_archive_after_transfer=(
            media_postprocess_service.trigger_archive_after_transfer
        ),
        archiving_status=MediaStatus.ARCHIVING,
        completed_status=MediaStatus.COMPLETED,
        now=beijing_now,
        run_apply_precise_transfer_postprocess_status=(
            apply_precise_transfer_postprocess_status
        ),
    )


async def apply_precise_transfer_postprocess_status_with_runtime_adapter(
    record: Any,
    *,
    dependencies: PostprocessStatusRuntimeDependencies | None = None,
) -> dict[str, Any]:
    current_dependencies = (
        dependencies or build_default_postprocess_status_runtime_dependencies()
    )
    return await current_dependencies.run_apply_precise_transfer_postprocess_status(
        record,
        dependencies=PostprocessStatusDependencies(
            trigger_archive_after_transfer=(
                current_dependencies.trigger_archive_after_transfer
            ),
            archiving_status=current_dependencies.archiving_status,
            completed_status=current_dependencies.completed_status,
            now=current_dependencies.now,
        ),
    )

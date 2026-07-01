from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.subscriptions.auto_transfer_batch import (
    AutoTransferBatchDependencies,
    AutoTransferBatchStatuses,
)


RunAutoSaveResourcesBatch = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class AutoSaveResourcesAdapterDependencies:
    get_pan115_cookie: Callable[[], str]
    create_pan_service: Callable[[str], Any]
    get_pan115_default_folder: Callable[[], dict[str, Any]]
    get_pan115_offline_folder: Callable[[], dict[str, Any]]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    emit_transfer_success: Callable[[int, dict[str, Any]], None]
    select_tv_missing_episode_files: Callable[..., Any]
    apply_precise_postprocess_status: Callable[[Any], Awaitable[dict[str, Any]]]
    notify_transfer_success: Callable[..., Awaitable[None]]
    trigger_archive_after_transfer: Callable[..., Awaitable[dict[str, Any] | None]]
    log_operation: Callable[..., Awaitable[None]]
    now: Callable[[], datetime]
    is_video_file: Callable[[str], bool]
    run_batch: RunAutoSaveResourcesBatch


async def auto_save_resources_with_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    records: list[Any],
    source: str,
    statuses: AutoTransferBatchStatuses,
    dependencies: AutoSaveResourcesAdapterDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pan_service = dependencies.create_pan_service(dependencies.get_pan115_cookie())
    default_folder = dependencies.get_pan115_default_folder() or {}
    parent_folder_id = str(default_folder.get("folder_id") or "0")
    quality_filter = dependencies.resolve_quality_filter(sub)

    async def fetch_tv_missing_status(**kwargs: Any) -> dict[str, Any]:
        _ = kwargs.pop("tmdb_id", None)
        return await dependencies.get_tv_missing_status(sub.tmdb_id, **kwargs)

    async def create_auto_transfer_step_log(**kwargs: Any) -> None:
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            **kwargs,
        )

    async def submit_offline_task(url: str, folder_id: str) -> dict[str, Any]:
        return await pan_service.offline_task_add(
            url=url,
            wp_path_id=folder_id,
        )

    def get_offline_folder_id() -> str:
        offline_folder = dependencies.get_pan115_offline_folder() or {}
        return str(offline_folder.get("folder_id") or "0")

    def emit_transfer_success(data: dict[str, Any]) -> None:
        dependencies.emit_transfer_success(int(sub.id), data)

    def select_precise_missing_episode_files(
        files: list[dict[str, Any]],
        *,
        missing_episodes: set[tuple[int, int]],
        quality_filter: dict[str, Any],
        is_video_file: Callable[[str], bool],
    ) -> Any:
        return dependencies.select_tv_missing_episode_files(
            files,
            missing_episodes=missing_episodes,
            quality_filter=quality_filter,
            best_picker=pan_service.pick_best_video_file,
            is_video_file=is_video_file,
        )

    batch_dependencies = AutoTransferBatchDependencies(
        fetch_tv_missing_status=fetch_tv_missing_status,
        create_step_log=create_auto_transfer_step_log,
        get_offline_folder_id=get_offline_folder_id,
        submit_offline_task=submit_offline_task,
        emit_transfer_success=emit_transfer_success,
        select_precise_missing_episode_files=select_precise_missing_episode_files,
        extract_share_code=pan_service._extract_share_code,
        get_share_all_files_recursive=pan_service.get_share_all_files_recursive,
        save_share_files_directly=pan_service.save_share_files_directly,
        save_share_directly=pan_service.save_share_directly,
        apply_precise_postprocess_status=(
            dependencies.apply_precise_postprocess_status
        ),
        notify_transfer_success=dependencies.notify_transfer_success,
        trigger_archive_after_transfer=dependencies.trigger_archive_after_transfer,
        log_operation=dependencies.log_operation,
        now=dependencies.now,
        is_video_file=dependencies.is_video_file,
    )

    return await dependencies.run_batch(
        sub=sub,
        records=records,
        source=source,
        parent_folder_id=parent_folder_id,
        quality_filter=quality_filter,
        statuses=statuses,
        dependencies=batch_dependencies,
        tv_missing_snapshot=tv_missing_snapshot,
        trace_id=run_id,
    )

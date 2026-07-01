from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


ExtractShareCode = Callable[[str], str]
GetShareAllFilesRecursive = Callable[[str, str], Awaitable[list[dict[str, Any]]]]
SelectMissingEpisodeFiles = Callable[..., Any]
SaveShareFilesDirectly = Callable[..., Awaitable[Any]]
ApplyPostprocessStatus = Callable[[Any], Awaitable[dict[str, Any]]]
NotifyTransferSuccess = Callable[[str, str, str, str, str | None], Awaitable[None]]
LogOperation = Callable[..., Awaitable[None]]
CreateStepLog = Callable[..., Awaitable[None]]
EmitTransferSuccess = Callable[[dict[str, Any]], None]
NormalizeFollowMode = Callable[[str], str]
HasUpcomingEpisodes = Callable[[int, Any], Awaitable[bool]]
EvaluateCleanup = Callable[..., tuple[bool, str | None]]
VideoPredicate = Callable[[str], bool]


@dataclass(frozen=True)
class PreciseTransferSubmissionResult:
    saved_increment: int
    should_continue: bool
    should_stop: bool
    subscription_completed: bool
    cleanup_step: str
    cleanup_message: str
    cleanup_payload: dict[str, Any]


def _empty_result(*, should_continue: bool = False) -> PreciseTransferSubmissionResult:
    return PreciseTransferSubmissionResult(
        saved_increment=0,
        should_continue=should_continue,
        should_stop=False,
        subscription_completed=False,
        cleanup_step="",
        cleanup_message="",
        cleanup_payload={},
    )


async def submit_precise_transfer_record(
    *,
    sub: Any,
    record: Any,
    source: str,
    share_link: str,
    receive_code: str,
    parent_folder_id: str,
    quality_filter: dict[str, Any],
    missing_episodes: set[tuple[int, int]],
    matched_status: Any,
    extract_share_code: ExtractShareCode,
    get_share_all_files_recursive: GetShareAllFilesRecursive,
    select_missing_episode_files: SelectMissingEpisodeFiles,
    save_share_files_directly: SaveShareFilesDirectly,
    apply_postprocess_status: ApplyPostprocessStatus,
    notify_transfer_success: NotifyTransferSuccess,
    log_operation: LogOperation,
    create_step_log: CreateStepLog,
    emit_transfer_success: EmitTransferSuccess,
    normalize_follow_mode: NormalizeFollowMode,
    has_upcoming_episodes: HasUpcomingEpisodes,
    evaluate_cleanup: EvaluateCleanup,
    is_video_file: VideoPredicate,
    trace_id: str = "",
) -> PreciseTransferSubmissionResult:
    share_code = extract_share_code(share_link)
    if not share_code:
        raise ValueError("无效的分享链接，无法提取分享码")

    all_files = await get_share_all_files_recursive(share_code, receive_code)
    selection = select_missing_episode_files(
        all_files,
        missing_episodes=missing_episodes,
        quality_filter=quality_filter,
        is_video_file=is_video_file,
    )

    await create_step_log(
        step="tv_record_files_parsed",
        status="info",
        message=f"已解析资源文件，找到 {selection.matched_missing_count} 个匹配缺集的文件：{record.resource_name}",
        payload={
            "record_id": record.id,
            "total_files": len(all_files),
            "parsed_count": selection.parsed_count,
            "matched_missing_count": selection.matched_missing_count,
            "unparsed_video_count": selection.unparsed_video_count,
            "remaining_missing_count": len(missing_episodes),
        },
    )

    selected_file_ids = selection.selected_file_ids
    matched_pairs = selection.matched_pairs
    selected_mode = "missing"
    if not selected_file_ids:
        record.status = matched_status
        record.completed_at = None
        record.error_message = None
        await create_step_log(
            step="tv_record_skip_no_missing",
            status="info",
            message=f"该资源不包含需要的集数，已跳过：{record.resource_name}",
            payload={
                "record_id": record.id,
                "remaining_missing_count": len(missing_episodes),
            },
        )
        return _empty_result(should_continue=True)

    await save_share_files_directly(
        share_url=share_link,
        file_ids=selected_file_ids,
        parent_id=parent_folder_id,
        receive_code=receive_code,
    )
    for pair in matched_pairs:
        missing_episodes.discard(pair)

    archive_result = await apply_postprocess_status(record)
    record.file_id = parent_folder_id
    await notify_transfer_success(
        sub.title,
        record.resource_name,
        source,
        "精准转存",
        getattr(sub, "poster_path", None),
    )
    await create_step_log(
        step="tv_transfer_selected_done",
        status="success",
        message=f"已转存 {len(selected_file_ids)} 个文件到网盘（还剩 {len(missing_episodes)} 集待补）：{record.resource_name}",
        payload={
            "source": source,
            "record_id": record.id,
            "selected_mode": selected_mode,
            "selected_count": len(selected_file_ids),
            "remaining_missing_count": len(missing_episodes),
            "target_parent_id": parent_folder_id,
            "save_mode": "direct",
            "archive_triggered": bool(archive_result.get("triggered")),
            "archive_skip_reason": archive_result.get("reason"),
        },
    )
    await log_operation(
        source_type="background_task",
        module="subscriptions",
        action="subscription.record.transfer_ok",
        status="success",
        message=f"[{sub.title}] [{source}] 精准转存成功：{record.resource_name}（选中 {len(selected_file_ids)} 个文件，剩余缺集 {len(missing_episodes)} 集）",
        trace_id=trace_id,
        extra={
            "subscription_id": sub.id,
            "record_id": record.id,
            "source": source,
            "selected_count": len(selected_file_ids),
            "remaining_missing": len(missing_episodes),
        },
    )
    try:
        emit_transfer_success(
            {
                "subscription_id": sub.id,
                "title": sub.title,
                "source": source,
                "resource_name": record.resource_name,
                "transfer_type": "precise",
                "status": "success",
                "selected_count": len(selected_file_ids),
            }
        )
    except Exception:
        pass

    if not missing_episodes:
        follow_mode = normalize_follow_mode(getattr(sub, "tv_follow_mode", "missing"))
        has_upcoming = False
        tmdb_id = getattr(sub, "tmdb_id", None)
        if follow_mode == "new" and tmdb_id is not None:
            has_upcoming = await has_upcoming_episodes(tmdb_id, sub)
        should_cleanup, cleanup_reason = evaluate_cleanup(
            {"status": "ok", "counts": {"missing": 0}},
            follow_mode=follow_mode,
            has_upcoming_episodes=has_upcoming,
        )
        if should_cleanup:
            return PreciseTransferSubmissionResult(
                saved_increment=1,
                should_continue=False,
                should_stop=True,
                subscription_completed=True,
                cleanup_step="subscription_cleanup_tv_completed_after_transfer",
                cleanup_message=cleanup_reason or "剧集缺集已补齐，已自动删除订阅",
                cleanup_payload={
                    "source": source,
                    "record_id": record.id,
                    "remaining_missing_count": 0,
                    "target_parent_id": parent_folder_id,
                    "save_mode": "direct",
                    "follow_mode": follow_mode,
                },
            )

    return PreciseTransferSubmissionResult(
        saved_increment=1,
        should_continue=False,
        should_stop=False,
        subscription_completed=False,
        cleanup_step="",
        cleanup_message="",
        cleanup_payload={},
    )

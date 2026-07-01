from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


CreateStepLog = Callable[..., Awaitable[None]]
ListEnabledManualSources = Callable[[Any, int], Awaitable[list[Any]]]
GetTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
ScanManualSource = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class FixedSourceScanDependencies:
    list_enabled_manual_sources: ListEnabledManualSources
    create_pan_service: Callable[[], Any]
    get_parent_folder_id: Callable[[], str]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: GetTvMissingStatus
    scan_manual_source: ScanManualSource
    create_step_log: CreateStepLog


def _media_type_value(sub: Any) -> Any:
    media_type = getattr(sub, "media_type", None)
    return getattr(media_type, "value", media_type)


def should_scan_fixed_sources(
    sub: Any,
    *,
    force_auto_download: bool = False,
) -> bool:
    return (
        _media_type_value(sub) in {"movie", "tv"}
        and getattr(sub, "tmdb_id", None) is not None
        and (
            bool(getattr(sub, "auto_download", False))
            or bool(force_auto_download)
        )
    )


def _tv_missing_status_kwargs(sub: Any) -> dict[str, Any]:
    tv_scope = getattr(sub, "tv_scope", "")
    return {
        "include_specials": bool(getattr(sub, "tv_include_specials", False)),
        "season_number": getattr(sub, "tv_season_number", None)
        if tv_scope in {"season", "episode_range"}
        else None,
        "episode_start": getattr(sub, "tv_episode_start", None)
        if tv_scope == "episode_range"
        else None,
        "episode_end": getattr(sub, "tv_episode_end", None)
        if tv_scope == "episode_range"
        else None,
        "aired_only": getattr(sub, "tv_follow_mode", "") == "new",
    }


def _parse_missing_episode_pairs(value: Any) -> set[tuple[int, int]]:
    pairs: set[tuple[int, int]] = set()
    for pair in value or []:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        try:
            pairs.add((int(pair[0]), int(pair[1])))
        except (TypeError, ValueError):
            continue
    return pairs


def _zero_stats() -> dict[str, int]:
    return {"saved": 0, "failed": 0, "checked": 0}


async def scan_fixed_sources_for_subscription(
    db: Any,
    *,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: FixedSourceScanDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    force_auto_download: bool = False,
) -> dict[str, Any]:
    if not should_scan_fixed_sources(
        sub,
        force_auto_download=force_auto_download,
    ):
        return _zero_stats()

    sources = await dependencies.list_enabled_manual_sources(db, int(sub.id))
    if not sources:
        return _zero_stats()

    pan_service = dependencies.create_pan_service()
    parent_folder_id = dependencies.get_parent_folder_id()
    quality_filter = dependencies.resolve_quality_filter(sub)

    missing_episodes: set[tuple[int, int]] = set()
    if _media_type_value(sub) == "tv":
        tv_missing_result = tv_missing_snapshot
        if tv_missing_result is None:
            tv_missing_result = await dependencies.get_tv_missing_status(
                getattr(sub, "tmdb_id", None),
                **_tv_missing_status_kwargs(sub),
            )
        if str(tv_missing_result.get("status") or "") != "ok":
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_missing_status_unavailable",
                status="warning",
                message=(
                    "固定来源跳过：缺集状态不可用"
                    f"（{tv_missing_result.get('message') or '未知错误'}）"
                ),
            )
            return {"saved": 0, "failed": 0, "checked": len(sources)}

        missing_episodes = _parse_missing_episode_pairs(
            tv_missing_result.get("missing_episodes")
        )

    saved = 0
    failed = 0
    for source in sources:
        await dependencies.create_step_log(
            db,
            run_id=run_id,
            channel=channel,
            subscription_id=sub.id,
            subscription_title=sub.title,
            step="fixed_source_scan_start",
            status="info",
            message=f"开始扫描固定来源：{source.display_name or source.share_url}",
            payload={"source_id": source.id},
        )
        try:
            scan_result = await dependencies.scan_manual_source(
                db,
                source=source,
                subscription=sub,
                pan_service=pan_service,
                parent_folder_id=parent_folder_id,
                missing_episodes=missing_episodes,
                quality_filter=quality_filter,
            )
            transferred_count = int(scan_result.get("transferred_count") or 0)
            saved += transferred_count
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_scan_done",
                status="success",
                message=f"固定来源扫描完成，转存 {transferred_count} 个文件",
                payload={"source_id": source.id, **scan_result},
            )
        except Exception as exc:
            failed += 1
            await dependencies.create_step_log(
                db,
                run_id=run_id,
                channel=channel,
                subscription_id=sub.id,
                subscription_title=sub.title,
                step="fixed_source_scan_failed",
                status="warning",
                message=f"固定来源扫描失败：{exc}",
                payload={"source_id": source.id},
            )
    return {"saved": saved, "failed": failed, "checked": len(sources)}

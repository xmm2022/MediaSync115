from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any


FetchTvMissingStatus = Callable[..., Awaitable[dict[str, Any]]]
CreateStepLog = Callable[..., Awaitable[None]]


@dataclass(frozen=True)
class AutoTransferTvMissingContext:
    is_tv_subscription: bool
    tv_missing_enabled: bool
    missing_episodes: set[tuple[int, int]]


async def build_auto_transfer_tv_missing_context(
    *,
    sub: Any,
    tv_missing_snapshot: dict[str, Any] | None,
    fetch_tv_missing_status: FetchTvMissingStatus,
    create_step_log: CreateStepLog,
) -> AutoTransferTvMissingContext:
    is_tv_subscription = _is_tv_subscription(sub)
    if not is_tv_subscription:
        return AutoTransferTvMissingContext(
            is_tv_subscription=False,
            tv_missing_enabled=False,
            missing_episodes=set(),
        )

    tv_missing_result = tv_missing_snapshot
    if tv_missing_result is None:
        await create_step_log(
            step="tv_missing_fetch_start",
            status="info",
            message="正在检查剧集的缺集状态",
            payload={"tmdb_id": getattr(sub, "tmdb_id", None)},
        )
        tv_missing_result = await fetch_tv_missing_status(
            tmdb_id=getattr(sub, "tmdb_id", None),
            include_specials=bool(getattr(sub, "tv_include_specials", False)),
            season_number=getattr(sub, "tv_season_number", None)
            if getattr(sub, "tv_scope", None) in {"season", "episode_range"}
            else None,
            episode_start=getattr(sub, "tv_episode_start", None)
            if getattr(sub, "tv_scope", None) == "episode_range"
            else None,
            episode_end=getattr(sub, "tv_episode_end", None)
            if getattr(sub, "tv_scope", None) == "episode_range"
            else None,
            aired_only=getattr(sub, "tv_follow_mode", None) == "new",
        )

    if str(tv_missing_result.get("status") or "") == "ok":
        missing_episodes = normalize_missing_episode_pairs(
            tv_missing_result.get("missing_episodes") or []
        )
        if tv_missing_snapshot is None:
            counts = (
                tv_missing_result.get("counts")
                if isinstance(tv_missing_result.get("counts"), dict)
                else {}
            )
            await create_step_log(
                step="tv_missing_fetch_done",
                status="success",
                message=(
                    f"缺集检查完成：共 {int(counts.get('aired') or 0)} 集，"
                    f"已有 {int(counts.get('existing') or 0)} 集，"
                    f"缺失 {len(missing_episodes)} 集"
                ),
                payload={
                    "aired_count": int(
                        (tv_missing_result.get("counts") or {}).get("aired") or 0
                    ),
                    "existing_count": int(
                        (tv_missing_result.get("counts") or {}).get("existing") or 0
                    ),
                    "missing_count": len(missing_episodes),
                },
            )
        return AutoTransferTvMissingContext(
            is_tv_subscription=True,
            tv_missing_enabled=True,
            missing_episodes=missing_episodes,
        )

    if tv_missing_snapshot is None:
        await create_step_log(
            step="tv_missing_fetch_failed",
            status="warning",
            message=(
                "缺集检查失败，将按全量转存处理："
                f"{tv_missing_result.get('message') or '未知错误'}"
            ),
            payload={
                "status": tv_missing_result.get("status"),
                "message": tv_missing_result.get("message"),
            },
        )

    return AutoTransferTvMissingContext(
        is_tv_subscription=True,
        tv_missing_enabled=False,
        missing_episodes=set(),
    )


def normalize_missing_episode_pairs(raw_pairs: Any) -> set[tuple[int, int]]:
    pairs: set[tuple[int, int]] = set()
    for pair in raw_pairs:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        try:
            pairs.add((int(pair[0]), int(pair[1])))
        except Exception:
            continue
    return pairs


def _is_tv_subscription(sub: Any) -> bool:
    media_type = getattr(sub, "media_type", None)
    normalized_media_type = str(getattr(media_type, "value", media_type) or "").lower()
    return normalized_media_type == "tv" and getattr(sub, "tmdb_id", None) is not None

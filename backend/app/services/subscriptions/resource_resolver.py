from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.services.subscriptions.source_attempts import build_source_attempt_summary
from app.utils.resource_tags import filter_and_sort_by_quality, sort_by_preference


FetchResources = Callable[
    [Any], Awaitable[tuple[list[dict[str, Any]], list[dict[str, Any]]]]
]
PrepareHDHiveLockedResources = Callable[
    [list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
    Awaitable[list[dict[str, Any]]],
]


@dataclass(frozen=True)
class ResourceResolverDependencies:
    fetch_from_hdhive: FetchResources
    fetch_from_tg: FetchResources
    fetch_from_pansou: FetchResources
    fetch_offline_magnets: FetchResources
    resolve_source_order: Callable[[str], list[str]]
    resolve_subscription_resolutions: Callable[[Any], list[str]]
    resolve_subscription_quality_filter: Callable[[Any], dict[str, Any]]
    prepare_hdhive_locked_resources: PrepareHDHiveLockedResources
    build_hdhive_unlock_context: Callable[[], dict[str, Any]]
    filter_resources_excluding_urls: Callable[
        [list[dict[str, Any]], set[str]], list[dict[str, Any]]
    ]
    log_source_fetch: Callable[[Any, str, int], Awaitable[None]]
    emit_source_attempt: Callable[[Any, dict[str, Any]], None]


async def resolve_subscription_resources(
    *,
    channel: str,
    sub: Any,
    dependencies: ResourceResolverDependencies,
    hdhive_unlock_context: dict[str, Any] | None = None,
    source_order: list[str] | None = None,
    exclude_urls: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    traces: list[dict[str, Any]] = []
    source_attempts: list[dict[str, Any]] = []
    active_order = list(source_order or dependencies.resolve_source_order(channel))
    traces.append(
        {
            "step": "fetch_source_order",
            "status": "info",
            "message": f"按优先级执行资源搜索: {' > '.join(active_order) if active_order else '无可用来源'}",
            "payload": {"source_order": active_order},
        }
    )
    if not active_order:
        traces.append(
            {
                "step": "fetch_source_order_empty",
                "status": "warning",
                "message": "当前优先级来源均不可用，请检查配置",
            }
        )
        return (
            [],
            traces,
            {"source_order": active_order, "attempts": [], "summary": "无可用来源"},
        )

    primary_resources: list[dict[str, Any]] = []
    for source in active_order:
        source_resources: list[dict[str, Any]] = []
        source_traces: list[dict[str, Any]] = []
        attempt_info: dict[str, Any] = {
            "source": source,
            "status": "empty",
            "count": 0,
        }
        try:
            source_resources, source_traces = await _fetch_from_source(
                source, sub, dependencies
            )
        except Exception as exc:
            source_traces.append(
                {
                    "step": f"fetch_{source}_failed",
                    "status": "warning",
                    "message": f"{source} 抓取失败，继续尝试下一个来源",
                    "payload": {"error": str(exc)[:300]},
                }
            )
            attempt_info["status"] = "failed"
            attempt_info["error"] = str(exc)[:100]
            source_resources = []

        traces.extend(source_traces)
        await dependencies.log_source_fetch(sub, source, len(source_resources))
        if source_resources:
            traces.append(
                {
                    "step": "fetch_source_selected",
                    "status": "success",
                    "message": f"来源 {source} 命中资源 {len(source_resources)} 条，已加入候选列表",
                    "payload": {"source": source, "count": len(source_resources)},
                }
            )
            attempt_info["status"] = "success"
            attempt_info["count"] = len(source_resources)
            source_resources = await _prepare_source_resources(
                source,
                sub,
                source_resources,
                traces,
                dependencies,
                hdhive_unlock_context,
            )
            if exclude_urls:
                before_exclude = len(source_resources)
                source_resources = dependencies.filter_resources_excluding_urls(
                    source_resources, exclude_urls
                )
                if before_exclude and not source_resources:
                    traces.append(
                        {
                            "step": "fetch_source_exhausted",
                            "status": "info",
                            "message": f"来源 {source} 命中资源均已尝试过，继续下一个来源",
                            "payload": {
                                "source": source,
                                "excluded_count": before_exclude,
                            },
                        }
                    )
                    attempt_info["status"] = "empty"
                    attempt_info["count"] = 0
                else:
                    attempt_info["count"] = len(source_resources)
                    primary_resources.extend(source_resources)
            else:
                attempt_info["count"] = len(source_resources)
                primary_resources.extend(source_resources)

        source_attempts.append(attempt_info)
        _emit_source_attempt(dependencies, sub, attempt_info)

        if primary_resources:
            break

    if not primary_resources:
        traces.append(
            {
                "step": "fetch_all_empty",
                "status": "warning",
                "message": "所有优先级来源都未命中可用资源",
            }
        )

    offline_resources, offline_traces = await dependencies.fetch_offline_magnets(sub)
    traces.extend(offline_traces)
    if offline_resources:
        pref_res = dependencies.resolve_subscription_resolutions(sub)
        if pref_res:
            offline_resources = sort_by_preference(offline_resources, pref_res, [])
        primary_resources.extend(offline_resources)
        source_attempts.append(
            {
                "source": "offline",
                "status": "success",
                "count": len(offline_resources),
            }
        )

    summary = build_source_attempt_summary(source_attempts, active_order)
    quality_filter = dependencies.resolve_subscription_quality_filter(sub)
    if any(value for value in quality_filter.values() if value is not None):
        before_count = len(primary_resources)
        primary_resources = filter_and_sort_by_quality(
            primary_resources, **quality_filter
        )
        excluded_count = before_count - len(primary_resources)
        if excluded_count > 0:
            traces.append(
                {
                    "step": "quality_hard_filter_applied",
                    "status": "info",
                    "message": f"排除规则过滤掉 {excluded_count} 个不符合条件的资源",
                }
            )
        if primary_resources and any(
            quality_filter.get(key)
            for key in (
                "preferred_resolutions",
                "preferred_formats",
                "preferred_languages",
                "preferred_subtitles",
            )
        ):
            traces.append(
                {
                    "step": "quality_preference_sorted",
                    "status": "info",
                    "message": "已按全局画质偏好排序，优先尝试匹配勾选画质的资源",
                }
            )

    return (
        primary_resources,
        traces,
        {
            "source_order": active_order,
            "attempts": source_attempts,
            "summary": summary,
        },
    )


async def _fetch_from_source(
    source: str,
    sub: Any,
    dependencies: ResourceResolverDependencies,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if source == "hdhive":
        return await dependencies.fetch_from_hdhive(sub)
    if source == "tg":
        return await dependencies.fetch_from_tg(sub)
    return await dependencies.fetch_from_pansou(sub)


async def _prepare_source_resources(
    source: str,
    sub: Any,
    source_resources: list[dict[str, Any]],
    traces: list[dict[str, Any]],
    dependencies: ResourceResolverDependencies,
    hdhive_unlock_context: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    pref_res = dependencies.resolve_subscription_resolutions(sub)
    if source == "hdhive":
        if pref_res:
            source_resources = sort_by_preference(source_resources, pref_res, [])
        quality_filter = dependencies.resolve_subscription_quality_filter(sub)
        if any(value for value in quality_filter.values() if value is not None):
            source_resources = filter_and_sort_by_quality(
                source_resources, **quality_filter
            )
        return await dependencies.prepare_hdhive_locked_resources(
            source_resources,
            hdhive_unlock_context or dependencies.build_hdhive_unlock_context(),
            traces,
        )

    if pref_res:
        source_resources = sort_by_preference(source_resources, pref_res, [])
    return source_resources


def _emit_source_attempt(
    dependencies: ResourceResolverDependencies,
    sub: Any,
    attempt_info: dict[str, Any],
) -> None:
    try:
        dependencies.emit_source_attempt(sub, attempt_info)
    except Exception:
        pass

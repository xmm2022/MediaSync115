from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.models.models import SubscriptionSource
from app.services.pan115_service import Pan115Service
from app.services.runtime_settings_service import runtime_settings_service
from app.services.subscription_source_service import (
    MANUAL_PAN115_SOURCE,
    subscription_source_service,
)
from app.services.subscriptions.fixed_source_scan import (
    FixedSourceScanDependencies,
    scan_fixed_sources_for_subscription,
)
from app.services.tv_missing_service import tv_missing_service


RunScanFixedSourcesForSubscription = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class FixedSourceScanRuntimeDependencies:
    manual_source_type: str
    source_model: Any
    run_select: Callable[[Any], Any]
    get_pan115_cookie: Callable[[], str]
    create_pan_service: Callable[[str], Any]
    get_pan115_default_folder: Callable[[], dict[str, Any]]
    resolve_quality_filter: Callable[[Any], dict[str, Any]]
    get_tv_missing_status: Callable[..., Awaitable[dict[str, Any]]]
    scan_manual_source: Callable[..., Awaitable[dict[str, Any]]]
    create_step_log: Callable[..., Awaitable[None]]
    run_scan_fixed_sources_for_subscription: RunScanFixedSourcesForSubscription


def build_default_fixed_source_scan_runtime_dependencies(
    *,
    resolve_quality_filter: Callable[[Any], dict[str, Any]],
    create_step_log: Callable[..., Awaitable[None]],
) -> FixedSourceScanRuntimeDependencies:
    return FixedSourceScanRuntimeDependencies(
        manual_source_type=MANUAL_PAN115_SOURCE,
        source_model=SubscriptionSource,
        run_select=select,
        get_pan115_cookie=runtime_settings_service.get_pan115_cookie,
        create_pan_service=Pan115Service,
        get_pan115_default_folder=(
            runtime_settings_service.get_pan115_default_folder
        ),
        resolve_quality_filter=resolve_quality_filter,
        get_tv_missing_status=tv_missing_service.get_tv_missing_status,
        scan_manual_source=subscription_source_service.scan_manual_pan115_source,
        create_step_log=create_step_log,
        run_scan_fixed_sources_for_subscription=(
            scan_fixed_sources_for_subscription
        ),
    )


async def scan_fixed_sources_with_runtime_adapter(
    *,
    db: Any,
    run_id: str,
    channel: str,
    sub: Any,
    dependencies: FixedSourceScanRuntimeDependencies,
    tv_missing_snapshot: dict[str, Any] | None = None,
    force_auto_download: bool = False,
) -> dict[str, Any]:
    async def list_enabled_manual_sources(
        current_db: Any,
        subscription_id: int,
    ) -> list[Any]:
        model = dependencies.source_model
        result = await current_db.execute(
            dependencies.run_select(model).where(
                model.subscription_id == subscription_id,
                model.enabled.is_(True),
                model.source_type == dependencies.manual_source_type,
            )
        )
        return list(result.scalars().all())

    def create_pan_service() -> Any:
        return dependencies.create_pan_service(dependencies.get_pan115_cookie())

    def get_parent_folder_id() -> str:
        default_folder = dependencies.get_pan115_default_folder() or {}
        return str(default_folder.get("folder_id") or "0")

    async def get_tv_missing_status(
        tmdb_id: int,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return await dependencies.get_tv_missing_status(tmdb_id, **kwargs)

    async def scan_manual_source(
        current_db: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return await dependencies.scan_manual_source(current_db, **kwargs)

    async def create_step_log(
        current_db: Any,
        **kwargs: Any,
    ) -> None:
        await dependencies.create_step_log(current_db, **kwargs)

    return await dependencies.run_scan_fixed_sources_for_subscription(
        db,
        run_id=run_id,
        channel=channel,
        sub=sub,
        tv_missing_snapshot=tv_missing_snapshot,
        force_auto_download=force_auto_download,
        dependencies=FixedSourceScanDependencies(
            list_enabled_manual_sources=list_enabled_manual_sources,
            create_pan_service=create_pan_service,
            get_parent_folder_id=get_parent_folder_id,
            resolve_quality_filter=dependencies.resolve_quality_filter,
            get_tv_missing_status=get_tv_missing_status,
            scan_manual_source=scan_manual_source,
            create_step_log=create_step_log,
        ),
    )

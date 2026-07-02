from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
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
from app.services.subscriptions.fixed_source_scan_runtime_adapter import (
    FixedSourceScanRuntimeDependencies,
    build_default_fixed_source_scan_runtime_dependencies,
    scan_fixed_sources_with_runtime_adapter,
)
from app.services.subscriptions.runtime_preferences_adapter import (
    resolve_subscription_quality_filter_with_runtime_adapter,
)
from app.services.tv_missing_service import tv_missing_service


ROOT = Path(__file__).resolve().parents[2]


class _Scalars:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _ExecuteResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _Scalars:
        return _Scalars(self._rows)


class _FakeDb:
    def __init__(self, rows: list[Any]) -> None:
        self.rows = rows
        self.statements: list[Any] = []

    async def execute(self, statement: Any) -> _ExecuteResult:
        self.statements.append(statement)
        return _ExecuteResult(self.rows)


def _dependencies(**overrides: Any) -> FixedSourceScanRuntimeDependencies:
    async def get_tv_missing_status(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"status": "ok", "missing_episodes": []}

    async def scan_manual_source(_db: Any, **kwargs: Any) -> dict[str, Any]:
        return {"status": "success", "kwargs": kwargs}

    async def create_step_log(_db: Any, **kwargs: Any) -> None:
        _ = kwargs

    async def run_scan_fixed_sources_for_subscription(**kwargs: Any) -> dict[str, Any]:
        return {"runner": kwargs}

    values: dict[str, Any] = {
        "manual_source_type": "manual_pan115_test",
        "source_model": SubscriptionSource,
        "run_select": select,
        "get_pan115_cookie": lambda: "cookie-value",
        "create_pan_service": lambda cookie: {"cookie": cookie},
        "get_pan115_default_folder": lambda: {"folder_id": "parent-folder"},
        "resolve_quality_filter": lambda sub: {"title": sub.title},
        "get_tv_missing_status": get_tv_missing_status,
        "scan_manual_source": scan_manual_source,
        "create_step_log": create_step_log,
        "run_scan_fixed_sources_for_subscription": (
            run_scan_fixed_sources_for_subscription
        ),
    }
    values.update(overrides)
    return FixedSourceScanRuntimeDependencies(**values)


@pytest.mark.asyncio
async def test_runtime_adapter_builds_core_dependencies_and_forwards_arguments() -> None:
    source = SimpleNamespace(id=31)
    db = _FakeDb([source])
    sub = SimpleNamespace(id=101, title="固定来源订阅")
    tv_missing_snapshot = {"status": "ok"}
    events: list[tuple[Any, ...]] = []
    runner_calls: list[dict[str, Any]] = []

    async def get_tv_missing_status(tmdb_id: int, **kwargs: Any) -> dict[str, Any]:
        events.append(("tv_missing", tmdb_id, kwargs))
        return {"status": "ok"}

    async def scan_manual_source(current_db: Any, **kwargs: Any) -> dict[str, Any]:
        events.append(("scan", current_db, kwargs))
        return {"status": "success", "transferred_count": 1}

    async def create_step_log(current_db: Any, **kwargs: Any) -> None:
        events.append(("step", current_db, kwargs))

    async def run_scan_fixed_sources_for_subscription(
        db_arg: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        kwargs["db"] = db_arg
        runner_calls.append(kwargs)
        lower_dependencies = kwargs["dependencies"]
        assert isinstance(lower_dependencies, FixedSourceScanDependencies)

        sources = await lower_dependencies.list_enabled_manual_sources(
            kwargs["db"],
            101,
        )
        assert sources == [source]
        assert len(db.statements) == 1
        compiled = db.statements[0].compile()
        assert compiled.params == {
            "subscription_id_1": 101,
            "source_type_1": "manual_pan115_test",
        }
        assert "subscription_sources.enabled IS true" in str(compiled)

        assert lower_dependencies.create_pan_service() == {
            "cookie": "cookie-value",
        }
        assert lower_dependencies.get_parent_folder_id() == "parent-folder"
        assert lower_dependencies.resolve_quality_filter(sub) == {
            "title": "固定来源订阅",
        }
        assert await lower_dependencies.get_tv_missing_status(
            9001,
            include_specials=True,
        ) == {"status": "ok"}
        assert await lower_dependencies.scan_manual_source(
            "db-2",
            source=source,
        ) == {"status": "success", "transferred_count": 1}
        await lower_dependencies.create_step_log("db-3", step="fixed")
        return {"saved": 1, "failed": 0, "checked": 1}

    result = await scan_fixed_sources_with_runtime_adapter(
        db=db,
        run_id="run-1",
        channel="all",
        sub=sub,
        dependencies=_dependencies(
            get_tv_missing_status=get_tv_missing_status,
            scan_manual_source=scan_manual_source,
            create_step_log=create_step_log,
            run_scan_fixed_sources_for_subscription=(
                run_scan_fixed_sources_for_subscription
            ),
        ),
        tv_missing_snapshot=tv_missing_snapshot,
        force_auto_download=True,
    )

    assert result == {"saved": 1, "failed": 0, "checked": 1}
    assert len(runner_calls) == 1
    assert runner_calls[0]["db"] is db
    assert runner_calls[0]["run_id"] == "run-1"
    assert runner_calls[0]["channel"] == "all"
    assert runner_calls[0]["sub"] is sub
    assert runner_calls[0]["tv_missing_snapshot"] is tv_missing_snapshot
    assert runner_calls[0]["force_auto_download"] is True
    assert events == [
        ("tv_missing", 9001, {"include_specials": True}),
        ("scan", "db-2", {"source": source}),
        ("step", "db-3", {"step": "fixed"}),
    ]


@pytest.mark.asyncio
async def test_runtime_adapter_parent_folder_defaults_to_zero() -> None:
    async def run_scan_fixed_sources_for_subscription(
        _db_arg: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        lower_dependencies = kwargs["dependencies"]
        assert lower_dependencies.get_parent_folder_id() == "0"
        return {"saved": 0, "failed": 0, "checked": 0}

    result = await scan_fixed_sources_with_runtime_adapter(
        db=_FakeDb([]),
        run_id="run-2",
        channel="all",
        sub=SimpleNamespace(id=102, title="无目录"),
        dependencies=_dependencies(
            get_pan115_default_folder=lambda: {},
            run_scan_fixed_sources_for_subscription=(
                run_scan_fixed_sources_for_subscription
            ),
        ),
    )

    assert result == {"saved": 0, "failed": 0, "checked": 0}


def test_default_runtime_dependencies_bind_existing_runtime_services() -> None:
    async def create_step_log(*_args: Any, **_kwargs: Any) -> None:
        return None

    dependencies = build_default_fixed_source_scan_runtime_dependencies(
        create_step_log=create_step_log,
    )

    assert dependencies.manual_source_type == MANUAL_PAN115_SOURCE
    assert dependencies.source_model is SubscriptionSource
    assert dependencies.run_select is select
    assert dependencies.create_pan_service is Pan115Service
    assert dependencies.get_pan115_cookie.__self__ is runtime_settings_service
    assert (
        dependencies.get_pan115_cookie.__func__
        is type(runtime_settings_service).get_pan115_cookie
    )
    assert (
        dependencies.get_pan115_default_folder.__self__
        is runtime_settings_service
    )
    assert dependencies.get_tv_missing_status.__self__ is tv_missing_service
    assert dependencies.scan_manual_source.__self__ is subscription_source_service
    assert dependencies.create_step_log is create_step_log
    assert dependencies.resolve_quality_filter is (
        resolve_subscription_quality_filter_with_runtime_adapter
    )
    assert dependencies.run_scan_fixed_sources_for_subscription is (
        scan_fixed_sources_for_subscription
    )


def test_default_runtime_dependencies_preserve_falsy_quality_filter_injection() -> None:
    class FalsyCallable:
        def __bool__(self) -> bool:
            return False

        def __call__(self, _sub: Any) -> dict[str, Any]:
            return {"quality": "explicit"}

    async def create_step_log(*_args: Any, **_kwargs: Any) -> None:
        return None

    resolve_quality_filter = FalsyCallable()

    dependencies = build_default_fixed_source_scan_runtime_dependencies(
        resolve_quality_filter=resolve_quality_filter,
        create_step_log=create_step_log,
    )

    assert dependencies.resolve_quality_filter is resolve_quality_filter


def test_fixed_source_scan_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT
        / "backend/app/services/subscriptions/fixed_source_scan_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source

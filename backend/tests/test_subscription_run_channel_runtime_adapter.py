from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.database import async_session_maker
from app.core.timezone_utils import beijing_now
from app.models.models import ExecutionStatus, MediaType
from app.services.operation_log_service import operation_log_service
from app.services import subscription_service as subscription_service_module
from app.services import subscription_delete_service as delete_service_module
from app.services.subscription_service import SubscriptionService
from app.services.subscriptions import (
    execution_logs as execution_logs_module,
    run_channel_runtime_adapter as run_channel_runtime_module,
)
from app.services.subscriptions.item_processing_run_flow import (
    SubscriptionItemProcessingDependencies,
    process_subscription_item,
)
from app.services.subscriptions.resource_storage_runtime_adapter import (
    store_new_resources_with_runtime_adapter,
)
from app.services.subscriptions.run_channel_runtime_adapter import (
    RunChannelRuntimeDependencies,
    build_default_run_channel_runtime_dependencies,
    run_channel_check_with_runtime_adapter,
)
from app.services.subscriptions.run_dispatch_flow import (
    SubscriptionRunDispatchDependencies,
    dispatch_subscription_checks,
)
from app.services.subscriptions.run_finalize_flow import (
    RunFinalizeDependencies,
    finalize_subscription_run,
)
from app.services.subscriptions.run_loader import load_active_subscription_snapshots
from app.services.subscriptions.run_start_flow import (
    SubscriptionRunStartDependencies,
    start_subscription_run,
)


ROOT = Path(__file__).resolve().parents[2]


def _assert_bound_method(
    callback: Any,
    service: SubscriptionService,
    name: str,
) -> None:
    expected = getattr(service, name)
    assert callback.__self__ is service
    assert callback.__func__ is expected.__func__


@pytest.mark.asyncio
async def test_runtime_adapter_wires_start_dispatch_process_and_finalize() -> None:
    db = object()
    run_result: dict[str, Any] = {"checked_count": 1, "failed_count": 0}
    expected_started_at = datetime(2026, 7, 2, 10, 30, 0)
    expected_hdhive_unlock_context = {"enabled": True, "stats": {"attempts": 0}}
    expected_source_order = ["hdhive", "pansou"]
    subscriptions = [SimpleNamespace(id=101, title="示例订阅")]
    lock_marker = object()
    events: list[Any] = []

    async def progress_callback(payload: dict[str, Any]) -> None:
        events.append(("progress", payload))

    async def log_background_event(**kwargs: Any) -> None:
        events.append(("event", kwargs))

    async def create_execution_log(current_db: Any, **kwargs: Any) -> None:
        events.append(("execution_log", current_db, kwargs))

    async def create_step_log(current_db: Any, **kwargs: Any) -> None:
        events.append(("step", current_db, kwargs))

    async def prune_step_logs(current_db: Any) -> None:
        events.append(("prune", current_db))

    async def load_active_subscriptions(current_db: Any) -> list[Any]:
        events.append(("load", current_db))
        return subscriptions

    def build_hdhive_unlock_context() -> dict[str, Any]:
        events.append(("unlock",))
        return expected_hdhive_unlock_context

    def resolve_source_order(channel: str) -> list[str]:
        events.append(("source_order", channel))
        return expected_source_order

    def session_factory() -> object:
        events.append(("session_factory",))
        return object()

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def fetch_resources(
        *_args: Any,
        **_kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return ([], [], {})

    async def store_new_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"created_records": []}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"saved_count": 0}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"saved_count": 0}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    def now() -> datetime:
        events.append(("now",))
        return expected_started_at

    def make_run_id() -> str:
        events.append(("run_id",))
        return "run-fixed"

    def make_result_lock() -> object:
        events.append(("lock",))
        return lock_marker

    async def run_start(
        *,
        db: Any,
        channel: str,
        force_auto_download: bool,
        progress_callback: Any,
        dependencies: SubscriptionRunStartDependencies,
    ) -> Any:
        events.append(("start", db, channel, force_auto_download, progress_callback))
        assert channel == "all"
        assert force_auto_download is True
        assert progress_callback is progress_callback_marker
        assert isinstance(dependencies, SubscriptionRunStartDependencies)
        assert dependencies.log_background_event is log_background_event
        assert dependencies.create_step_log is create_step_log
        assert dependencies.now() == expected_started_at
        assert dependencies.make_run_id() == "run-fixed"
        assert (
            dependencies.build_hdhive_unlock_context()
            is expected_hdhive_unlock_context
        )
        assert dependencies.resolve_source_order(channel) is expected_source_order
        assert await dependencies.load_active_subscriptions(db) is subscriptions
        return SimpleNamespace(
            run_id="run-fixed",
            started_at=expected_started_at,
            result=run_result,
            hdhive_unlock_context=expected_hdhive_unlock_context,
            source_order=expected_source_order,
            subscriptions=subscriptions,
        )

    async def dispatch_checks(
        *,
        subscriptions: Any,
        concurrency: int,
        dependencies: SubscriptionRunDispatchDependencies,
    ) -> None:
        events.append(("dispatch", list(subscriptions), concurrency, dependencies))
        assert concurrency == 7
        assert isinstance(dependencies, SubscriptionRunDispatchDependencies)
        for sub in subscriptions:
            await dependencies.process_subscription(sub)

    async def process_item(
        *,
        sub: Any,
        run_id: str,
        channel: str,
        force_auto_download: bool,
        hdhive_unlock_context: dict[str, Any],
        source_order: list[str],
        result: dict[str, Any],
        result_lock: Any,
        progress_callback: Any,
        tv_media_type: Any,
        dependencies: SubscriptionItemProcessingDependencies,
    ) -> None:
        events.append(("process", sub, run_id, channel, dependencies))
        assert sub is subscriptions[0]
        assert run_id == "run-fixed"
        assert channel == "all"
        assert force_auto_download is True
        assert hdhive_unlock_context is expected_hdhive_unlock_context
        assert source_order is expected_source_order
        assert result is run_result
        assert result_lock is lock_marker
        assert progress_callback is progress_callback_marker
        assert tv_media_type == "TV_MARKER"
        assert isinstance(dependencies, SubscriptionItemProcessingDependencies)
        assert dependencies.session_factory is session_factory
        assert dependencies.create_step_log is create_step_log
        assert dependencies.log_background_event is log_background_event
        assert dependencies.evaluate_pre_scan_cleanup is evaluate_pre_scan_cleanup
        assert dependencies.fetch_resources is fetch_resources
        assert dependencies.store_new_resources is store_new_resources
        assert dependencies.load_retryable_records is load_retryable_records
        assert dependencies.load_force_retry_records is load_force_retry_records
        assert (
            dependencies.auto_save_records_with_link_fallback
            is auto_save_records_with_link_fallback
        )
        assert dependencies.should_scan_fixed_sources is should_scan_fixed_sources
        assert (
            dependencies.scan_fixed_sources_for_subscription
            is scan_fixed_sources_for_subscription
        )
        assert (
            dependencies.delete_subscription_with_records
            is delete_subscription_with_records
        )

    async def finalize_run(
        *,
        db: Any,
        channel: str,
        run_id: str,
        result: dict[str, Any],
        started_at: datetime,
        hdhive_unlock_context: dict[str, Any],
        success_status: Any,
        failed_status: Any,
        partial_status: Any,
        dependencies: RunFinalizeDependencies,
    ) -> Any:
        events.append(("finalize", db, channel, run_id, dependencies))
        assert channel == "all"
        assert run_id == "run-fixed"
        assert result is run_result
        assert started_at == expected_started_at
        assert hdhive_unlock_context is expected_hdhive_unlock_context
        assert success_status == "SUCCESS_MARKER"
        assert failed_status == "FAILED_MARKER"
        assert partial_status == "PARTIAL_MARKER"
        assert isinstance(dependencies, RunFinalizeDependencies)
        assert dependencies.log_background_event is log_background_event
        assert dependencies.create_execution_log is create_execution_log
        assert dependencies.create_step_log is create_step_log
        assert dependencies.prune_step_logs is prune_step_logs
        assert dependencies.now is now
        return SimpleNamespace(status=success_status)

    progress_callback_marker = progress_callback
    returned = await run_channel_check_with_runtime_adapter(
        db=db,
        channel=" ALL ",
        force_auto_download=True,
        progress_callback=progress_callback_marker,
        concurrency=7,
        dependencies=RunChannelRuntimeDependencies(
            log_background_event=log_background_event,
            create_execution_log=create_execution_log,
            create_step_log=create_step_log,
            prune_step_logs=prune_step_logs,
            load_active_subscriptions=load_active_subscriptions,
            build_hdhive_unlock_context=build_hdhive_unlock_context,
            resolve_source_order=resolve_source_order,
            session_factory=session_factory,
            evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
            fetch_resources=fetch_resources,
            store_new_resources=store_new_resources,
            load_retryable_records=load_retryable_records,
            load_force_retry_records=load_force_retry_records,
            auto_save_records_with_link_fallback=(
                auto_save_records_with_link_fallback
            ),
            should_scan_fixed_sources=should_scan_fixed_sources,
            scan_fixed_sources_for_subscription=(
                scan_fixed_sources_for_subscription
            ),
            delete_subscription_with_records=delete_subscription_with_records,
            now=now,
            make_run_id=make_run_id,
            make_result_lock=make_result_lock,
            success_status="SUCCESS_MARKER",
            failed_status="FAILED_MARKER",
            partial_status="PARTIAL_MARKER",
            tv_media_type="TV_MARKER",
            run_start=run_start,
            dispatch_checks=dispatch_checks,
            process_item=process_item,
            finalize_run=finalize_run,
        ),
    )

    assert returned is run_result
    assert [
        event[0]
        for event in events
        if event[0] in {"start", "dispatch", "process", "finalize"}
    ] == ["start", "dispatch", "process", "finalize"]


@pytest.mark.asyncio
async def test_subscription_service_wrapper_passes_callbacks_and_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = SubscriptionService()
    db = object()
    dependencies_marker = object()
    progress_marker = object()
    builder_kwargs: dict[str, Any] = {}
    adapter_kwargs: dict[str, Any] = {}

    def fake_builder(**kwargs: Any) -> object:
        builder_kwargs.update(kwargs)
        return dependencies_marker

    async def fake_run_channel_check_with_runtime_adapter(**kwargs: Any) -> dict[str, Any]:
        adapter_kwargs.update(kwargs)
        return {"status": "ok"}

    monkeypatch.setattr(
        subscription_service_module,
        "build_default_run_channel_runtime_dependencies",
        fake_builder,
    )
    monkeypatch.setattr(
        subscription_service_module,
        "run_channel_check_with_runtime_adapter",
        fake_run_channel_check_with_runtime_adapter,
    )

    result = await service.run_channel_check(
        db,
        " ALL ",
        force_auto_download=True,
        progress_callback=progress_marker,  # type: ignore[arg-type]
    )

    assert result == {"status": "ok"}
    assert adapter_kwargs == {
        "db": db,
        "channel": " ALL ",
        "force_auto_download": True,
        "progress_callback": progress_marker,
        "concurrency": subscription_service_module._SUBSCRIPTION_SCAN_CONCURRENCY,
        "dependencies": dependencies_marker,
    }

    assert "delete_subscription_with_records" not in builder_kwargs
    assert "create_execution_log" not in builder_kwargs
    assert "create_step_log" not in builder_kwargs
    assert "prune_step_logs" not in builder_kwargs
    assert "build_hdhive_unlock_context" not in builder_kwargs
    assert "resolve_source_order" not in builder_kwargs
    assert "fetch_resources" not in builder_kwargs
    assert "store_new_resources" not in builder_kwargs
    assert "load_retryable_records" not in builder_kwargs
    assert "load_force_retry_records" not in builder_kwargs
    assert "auto_save_records_with_link_fallback" not in builder_kwargs
    assert "should_scan_fixed_sources" not in builder_kwargs
    assert "scan_fixed_sources_for_subscription" not in builder_kwargs
    assert "evaluate_pre_scan_cleanup" not in builder_kwargs


def test_default_runtime_dependencies_bind_existing_services_and_runners() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    def build_hdhive_unlock_context() -> dict[str, Any]:
        return {}

    def resolve_source_order(_channel: str) -> list[str]:
        return ["hdhive"]

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def fetch_resources(
        *_args: Any,
        **_kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        return ([], [], {})

    async def store_new_resources(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        resolve_source_order=resolve_source_order,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        fetch_resources=fetch_resources,
        store_new_resources=store_new_resources,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.log_background_event.__self__ is operation_log_service
    assert (
        dependencies.log_background_event.__func__
        is type(operation_log_service).log_background_event
    )
    assert dependencies.create_execution_log is create_execution_log
    assert dependencies.create_step_log is create_step_log
    assert dependencies.prune_step_logs is prune_step_logs
    assert dependencies.load_active_subscriptions is load_active_subscription_snapshots
    assert dependencies.build_hdhive_unlock_context is build_hdhive_unlock_context
    assert dependencies.resolve_source_order is resolve_source_order
    assert dependencies.session_factory is async_session_maker
    assert dependencies.evaluate_pre_scan_cleanup is evaluate_pre_scan_cleanup
    assert dependencies.fetch_resources is fetch_resources
    assert dependencies.store_new_resources is store_new_resources
    assert dependencies.load_retryable_records is load_retryable_records
    assert dependencies.load_force_retry_records is load_force_retry_records
    assert (
        dependencies.auto_save_records_with_link_fallback
        is auto_save_records_with_link_fallback
    )
    assert dependencies.should_scan_fixed_sources is should_scan_fixed_sources
    assert (
        dependencies.scan_fixed_sources_for_subscription
        is scan_fixed_sources_for_subscription
    )
    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )
    assert dependencies.now is beijing_now
    run_id = dependencies.make_run_id()
    assert len(run_id) == 32
    int(run_id, 16)
    assert dependencies.make_result_lock is asyncio.Lock
    assert dependencies.success_status is ExecutionStatus.SUCCESS
    assert dependencies.failed_status is ExecutionStatus.FAILED
    assert dependencies.partial_status is ExecutionStatus.PARTIAL
    assert dependencies.tv_media_type is MediaType.TV
    assert dependencies.run_start is start_subscription_run
    assert dependencies.dispatch_checks is dispatch_subscription_checks
    assert dependencies.process_item is process_subscription_item
    assert dependencies.finalize_run is finalize_subscription_run


def test_default_runtime_dependencies_bind_execution_log_defaults_without_service_callbacks() -> None:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.create_execution_log
        is execution_logs_module.create_execution_log
    )
    assert dependencies.create_step_log is execution_logs_module.create_step_log
    assert dependencies.prune_step_logs is execution_logs_module.prune_step_logs


def test_default_runtime_dependencies_bind_delete_default_without_service_callback() -> None:
    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
    )

    assert dependencies.delete_subscription_with_records is (
        delete_service_module.delete_subscription_with_records_with_default_service
    )


def test_default_runtime_dependencies_pass_default_delete_to_pre_scan_cleanup_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def default_evaluate_pre_scan_cleanup(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    factory_calls: list[tuple[Any, Any]] = []

    def fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
        callback_delete_subscription_with_records: Any,
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(
            (
                callback_delete_subscription_with_records,
                callback_create_step_log,
            )
        )
        return default_evaluate_pre_scan_cleanup

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
    )

    assert dependencies.evaluate_pre_scan_cleanup is default_evaluate_pre_scan_cleanup
    assert factory_calls == [
        (
            delete_service_module.delete_subscription_with_records_with_default_service,
            execution_logs_module.create_step_log,
        )
    ]


def test_default_runtime_dependencies_preserve_falsy_delete_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    delete_subscription_with_records = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.delete_subscription_with_records
        is delete_subscription_with_records
    )


def test_default_runtime_dependencies_pass_default_step_log_to_pre_scan_cleanup_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def default_evaluate_pre_scan_cleanup(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    factory_calls: list[tuple[Any, Any]] = []

    def fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
        callback_delete_subscription_with_records: Any,
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(
            (
                callback_delete_subscription_with_records,
                callback_create_step_log,
            )
        )
        return default_evaluate_pre_scan_cleanup

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.evaluate_pre_scan_cleanup is default_evaluate_pre_scan_cleanup
    assert factory_calls == [
        (
            delete_subscription_with_records,
            execution_logs_module.create_step_log,
        )
    ]


def test_default_runtime_dependencies_pass_default_step_log_to_fixed_source_scan_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def default_scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    factory_calls: list[Any] = []

    def fake_build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(callback_create_step_log)
        return default_scan_fixed_sources_for_subscription

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies",
        fake_build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.scan_fixed_sources_for_subscription
        is default_scan_fixed_sources_for_subscription
    )
    assert factory_calls == [execution_logs_module.create_step_log]


def test_default_runtime_dependencies_preserve_falsy_execution_log_injections() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    create_execution_log = FalsyAsyncCallable()
    create_step_log = FalsyAsyncCallable()
    prune_step_logs = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.create_execution_log is create_execution_log
    assert dependencies.create_step_log is create_step_log
    assert dependencies.prune_step_logs is prune_step_logs


def test_default_runtime_dependencies_bind_resource_io_defaults_without_service_callbacks() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    def build_hdhive_unlock_context() -> dict[str, Any]:
        return {}

    def resolve_source_order(_channel: str) -> list[str]:
        return ["hdhive"]

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        resolve_source_order=resolve_source_order,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.fetch_resources is (
        run_channel_runtime_module.fetch_resources_with_default_runtime_dependencies
    )
    assert dependencies.store_new_resources is store_new_resources_with_runtime_adapter


def test_default_runtime_dependencies_bind_run_start_defaults_without_service_callbacks() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.build_hdhive_unlock_context is (
        run_channel_runtime_module.build_hdhive_unlock_context_with_runtime_adapter
    )
    assert dependencies.resolve_source_order is (
        run_channel_runtime_module.resolve_source_order_with_runtime_adapter
    )


def test_default_runtime_dependencies_bind_record_loader_defaults_without_service_callbacks() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.load_retryable_records is (
        run_channel_runtime_module.load_retryable_records_with_db_adapter
    )
    assert dependencies.load_force_retry_records is (
        run_channel_runtime_module.load_force_retry_records_with_db_adapter
    )


def test_default_runtime_dependencies_bind_link_fallback_default_without_service_callback() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.auto_save_records_with_link_fallback is (
        run_channel_runtime_module.auto_save_records_with_link_fallback_with_default_runtime_dependencies
    )


def test_default_runtime_dependencies_bind_fixed_source_policy_default_without_service_callback() -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.should_scan_fixed_sources is (
        run_channel_runtime_module.should_scan_fixed_sources_policy
    )


def test_default_runtime_dependencies_bind_fixed_source_scan_default_without_service_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def default_scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    factory_calls: list[Any] = []

    def fake_build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(callback_create_step_log)
        return default_scan_fixed_sources_for_subscription

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies",
        fake_build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies,
        raising=False,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.scan_fixed_sources_for_subscription
        is default_scan_fixed_sources_for_subscription
    )
    assert factory_calls == [create_step_log]


def test_default_runtime_dependencies_bind_pre_scan_cleanup_default_without_service_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def default_evaluate_pre_scan_cleanup(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {"deleted": False}

    factory_calls: list[tuple[Any, Any]] = []

    def fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
        callback_delete_subscription_with_records: Any,
        callback_create_step_log: Any,
    ) -> Any:
        factory_calls.append(
            (
                callback_delete_subscription_with_records,
                callback_create_step_log,
            )
        )
        return default_evaluate_pre_scan_cleanup

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies",
        fake_build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies,
        raising=False,
    )

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.evaluate_pre_scan_cleanup is default_evaluate_pre_scan_cleanup
    assert factory_calls == [
        (delete_subscription_with_records, create_step_log)
    ]


def test_default_runtime_dependencies_preserve_falsy_link_fallback_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {}

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    auto_save_records_with_link_fallback = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.auto_save_records_with_link_fallback
        is auto_save_records_with_link_fallback
    )


def test_default_runtime_dependencies_preserve_falsy_fixed_source_policy_injection() -> None:
    class FalsyCallable:
        def __bool__(self) -> bool:
            return False

        def __call__(self, *_args: Any, **_kwargs: Any) -> bool:
            return True

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    should_scan_fixed_sources = FalsyCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.should_scan_fixed_sources is should_scan_fixed_sources


def test_default_runtime_dependencies_preserve_falsy_fixed_source_scan_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {}

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    scan_fixed_sources_for_subscription = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert (
        dependencies.scan_fixed_sources_for_subscription
        is scan_fixed_sources_for_subscription
    )


def test_default_runtime_dependencies_preserve_falsy_pre_scan_cleanup_injection() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            return {"deleted": False}

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    evaluate_pre_scan_cleanup = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.evaluate_pre_scan_cleanup is evaluate_pre_scan_cleanup


def test_default_runtime_dependencies_preserve_falsy_record_loader_injections() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> Any:
            return []

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    load_retryable_records = FalsyAsyncCallable()
    load_force_retry_records = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.load_retryable_records is load_retryable_records
    assert dependencies.load_force_retry_records is load_force_retry_records


async def test_default_link_fallback_helper_builds_link_fallback_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    sub = object()
    records = [object()]
    runtime_dependencies = object()
    adapter_kwargs: dict[str, Any] = {}

    def fake_build_default_link_fallback_runtime_dependencies() -> object:
        return runtime_dependencies

    async def fake_auto_save_records_with_link_fallback_with_runtime_adapter(
        **kwargs: Any,
    ) -> dict[str, Any]:
        adapter_kwargs.update(kwargs)
        return {"saved": 1}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_link_fallback_runtime_dependencies",
        fake_build_default_link_fallback_runtime_dependencies,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "auto_save_records_with_link_fallback_with_runtime_adapter",
        fake_auto_save_records_with_link_fallback_with_runtime_adapter,
    )

    result = await (
        run_channel_runtime_module.auto_save_records_with_link_fallback_with_default_runtime_dependencies(
            db=db,
            run_id="run-1",
            channel="movie",
            sub=sub,
            records=records,
            transfer_source="retry",
            tv_missing_snapshot={"missing_count": 2},
            hdhive_unlock_context={"enabled": True},
            source_order=["hdhive", "tg"],
            enable_link_refetch=False,
        )
    )

    assert result == {"saved": 1}
    assert adapter_kwargs == {
        "db": db,
        "run_id": "run-1",
        "channel": "movie",
        "sub": sub,
        "records": records,
        "transfer_source": "retry",
        "dependencies": runtime_dependencies,
        "tv_missing_snapshot": {"missing_count": 2},
        "hdhive_unlock_context": {"enabled": True},
        "source_order": ["hdhive", "tg"],
        "enable_link_refetch": False,
    }


@pytest.mark.asyncio
async def test_default_fixed_source_scan_callback_builds_fixed_source_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    sub = object()
    runtime_dependencies = object()
    adapter_kwargs: dict[str, Any] = {}
    builder_calls: list[Any] = []

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    def fake_build_default_fixed_source_scan_runtime_dependencies(
        *,
        create_step_log: Any,
    ) -> object:
        builder_calls.append(create_step_log)
        return runtime_dependencies

    async def fake_scan_fixed_sources_with_runtime_adapter(
        **kwargs: Any,
    ) -> dict[str, Any]:
        adapter_kwargs.update(kwargs)
        return {"saved_count": 2, "failed_count": 1}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_fixed_source_scan_runtime_dependencies",
        fake_build_default_fixed_source_scan_runtime_dependencies,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "scan_fixed_sources_with_runtime_adapter",
        fake_scan_fixed_sources_with_runtime_adapter,
    )

    scan_fixed_sources_for_subscription = (
        run_channel_runtime_module.build_scan_fixed_sources_for_subscription_with_default_runtime_dependencies(
            create_step_log
        )
    )

    result = await scan_fixed_sources_for_subscription(
        db,
        run_id="run-1",
        channel="all",
        sub=sub,
        tv_missing_snapshot={"missing_count": 3},
        force_auto_download=True,
    )

    assert result == {"saved_count": 2, "failed_count": 1}
    assert builder_calls == [create_step_log]
    assert adapter_kwargs == {
        "db": db,
        "run_id": "run-1",
        "channel": "all",
        "sub": sub,
        "dependencies": runtime_dependencies,
        "tv_missing_snapshot": {"missing_count": 3},
        "force_auto_download": True,
    }


@pytest.mark.asyncio
async def test_default_pre_scan_cleanup_callback_builds_pre_scan_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = object()
    sub = object()
    runtime_dependencies = object()
    adapter_calls: list[dict[str, Any]] = []
    builder_calls: list[dict[str, Any]] = []

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    def fake_build_default_pre_scan_cleanup_runtime_dependencies(
        *,
        delete_subscription_with_records: Any,
        create_step_log: Any,
    ) -> object:
        builder_calls.append(
            {
                "delete_subscription_with_records": delete_subscription_with_records,
                "create_step_log": create_step_log,
            }
        )
        return runtime_dependencies

    async def fake_evaluate_pre_scan_cleanup_with_runtime_adapter(
        current_db: Any,
        *,
        run_id: str,
        channel: str,
        sub: Any,
        dependencies: Any,
    ) -> dict[str, Any]:
        adapter_calls.append(
            {
                "db": current_db,
                "run_id": run_id,
                "channel": channel,
                "sub": sub,
                "dependencies": dependencies,
            }
        )
        return {"deleted": False, "tv_missing_snapshot": None}

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_pre_scan_cleanup_runtime_dependencies",
        fake_build_default_pre_scan_cleanup_runtime_dependencies,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "evaluate_pre_scan_cleanup_with_runtime_adapter",
        fake_evaluate_pre_scan_cleanup_with_runtime_adapter,
    )

    evaluate_pre_scan_cleanup = (
        run_channel_runtime_module.build_evaluate_pre_scan_cleanup_with_default_runtime_dependencies(
            delete_subscription_with_records,
            create_step_log,
        )
    )

    result = await evaluate_pre_scan_cleanup(
        db,
        run_id="run-1",
        channel="all",
        sub=sub,
    )

    assert result == {"deleted": False, "tv_missing_snapshot": None}
    assert builder_calls == [
        {
            "delete_subscription_with_records": delete_subscription_with_records,
            "create_step_log": create_step_log,
        }
    ]
    assert adapter_calls == [
        {
            "db": db,
            "run_id": "run-1",
            "channel": "all",
            "sub": sub,
            "dependencies": runtime_dependencies,
        }
    ]


def test_default_runtime_dependencies_preserve_falsy_resource_io_injections() -> None:
    class FalsyAsyncCallable:
        def __bool__(self) -> bool:
            return False

        async def __call__(self, *_args: Any, **_kwargs: Any) -> Any:
            return {}

    async def create_execution_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def create_step_log(_db: Any, **_kwargs: Any) -> None:
        return None

    async def prune_step_logs(_db: Any) -> None:
        return None

    def build_hdhive_unlock_context() -> dict[str, Any]:
        return {}

    def resolve_source_order(_channel: str) -> list[str]:
        return ["hdhive"]

    async def evaluate_pre_scan_cleanup(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {"deleted": False}

    async def load_retryable_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def load_force_retry_records(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def auto_save_records_with_link_fallback(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    def should_scan_fixed_sources(*_args: Any, **_kwargs: Any) -> bool:
        return False

    async def scan_fixed_sources_for_subscription(
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        return {}

    async def delete_subscription_with_records(
        _db: Any,
        _subscription_id: int,
    ) -> None:
        return None

    fetch_resources = FalsyAsyncCallable()
    store_new_resources = FalsyAsyncCallable()

    dependencies = build_default_run_channel_runtime_dependencies(
        create_execution_log=create_execution_log,
        create_step_log=create_step_log,
        prune_step_logs=prune_step_logs,
        build_hdhive_unlock_context=build_hdhive_unlock_context,
        resolve_source_order=resolve_source_order,
        evaluate_pre_scan_cleanup=evaluate_pre_scan_cleanup,
        fetch_resources=fetch_resources,
        store_new_resources=store_new_resources,
        load_retryable_records=load_retryable_records,
        load_force_retry_records=load_force_retry_records,
        auto_save_records_with_link_fallback=(
            auto_save_records_with_link_fallback
        ),
        should_scan_fixed_sources=should_scan_fixed_sources,
        scan_fixed_sources_for_subscription=scan_fixed_sources_for_subscription,
        delete_subscription_with_records=delete_subscription_with_records,
    )

    assert dependencies.fetch_resources is fetch_resources
    assert dependencies.store_new_resources is store_new_resources


@pytest.mark.asyncio
async def test_default_resource_fetch_helper_builds_resource_resolver_runtime_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = SimpleNamespace(id=1, title="示例订阅")
    dependencies_marker = object()
    marker = ([{"name": "资源"}], [{"trace": "ok"}], {"summary": "ok"})
    calls: list[dict[str, Any]] = []

    def fake_builder() -> object:
        calls.append({"builder": True})
        return dependencies_marker

    async def fake_fetch_subscription_resources_with_runtime_adapter(
        **kwargs: Any,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        calls.append({"fetch": kwargs})
        return marker

    monkeypatch.setattr(
        run_channel_runtime_module,
        "build_default_resource_resolver_runtime_dependencies",
        fake_builder,
        raising=False,
    )
    monkeypatch.setattr(
        run_channel_runtime_module,
        "fetch_subscription_resources_with_runtime_adapter",
        fake_fetch_subscription_resources_with_runtime_adapter,
        raising=False,
    )

    result = await run_channel_runtime_module.fetch_resources_with_default_runtime_dependencies(
        "all",
        sub,
        {"enabled": True},
        source_order=["hdhive"],
        exclude_urls={"https://115.com/s/old"},
    )

    assert result is marker
    assert calls == [
        {"builder": True},
        {
            "fetch": {
                "channel": "all",
                "sub": sub,
                "dependencies": dependencies_marker,
                "hdhive_unlock_context": {"enabled": True},
                "source_order": ["hdhive"],
                "exclude_urls": {"https://115.com/s/old"},
            }
        },
    ]


def test_run_channel_runtime_adapter_module_boundary() -> None:
    source = (
        ROOT / "backend/app/services/subscriptions/run_channel_runtime_adapter.py"
    ).read_text(encoding="utf-8")

    assert "subscription_service" not in source
    assert "app.api" not in source
    assert "AsyncSession" not in source

"""应用级配置与模型契约测试"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.api.archive import ArchiveConfigRequest
from app.core.config import settings
from app.core.database import engine
from app.core.database import validate_database_backend


def test_archive_config_request_uses_pydantic_v2_config() -> None:
    """请求模型不应再保留 Pydantic v1 class Config"""
    assert "Config" not in ArchiveConfigRequest.__dict__


def test_sqlalchemy_echo_is_disabled_by_default() -> None:
    """默认容器日志不输出 SQLAlchemy SQL 明细"""
    assert engine.echo is False


def test_application_database_requires_postgres(monkeypatch: pytest.MonkeyPatch) -> None:
    """应用主数据库只接受 PostgreSQL。"""
    monkeypatch.setattr(settings, "DATABASE_URL", "sqlite+aiosqlite:///tmp/test.db")

    with pytest.raises(RuntimeError, match="requires PostgreSQL"):
        validate_database_backend()

    monkeypatch.setattr(
        settings,
        "DATABASE_URL",
        "postgresql+asyncpg://mediasync:mediasync@127.0.0.1:5432/mediasync115",
    )
    validate_database_backend()


def test_database_import_validates_backend_before_engine_creation() -> None:
    """首次导入数据库模块时也应先给出 PostgreSQL 配置错误。"""
    backend_root = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "APP_NAME": "MediaSync115",
        "DATABASE_URL": "sqlite+aiosqlite:///tmp/legacy.db",
        "PYTHONPATH": str(backend_root),
    }
    result = subprocess.run(
        [sys.executable, "-c", "import app.core.database"],
        cwd=backend_root,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    combined_output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "requires PostgreSQL" in combined_output
    assert "ModuleNotFoundError" not in combined_output
    assert "No module named 'aiosqlite'" not in combined_output


def test_watchlist_auto_fill_is_registered_as_scheduler_job() -> None:
    """片单 auto_fill_enabled 应被调度器实际消费。"""
    backend_root = Path(__file__).resolve().parents[1]
    job_registry = (backend_root / "app/services/job_registry.py").read_text(
        encoding="utf-8"
    )
    scheduler_service = (
        backend_root / "app/services/subscription_scheduler_service.py"
    ).read_text(encoding="utf-8")
    watchlist_service = (
        backend_root / "app/services/watchlist_service.py"
    ).read_text(encoding="utf-8")
    watchlists_api = (backend_root / "app/api/watchlists.py").read_text(
        encoding="utf-8"
    )
    main = (backend_root / "main.py").read_text(encoding="utf-8")

    assert '"watchlist.auto_fill"' in job_registry
    assert "run_auto_fill_watchlists" in job_registry
    assert "run_auto_fill_watchlists" in watchlist_service
    assert "Watchlist.auto_fill_enabled == True" in scheduler_service
    assert "ensure_watchlist_auto_fill_task" in scheduler_service
    assert "ensure_watchlist_auto_fill_task" in watchlists_api
    assert "ensure_watchlist_auto_fill_task" in main

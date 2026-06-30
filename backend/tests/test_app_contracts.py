"""应用级配置与模型契约测试"""

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

"""应用级配置与模型契约测试"""

from app.api.archive import ArchiveConfigRequest
from app.core.database import engine


def test_archive_config_request_uses_pydantic_v2_config() -> None:
    """请求模型不应再保留 Pydantic v1 class Config"""
    assert "Config" not in ArchiveConfigRequest.__dict__


def test_sqlalchemy_echo_is_disabled_by_default() -> None:
    """默认容器日志不输出 SQLAlchemy SQL 明细"""
    assert engine.echo is False

"""
Pytest 配置文件
"""
import asyncio
import atexit
import os
import socket
import subprocess
import sys
import time
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


_test_postgres_container: str | None = None


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _run_command(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _cleanup_test_postgres() -> None:
    if _test_postgres_container:
        _run_command(["docker", "rm", "-f", _test_postgres_container], check=False)


def _configure_test_database() -> None:
    global _test_postgres_container

    explicit_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if explicit_url:
        if not explicit_url.startswith("postgresql+asyncpg://"):
            raise RuntimeError("TEST_DATABASE_URL must use postgresql+asyncpg://")
        os.environ["DATABASE_URL"] = explicit_url
        return

    port = _find_free_port()
    container_name = f"mediasync115-test-postgres-{os.getpid()}"
    _run_command(["docker", "rm", "-f", container_name], check=False)
    try:
        _run_command(
            [
                "docker",
                "run",
                "--rm",
                "-d",
                "--name",
                container_name,
                "-e",
                "POSTGRES_DB=mediasync115_test",
                "-e",
                "POSTGRES_USER=mediasync",
                "-e",
                "POSTGRES_PASSWORD=mediasync",
                "-p",
                f"127.0.0.1:{port}:5432",
                "postgres:16-alpine",
            ]
        )
    except Exception as exc:
        raise RuntimeError(
            "pytest requires PostgreSQL. Set TEST_DATABASE_URL to an existing "
            "test database, or make Docker available so tests can start "
            "postgres:16-alpine."
        ) from exc

    _test_postgres_container = container_name
    atexit.register(_cleanup_test_postgres)

    for _ in range(60):
        result = _run_command(
            [
                "docker",
                "exec",
                container_name,
                "pg_isready",
                "-U",
                "mediasync",
                "-d",
                "mediasync115_test",
            ],
            check=False,
        )
        if result.returncode == 0:
            os.environ["DATABASE_URL"] = (
                "postgresql+asyncpg://"
                f"mediasync:mediasync@127.0.0.1:{port}/mediasync115_test"
            )
            return
        time.sleep(1)

    raise RuntimeError("test PostgreSQL container did not become ready in time")


os.environ.setdefault("APP_NAME", "MediaSync115-Test")
os.environ.setdefault("APP_VERSION", "1.0.0-test")
_configure_test_database()
os.environ.setdefault("TMDB_API_KEY", "test-api-key")


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """创建事件循环"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """创建异步 HTTP 客户端"""
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def _login_test_client(test_client: TestClient) -> None:
    response = test_client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert response.status_code == 200


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    """创建已登录的同步 HTTP 客户端"""
    from main import app

    with TestClient(app) as test_client:
        _login_test_client(test_client)
        yield test_client


@pytest.fixture()
def unauthenticated_client() -> Generator[TestClient, None, None]:
    """创建未登录的同步 HTTP 客户端"""
    from main import app

    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()

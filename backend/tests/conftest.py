"""
Pytest 配置文件
"""
import asyncio
import os
import sys
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("APP_NAME", "MediaSync115-Test")
os.environ.setdefault("APP_VERSION", "1.0.0-test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./data/test.db")
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

    with TestClient(app) as test_client:
        yield test_client

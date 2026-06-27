"""
健康检查 API 测试
"""
import pytest
from fastapi.testclient import TestClient


class TestHealth:
    """健康检查测试类"""

    def test_root_endpoint(self, client: TestClient) -> None:
        """测试根端点"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "name" in data
        assert "version" in data
        assert data["status"] == "running"

    def test_health_endpoint(self, client: TestClient) -> None:
        """测试健康检查端点"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_openapi_docs(self, client: TestClient) -> None:
        """测试 API 文档端点"""
        response = client.get("/docs")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_openapi_json(self, client: TestClient) -> None:
        """测试 OpenAPI JSON 端点"""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert data["openapi"].startswith("3.")
        assert "paths" in data

    def test_openapi_operation_ids_are_unique(self, client: TestClient) -> None:
        """OpenAPI 操作 ID 不能重复，避免客户端生成代码冲突"""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()

        operation_ids: dict[str, list[str]] = {}
        for path, path_item in data["paths"].items():
            for method, operation in path_item.items():
                if not isinstance(operation, dict):
                    continue
                operation_id = operation.get("operationId")
                if operation_id:
                    operation_ids.setdefault(operation_id, []).append(
                        f"{method.upper()} {path}"
                    )

        duplicates = {
            operation_id: routes
            for operation_id, routes in operation_ids.items()
            if len(routes) > 1
        }
        assert duplicates == {}

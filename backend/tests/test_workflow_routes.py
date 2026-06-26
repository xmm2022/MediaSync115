from fastapi.testclient import TestClient


def test_workflow_event_types_route_is_not_shadowed(client: TestClient) -> None:
    login_response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "password"},
    )
    assert login_response.status_code == 200

    response = client.get("/api/workflow/event-types")

    assert response.status_code == 200
    data = response.json()
    assert data["items"]
    assert data["items"][0]["value"] == "download.completed"

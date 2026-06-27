import json

from app.services.runtime_settings_service import RuntimeSettingsService


def test_moviepilot_settings_persist_and_mask_password(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    service = RuntimeSettingsService()
    updated = service.update_bulk(
        {
            "moviepilot_enabled": True,
            "moviepilot_base_url": " http://moviepilot.local/ ",
            "moviepilot_username": " admin ",
            "moviepilot_password": " secret ",
            "moviepilot_save_path": "/incoming/pt",
        }
    )

    assert updated["moviepilot_enabled"] is True
    assert updated["moviepilot_base_url"] == "http://moviepilot.local"
    assert updated["moviepilot_username"] == "admin"
    assert updated["moviepilot_password_configured"] is True
    assert "moviepilot_password" not in updated

    persisted = json.loads(
        (tmp_path / "data" / "runtime_settings.json").read_text(encoding="utf-8")
    )
    assert persisted["moviepilot_base_url"] == "http://moviepilot.local"
    assert persisted["moviepilot_username"] == "admin"
    assert persisted["moviepilot_password_enc"]
    assert persisted["moviepilot_save_path"] == "/incoming/pt"

    reloaded = RuntimeSettingsService()
    assert reloaded.get_moviepilot_password() == "secret"
    assert reloaded.get_moviepilot_config()["password_configured"] is True

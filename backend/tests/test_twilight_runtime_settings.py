from app.services.runtime_settings_service import RuntimeSettingsService


def test_twilight_settings_persist_and_mask_api_key(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    service = RuntimeSettingsService()

    updated = service.update_bulk(
        {
            "twilight_enabled": True,
            "twilight_base_url": " http://twilight.local:5000/ ",
            "twilight_web_url": " http://twilight.local:3000/ ",
            "twilight_api_key": " key-secret ",
        }
    )

    assert updated["twilight_enabled"] is True
    assert updated["twilight_base_url"] == "http://twilight.local:5000"
    assert updated["twilight_web_url"] == "http://twilight.local:3000"
    assert updated["twilight_api_key_configured"] is True
    assert "twilight_api_key" not in updated

    reloaded = RuntimeSettingsService()

    assert reloaded.get_twilight_api_key() == "key-secret"
    assert reloaded.get_twilight_config()["api_key_configured"] is True

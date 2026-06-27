from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.services.runtime_settings_service import runtime_settings_service
from app.services.twilight_client import TwilightClient, TwilightClientError

router = APIRouter(prefix="/twilight", tags=["Twilight"])


@router.get("/config")
async def get_twilight_config() -> dict[str, Any]:
    return runtime_settings_service.get_twilight_config()


@router.get("/health")
async def check_twilight_health() -> dict[str, Any]:
    client = TwilightClient(
        base_url=runtime_settings_service.get_twilight_base_url(),
        api_key=runtime_settings_service.get_twilight_api_key(),
    )
    try:
        health = await client.health()
        api_key_status = None
        if runtime_settings_service.get_twilight_api_key():
            api_key_status = await client.api_key_status()
    except TwilightClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "ok": True,
        "health": health,
        "api_key_status": api_key_status,
    }

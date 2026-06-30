from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.database import validate_database_backend

logger = logging.getLogger(__name__)


def _run_upgrade_head() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    alembic_ini = backend_root / "alembic.ini"
    alembic_dir = backend_root / "alembic"
    if not alembic_ini.exists():
        logger.warning("alembic.ini not found, skipping database migration")
        return

    config = Config(str(alembic_ini))
    config.set_main_option("script_location", str(alembic_dir))
    command.upgrade(config, "head")


async def run_database_migrations() -> None:
    validate_database_backend()
    await asyncio.to_thread(_run_upgrade_head)

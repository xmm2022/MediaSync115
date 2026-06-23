import pytest
from sqlalchemy import inspect


@pytest.mark.asyncio
async def test_subscription_source_tables_are_registered():
    from app.core.database import Base, engine, ensure_tables_exist
    from app.models.models import SubscriptionSource, SubscriptionSourceFile

    assert SubscriptionSource.__tablename__ == "subscription_sources"
    assert SubscriptionSourceFile.__tablename__ == "subscription_source_files"
    assert "subscription_sources" in Base.metadata.tables
    assert "subscription_source_files" in Base.metadata.tables

    await ensure_tables_exist("subscription_sources", "subscription_source_files")

    async with engine.begin() as conn:
        tables = await conn.run_sync(
            lambda sync_conn: set(inspect(sync_conn).get_table_names())
        )

    assert "subscription_sources" in tables
    assert "subscription_source_files" in tables

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect

from app.core.database import Base, load_model_metadata

revision = "20260630_0001"
down_revision = None
branch_labels = None
depends_on = None


IDENTITY_COLUMNS = {"douban_id", "tmdb_id", "imdb_id"}


def _drop_known_postgres_identity_uniques(bind) -> None:
    inspector = inspect(bind)
    existing = {
        item.get("name")
        for item in inspector.get_unique_constraints("subscriptions")
        if len(item.get("column_names") or []) == 1
        and set(item.get("column_names") or []).issubset(IDENTITY_COLUMNS)
    }
    for constraint_name in existing:
        if constraint_name:
            op.drop_constraint(constraint_name, "subscriptions", type_="unique")


def _create_identity_indexes() -> None:
    op.create_index(
        "ix_subscriptions_active_created",
        "subscriptions",
        ["is_active", "created_at"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "ix_subscriptions_tmdb_id",
        "subscriptions",
        ["tmdb_id"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "ix_subscriptions_douban_id",
        "subscriptions",
        ["douban_id"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "ix_subscriptions_imdb_id",
        "subscriptions",
        ["imdb_id"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "ix_subscriptions_provider_external",
        "subscriptions",
        ["provider", "external_system"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "ix_subscriptions_external_subscription_id",
        "subscriptions",
        ["external_subscription_id"],
        unique=False,
        if_not_exists=True,
    )


def upgrade() -> None:
    bind = op.get_bind()
    load_model_metadata()
    Base.metadata.create_all(bind=bind)

    tables = set(inspect(bind).get_table_names())
    if "subscriptions" in tables:
        _drop_known_postgres_identity_uniques(bind)
        _create_identity_indexes()


def downgrade() -> None:
    op.drop_table("moviepilot_completion_records")

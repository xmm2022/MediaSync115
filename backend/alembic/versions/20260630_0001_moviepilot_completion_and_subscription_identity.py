from __future__ import annotations

from alembic import op
from sqlalchemy import inspect

from app.core.database import Base, load_model_metadata

revision = "20260630_0001"
down_revision = None
branch_labels = None
depends_on = None


IDENTITY_COLUMNS = {"douban_id", "tmdb_id", "imdb_id"}
LEGACY_IDENTITY_UNIQUE_CONSTRAINTS = {
    "douban_id": "subscriptions_douban_id_key",
    "tmdb_id": "subscriptions_tmdb_id_key",
}
LEGACY_IDENTITY_UNIQUE_INDEXES = {
    "imdb_id": "ix_subscriptions_imdb_id",
}
DOWNGRADE_DROP_INDEXES = (
    "ix_subscriptions_provider_external",
    "ix_subscriptions_tmdb_id",
    "ix_subscriptions_douban_id",
    "ix_subscriptions_imdb_id",
)


def _drop_known_postgres_identity_uniques(bind) -> None:
    inspector = inspect(bind)
    existing_constraints = {
        item.get("name")
        for item in inspector.get_unique_constraints("subscriptions")
        if len(item.get("column_names") or []) == 1
        and set(item.get("column_names") or []).issubset(IDENTITY_COLUMNS)
    }
    for constraint_name in existing_constraints:
        if constraint_name:
            op.drop_constraint(constraint_name, "subscriptions", type_="unique")

    inspector = inspect(bind)
    existing_unique_indexes = {
        item.get("name")
        for item in inspector.get_indexes("subscriptions")
        if item.get("unique")
        and not item.get("duplicates_constraint")
        and len(item.get("column_names") or []) == 1
        and set(item.get("column_names") or []).issubset(IDENTITY_COLUMNS)
    }
    for index_name in existing_unique_indexes:
        if index_name:
            op.drop_index(index_name, table_name="subscriptions")


def _has_unique_identity(bind, column_name: str) -> bool:
    inspector = inspect(bind)
    for item in inspector.get_unique_constraints("subscriptions"):
        if item.get("column_names") == [column_name]:
            return True
    for item in inspector.get_indexes("subscriptions"):
        if item.get("unique") and item.get("column_names") == [column_name]:
            return True
    return False


def _restore_legacy_subscription_identity_uniques(bind) -> None:
    existing_indexes = {
        item.get("name")
        for item in inspect(bind).get_indexes("subscriptions")
    }
    for index_name in DOWNGRADE_DROP_INDEXES:
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name="subscriptions")

    for column_name, constraint_name in LEGACY_IDENTITY_UNIQUE_CONSTRAINTS.items():
        if not _has_unique_identity(bind, column_name):
            op.create_unique_constraint(
                constraint_name,
                "subscriptions",
                [column_name],
            )

    for column_name, index_name in LEGACY_IDENTITY_UNIQUE_INDEXES.items():
        if not _has_unique_identity(bind, column_name):
            op.create_index(
                index_name,
                "subscriptions",
                [column_name],
                unique=True,
            )


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
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "moviepilot_completion_records" in tables:
        op.drop_table("moviepilot_completion_records")
    if "subscriptions" in tables:
        _restore_legacy_subscription_identity_uniques(bind)

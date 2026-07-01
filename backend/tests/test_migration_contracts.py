from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MOVIEPILOT_MIGRATION = (
    ROOT
    / "alembic"
    / "versions"
    / "20260630_0001_moviepilot_completion_and_subscription_identity.py"
)


def test_moviepilot_completion_migration_downgrade_restores_identity_uniques() -> None:
    source = MOVIEPILOT_MIGRATION.read_text(encoding="utf-8")

    assert "subscriptions_douban_id_key" in source
    assert "subscriptions_tmdb_id_key" in source
    assert "ix_subscriptions_imdb_id" in source
    assert "LEGACY_IDENTITY_UNIQUE_CONSTRAINTS" in source
    assert "LEGACY_IDENTITY_UNIQUE_INDEXES" in source
    assert "DOWNGRADE_DROP_INDEXES" in source
    assert "op.create_unique_constraint" in source
    assert "unique=True" in source
    assert "op.drop_index(index_name, table_name=\"subscriptions\")" in source


def test_moviepilot_completion_migration_upgrade_drops_legacy_unique_indexes() -> None:
    source = MOVIEPILOT_MIGRATION.read_text(encoding="utf-8")

    assert "existing_unique_indexes" in source
    assert "not item.get(\"duplicates_constraint\")" in source
    assert "item.get(\"unique\")" in source

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_claude_single_container_example_configures_postgres_database() -> None:
    claude = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")

    assert "docker network create mediasync115-net" in claude
    assert "--name mediasync115-postgres" in claude
    assert "--network mediasync115-net" in claude
    assert "postgres:16-alpine" in claude
    assert (
        "-e DATABASE_URL=postgresql+asyncpg://mediasync:mediasync@"
        "mediasync115-postgres:5432/mediasync115"
    ) in claude

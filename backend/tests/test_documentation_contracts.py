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


def test_dockerignore_excludes_runtime_data_from_build_context() -> None:
    dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()

    for pattern in ("data/", "strm/", "logs", "*.db", "*.sqlite3"):
        assert pattern in dockerignore


def test_verification_entrypoints_are_documented() -> None:
    verification = (ROOT / "docs" / "VERIFICATION.md").read_text(encoding="utf-8")

    assert "scripts/verify.sh" in verification
    assert "scripts/verify-backend.sh" in verification
    assert "scripts/verify-frontend.sh" in verification
    assert "scripts/verify-compose.sh" in verification
    assert "scripts/verify-dockerignore.sh" in verification
    assert "TEST_DATABASE_URL" in verification


def test_verification_scripts_exist() -> None:
    for path in (
        "scripts/verify.sh",
        "scripts/verify-backend.sh",
        "scripts/verify-frontend.sh",
        "scripts/verify-compose.sh",
        "scripts/verify-dockerignore.sh",
    ):
        assert (ROOT / path).is_file()

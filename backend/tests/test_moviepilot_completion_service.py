from datetime import timedelta

import pytest
from sqlalchemy import delete, select

import app.services.moviepilot_completion_service as completion_module
from app.core.timezone_utils import beijing_now
from app.models.models import MediaType, MoviePilotCompletionRecord, Subscription
from app.services.moviepilot_completion_service import MoviePilotCompletionService


async def _cleanup_completion_subscription(db, tmdb_id: int) -> None:
    result = await db.execute(select(Subscription.id).where(Subscription.tmdb_id == tmdb_id))
    subscription_ids = [int(row[0]) for row in result.all()]
    if not subscription_ids:
        return
    await db.execute(
        delete(MoviePilotCompletionRecord).where(
            MoviePilotCompletionRecord.subscription_id.in_(subscription_ids)
        )
    )
    await db.execute(delete(Subscription).where(Subscription.id.in_(subscription_ids)))
    await db.commit()


async def _create_completion_subscription(
    db,
    *,
    tmdb_id: int,
) -> Subscription:
    await _cleanup_completion_subscription(db, tmdb_id)
    subscription = Subscription(
        title="Completion State Show",
        media_type=MediaType.TV,
        tmdb_id=tmdb_id,
        year="2026",
        provider="moviepilot",
        external_system="moviepilot",
        external_subscription_id=f"mp-{tmdb_id}",
        auto_download=True,
    )
    db.add(subscription)
    await db.commit()
    await db.refresh(subscription)
    return subscription


def _patch_completion_sources(
    monkeypatch: pytest.MonkeyPatch,
    *,
    tmdb_id: int,
    push_payloads: list[dict],
) -> None:
    async def fake_missing_status(*args, **kwargs):
        return {"status": "ok", "missing_episodes": [(1, 2)]}

    async def fake_search_title(title: str):
        return [
            {
                "title": "Completion.State.Show.S01E02.1080p.WEB-DL",
                "torrent_url": "https://example.test/completion-state-s01e02.torrent",
                "hash": "hash-s01e02",
                "media_info": {"tmdbid": tmdb_id},
            }
        ]

    async def fake_push_download(payload: dict):
        push_payloads.append(payload)
        return {"success": True}

    monkeypatch.setattr(
        completion_module.tv_missing_service,
        "get_tv_missing_status",
        fake_missing_status,
    )
    monkeypatch.setattr(
        completion_module.moviepilot_provider_service,
        "search_title",
        fake_search_title,
    )
    monkeypatch.setattr(
        completion_module.moviepilot_provider_service,
        "push_download",
        fake_push_download,
    )


def test_select_episode_candidates_accepts_single_missing_episode() -> None:
    candidates = MoviePilotCompletionService.select_episode_candidates(
        [
            {
                "title": "Example.Show.S01E02.1080p.WEB-DL",
                "torrent_url": "https://example.test/s01e02.torrent",
                "hash": "hash-s01e02",
            },
            {
                "title": "Example.Show.S01E03.1080p.WEB-DL",
                "torrent_url": "https://example.test/s01e03.torrent",
            },
        ],
        missing_pairs={(1, 2)},
    )

    assert len(candidates) == 1
    assert candidates[0].status == "matched"
    assert candidates[0].season == 1
    assert candidates[0].episode == 2
    assert candidates[0].resource_hash == "hash-s01e02"


def test_select_episode_candidates_marks_packs_and_ranges_ambiguous() -> None:
    candidates = MoviePilotCompletionService.select_episode_candidates(
        [
            {
                "title": "Example.Show.S01E01-E06.1080p.WEB-DL",
                "torrent_url": "https://example.test/range.torrent",
            },
            {
                "title": "Example.Show.S01.Complete.1080p.WEB-DL",
                "torrent_url": "https://example.test/season.torrent",
            },
        ],
        missing_pairs={(1, 1)},
    )

    assert len(candidates) == 1
    assert candidates[0].status == "ambiguous"
    assert "人工确认" in candidates[0].reason


def test_pack_detection_covers_common_multi_episode_titles() -> None:
    titles = [
        "Example.Show.S01E01E02.1080p.WEB-DL",
        "Example.Show.S01E01+E02.1080p.WEB-DL",
        "Example Show 第1集-第12集 1080p",
        "Example.Show.01-12.1080p.WEB-DL",
    ]

    assert all(MoviePilotCompletionService._looks_like_pack_or_multi_episode(title) for title in titles)


def test_select_episode_candidates_marks_missing_url_ambiguous() -> None:
    candidates = MoviePilotCompletionService.select_episode_candidates(
        [{"title": "Example.Show.S01E02.1080p.WEB-DL"}],
        missing_pairs={(1, 2)},
    )

    assert len(candidates) == 1
    assert candidates[0].status == "ambiguous"
    assert candidates[0].reason == "资源缺少可推送的种子下载链接"


def test_select_episode_candidates_marks_wrong_title_ambiguous() -> None:
    candidates = MoviePilotCompletionService.select_episode_candidates(
        [
            {
                "title": "Other.Show.S01E02.1080p.WEB-DL",
                "torrent_url": "https://example.test/s01e02.torrent",
            }
        ],
        missing_pairs={(1, 2)},
        expected_title="Example Show",
    )

    assert len(candidates) == 1
    assert candidates[0].status == "ambiguous"
    assert "标题" in candidates[0].reason


def test_select_episode_candidates_trusts_matching_tmdb_identity() -> None:
    candidates = MoviePilotCompletionService.select_episode_candidates(
        [
            {
                "title": "Localized.Alias.S01E02.1080p.WEB-DL",
                "torrent_url": "https://example.test/s01e02.torrent",
                "media_info": {"tmdbid": 12345},
            }
        ],
        missing_pairs={(1, 2)},
        expected_title="Example Show",
        tmdb_id=12345,
    )

    assert len(candidates) == 1
    assert candidates[0].status == "matched"


def test_failed_completion_status_is_retryable() -> None:
    assert "failed" not in MoviePilotCompletionService.terminal_statuses
    assert "processing" not in MoviePilotCompletionService.terminal_statuses
    assert "pushed" in MoviePilotCompletionService.terminal_statuses


@pytest.mark.asyncio
async def test_force_run_does_not_repush_pushed_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    tmdb_id = 930101
    await ensure_tables_exist()
    push_payloads: list[dict] = []
    _patch_completion_sources(monkeypatch, tmdb_id=tmdb_id, push_payloads=push_payloads)

    async with async_session_maker() as db:
        subscription = await _create_completion_subscription(db, tmdb_id=tmdb_id)
        db.add(
            MoviePilotCompletionRecord(
                subscription_id=subscription.id,
                tmdb_id=tmdb_id,
                season_number=1,
                episode_number=2,
                resource_title="Completion.State.Show.S01E02.1080p.WEB-DL",
                resource_url="https://example.test/completion-state-s01e02.torrent",
                resource_hash="hash-s01e02",
                status="pushed",
                updated_at=beijing_now(),
            )
        )
        await db.commit()

        result = await MoviePilotCompletionService().run_missing_completion(
            db,
            subscription.id,
            force=True,
        )

        assert push_payloads == []
        assert result["pushed_count"] == 0
        assert result["counts"]["processed"] == 1
        assert result["processed"][0]["status"] == "pushed"


@pytest.mark.asyncio
async def test_force_run_does_not_repush_active_processing_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    tmdb_id = 930102
    await ensure_tables_exist()
    push_payloads: list[dict] = []
    _patch_completion_sources(monkeypatch, tmdb_id=tmdb_id, push_payloads=push_payloads)

    async with async_session_maker() as db:
        subscription = await _create_completion_subscription(db, tmdb_id=tmdb_id)
        db.add(
            MoviePilotCompletionRecord(
                subscription_id=subscription.id,
                tmdb_id=tmdb_id,
                season_number=1,
                episode_number=2,
                resource_title="Completion.State.Show.S01E02.1080p.WEB-DL",
                resource_url="https://example.test/completion-state-s01e02.torrent",
                resource_hash="hash-s01e02",
                status="processing",
                updated_at=beijing_now(),
            )
        )
        await db.commit()

        result = await MoviePilotCompletionService().run_missing_completion(
            db,
            subscription.id,
            force=True,
        )

        assert push_payloads == []
        assert result["pushed_count"] == 0
        assert result["counts"]["processed"] == 1
        assert result["processed"][0]["status"] == "processing"


@pytest.mark.asyncio
async def test_stale_processing_record_is_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.database import async_session_maker, ensure_tables_exist

    tmdb_id = 930103
    await ensure_tables_exist()
    push_payloads: list[dict] = []
    _patch_completion_sources(monkeypatch, tmdb_id=tmdb_id, push_payloads=push_payloads)

    async with async_session_maker() as db:
        subscription = await _create_completion_subscription(db, tmdb_id=tmdb_id)
        stale_record = MoviePilotCompletionRecord(
            subscription_id=subscription.id,
            tmdb_id=tmdb_id,
            season_number=1,
            episode_number=2,
            resource_title="Completion.State.Show.S01E02.1080p.WEB-DL",
            resource_url="https://example.test/completion-state-s01e02.torrent",
            resource_hash="hash-s01e02",
            status="processing",
            updated_at=beijing_now() - timedelta(minutes=31),
        )
        db.add(stale_record)
        await db.commit()

        result = await MoviePilotCompletionService().run_missing_completion(
            db,
            subscription.id,
        )
        await db.refresh(stale_record)

        assert len(push_payloads) == 1
        assert result["pushed_count"] == 1
        assert result["pushed"][0]["resource_hash"] == "hash-s01e02"
        assert stale_record.status == "pushed"
        assert stale_record.error_message is None

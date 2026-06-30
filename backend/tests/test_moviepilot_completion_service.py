from app.services.moviepilot_completion_service import MoviePilotCompletionService


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

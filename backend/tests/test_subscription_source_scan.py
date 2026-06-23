from app.services.subscription_source_service import (
    build_source_file_fingerprint,
    select_missing_episode_files,
)


def test_build_source_file_fingerprint_prefers_file_id():
    item = {"fid": "987", "name": "Show.S01E02.mkv", "size": 123}
    assert build_source_file_fingerprint(item) == "fid:987"


def test_build_source_file_fingerprint_falls_back_to_name_and_size():
    item = {"name": "Show.S01E02.mkv", "size": 123}
    assert build_source_file_fingerprint(item) == "name:Show.S01E02.mkv|size:123"


def test_select_missing_episode_files_picks_only_missing_pairs():
    files = [
        {"fid": "1", "name": "Show.S01E01.1080p.mkv", "size": 1000},
        {"fid": "2", "name": "Show.S01E02.1080p.mkv", "size": 2000},
        {"fid": "3", "name": "sample.txt", "size": 10},
    ]

    selected, parsed_count, unparsed_count = select_missing_episode_files(
        files,
        missing_episodes={(1, 2)},
        quality_filter={},
    )

    assert [item["fid"] for item in selected] == ["2"]
    assert parsed_count == 2
    assert unparsed_count == 0

from app.services.subscription_source_service import (
    build_source_file_fingerprint,
    decode_selected_file_ids,
    encode_selected_file_ids,
    select_missing_episode_files,
)
from app.utils.name_parser import name_parser


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


def test_name_parser_accepts_preview_bare_episode_video_suffixes():
    assert name_parser.parse_episode("Show - 01.m4v") == (1, 1)
    assert name_parser.parse_episode("Show_02.webm") == (1, 2)


def test_select_missing_episode_files_matches_m4v_and_webm_preview_hits():
    files = [
        {"fid": "m4v", "name": "Show - 01.m4v", "size": 1000},
        {"fid": "webm", "name": "Show_02.webm", "size": 2000},
    ]

    selected, parsed_count, unparsed_count = select_missing_episode_files(
        files,
        missing_episodes={(1, 1), (1, 2)},
        quality_filter={},
    )

    assert [item["fid"] for item in selected] == ["m4v", "webm"]
    assert parsed_count == 2
    assert unparsed_count == 0


def test_selected_file_ids_are_normalized_and_limit_missing_selection():
    files = [
        {"fid": "1", "name": "Show.S01E01.1080p.mkv", "size": 1000},
        {"fid": "2", "name": "Show.S01E02.1080p.mkv", "size": 2000},
        {"fid": "3", "name": "Show.S01E03.1080p.mkv", "size": 3000},
    ]

    encoded = encode_selected_file_ids(["2", "2", "", " 3 "])
    selected, parsed_count, unparsed_count = select_missing_episode_files(
        files,
        missing_episodes={(1, 1), (1, 2), (1, 3)},
        quality_filter={},
        selected_file_ids=set(decode_selected_file_ids(encoded)),
    )

    assert decode_selected_file_ids(encoded) == ["2", "3"]
    assert [item["fid"] for item in selected] == ["2", "3"]
    assert parsed_count == 2
    assert unparsed_count == 0

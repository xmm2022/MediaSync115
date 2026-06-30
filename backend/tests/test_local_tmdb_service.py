import json
import sqlite3

import pytest


def _create_nextfind_tmdb_db(path):
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            create table tmdb_media (
                id integer,
                type text,
                title text,
                original_title text,
                poster text,
                year integer,
                release_date text,
                vote_average real,
                popularity real,
                genre_ids text,
                status text,
                cast_text text,
                seasons text,
                origin_country text,
                original_language text,
                total_episodes integer default 0,
                aired_episodes integer default 0,
                is_ended boolean default 0,
                updated_at timestamp default current_timestamp,
                trending_today_rank integer default 999999,
                title_pinyin text,
                title_pinyin_initial text,
                primary key (id, type)
            )
            """
        )
        conn.execute(
            """
            create table tmdb_api_cache (
                url_key text primary key,
                response_data text not null,
                updated_at timestamp default current_timestamp
            )
            """
        )
        conn.execute(
            """
            insert into tmdb_media
            (id, type, title, original_title, poster, year, release_date, vote_average,
             popularity, genre_ids, status, cast_text, seasons, origin_country,
             original_language, total_episodes, aired_episodes, is_ended,
             title_pinyin, title_pinyin_initial)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                535167,
                "movie",
                "流浪地球",
                "The Wandering Earth",
                "/poster.jpg",
                2019,
                "2019-02-05",
                6.6,
                5.5,
                json.dumps([878, 28]),
                "Released",
                "吴京, 屈楚萧",
                None,
                json.dumps(["CN"]),
                "zh",
                0,
                0,
                0,
                "liu lang di qiu the wandering earth",
                "lldq the wandering earth",
            ),
        )
        conn.execute(
            """
            insert into tmdb_media
            (id, type, title, original_title, poster, year, release_date, vote_average,
             popularity, genre_ids, status, cast_text, seasons, origin_country,
             original_language, total_episodes, aired_episodes, is_ended,
             title_pinyin, title_pinyin_initial)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1396,
                "tv",
                "绝命毒师",
                "Breaking Bad",
                "/bb.jpg",
                2008,
                "2008-01-20",
                8.9,
                116.5,
                json.dumps([18, 80]),
                "Ended",
                "布莱恩·克兰斯顿, 亚伦·保尔",
                json.dumps(
                    [
                        {
                            "season_number": 1,
                            "name": "第 1 季",
                            "episode_count": 7,
                            "poster_path": "/s1.jpg",
                        }
                    ]
                ),
                json.dumps(["US"]),
                "en",
                62,
                62,
                1,
                "jue ming du shi breaking bad",
                "jmds breaking bad",
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _insert_tmdb_media(
    path,
    *,
    tmdb_id,
    media_type="movie",
    title,
    original_title,
    year,
    popularity,
    cast_text="",
    title_pinyin="",
    title_pinyin_initial="",
):
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            insert into tmdb_media
            (id, type, title, original_title, poster, year, release_date, vote_average,
             popularity, genre_ids, status, cast_text, seasons, origin_country,
             original_language, total_episodes, aired_episodes, is_ended,
             title_pinyin, title_pinyin_initial)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tmdb_id,
                media_type,
                title,
                original_title,
                "",
                year,
                f"{year}-01-01",
                7.0,
                popularity,
                json.dumps([878]),
                "Released",
                cast_text,
                None,
                json.dumps(["CN"]),
                "zh",
                0,
                0,
                0,
                title_pinyin,
                title_pinyin_initial,
            ),
        )
        conn.commit()
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_local_tmdb_search_reads_nextfind_schema(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.local_tmdb_service import local_tmdb_service

    db_path = tmp_path / "tmdb_base.db"
    _create_nextfind_tmdb_db(db_path)
    monkeypatch.setattr(settings, "TMDB_LOCAL_DB_PATH", str(db_path))

    status = await local_tmdb_service.status()
    assert status["available"] is True
    assert status["media_count"] == 2

    payload = await local_tmdb_service.search_by_media_type("流浪地球", "movie")
    assert payload["total_results"] == 1
    assert payload["items"][0]["tmdb_id"] == 535167
    assert payload["items"][0]["source_service"] == "local_tmdb"


@pytest.mark.asyncio
async def test_local_tmdb_search_prioritizes_relevance_over_popularity(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.local_tmdb_service import local_tmdb_service

    db_path = tmp_path / "tmdb_base.db"
    _create_nextfind_tmdb_db(db_path)
    _insert_tmdb_media(
        db_path,
        tmdb_id=999999,
        title="流浪地球2",
        original_title="The Wandering Earth II",
        year=2023,
        popularity=9999,
        cast_text="吴京, 刘德华",
        title_pinyin="liu lang di qiu 2 the wandering earth ii",
        title_pinyin_initial="lldq2 the wandering earth ii",
    )
    monkeypatch.setattr(settings, "TMDB_LOCAL_DB_PATH", str(db_path))

    payload = await local_tmdb_service.search_by_media_type("流浪地球", "movie")
    initial_payload = await local_tmdb_service.search_by_media_type("lldq", "movie")

    assert payload["total_results"] == 2
    assert [item["tmdb_id"] for item in payload["items"][:2]] == [535167, 999999]
    assert initial_payload["items"][0]["tmdb_id"] == 535167


@pytest.mark.asyncio
async def test_local_tmdb_search_matches_compact_pinyin_and_cast(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.local_tmdb_service import local_tmdb_service

    db_path = tmp_path / "tmdb_base.db"
    _create_nextfind_tmdb_db(db_path)
    monkeypatch.setattr(settings, "TMDB_LOCAL_DB_PATH", str(db_path))

    pinyin_payload = await local_tmdb_service.search_by_media_type("liulangdiqiu", "movie")
    cast_payload = await local_tmdb_service.search_multi("吴京")

    assert pinyin_payload["items"][0]["tmdb_id"] == 535167
    assert 535167 in {item["tmdb_id"] for item in cast_payload["items"]}


@pytest.mark.asyncio
async def test_tmdb_service_prefers_local_search_when_available(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.tmdb_service import tmdb_service

    db_path = tmp_path / "tmdb_base.db"
    _create_nextfind_tmdb_db(db_path)
    monkeypatch.setattr(settings, "TMDB_LOCAL_DB_PATH", str(db_path))

    async def fail_get(*args, **kwargs):
        raise AssertionError("official TMDB API should not be called")

    monkeypatch.setattr(tmdb_service, "_get", fail_get)

    payload = await tmdb_service.search_by_media_type("breaking bad", "tv")
    assert payload["items"][0]["tmdb_id"] == 1396
    assert payload["search_service"] == "local_tmdb"


@pytest.mark.asyncio
async def test_tmdb_service_uses_local_detail_as_fallback(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.tmdb_service import tmdb_service

    db_path = tmp_path / "tmdb_base.db"
    _create_nextfind_tmdb_db(db_path)
    monkeypatch.setattr(settings, "TMDB_LOCAL_DB_PATH", str(db_path))
    monkeypatch.setattr(settings, "TMDB_API_KEY", None)

    payload = await tmdb_service.get_movie_detail(535167)

    assert payload["title"] == "流浪地球"
    assert payload["poster_path"] == "/poster.jpg"
    assert payload["credits"]["cast"][0]["name"] == "吴京"

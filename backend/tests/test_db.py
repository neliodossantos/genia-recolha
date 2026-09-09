import sqlite3

import pytest

from app.db import count_by_word, get_connection, init_db, insert_recording


@pytest.fixture
def conn():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    init_db(connection)
    yield connection
    connection.close()


def test_init_db_creates_recordings_table(conn):
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='recordings'"
    ).fetchall()
    assert len(tables) == 1


def test_get_connection_creates_file_db(tmp_path):
    db_path = tmp_path / "test.db"
    connection = get_connection(str(db_path))
    init_db(connection)
    assert db_path.exists()
    connection.close()


def test_insert_recording_returns_incrementing_id(conn):
    first_id = insert_recording(conn, "olá", "signer1", "v1.webm", "l1.json")
    second_id = insert_recording(conn, "obrigado", "signer1", "v2.webm", "l2.json")
    assert first_id == 1
    assert second_id == 2


def test_count_by_word_groups_by_word(conn):
    insert_recording(conn, "olá", "signer1", "v1.webm", "l1.json")
    insert_recording(conn, "olá", "signer1", "v2.webm", "l2.json")
    insert_recording(conn, "obrigado", "signer1", "v3.webm", "l3.json")
    assert count_by_word(conn) == {"olá": 2, "obrigado": 1}


def test_count_by_word_filters_by_signer(conn):
    insert_recording(conn, "olá", "signer1", "v1.webm", "l1.json")
    insert_recording(conn, "olá", "signer2", "v2.webm", "l2.json")
    assert count_by_word(conn, signer_id="signer1") == {"olá": 1}

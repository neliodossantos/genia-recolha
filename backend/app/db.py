import sqlite3
from datetime import datetime, timezone


def get_connection(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS recordings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            signer_id TEXT NOT NULL,
            video_path TEXT NOT NULL,
            landmarks_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def insert_recording(
    conn: sqlite3.Connection,
    word: str,
    signer_id: str,
    video_path: str,
    landmarks_path: str,
) -> int:
    created_at = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        """
        INSERT INTO recordings (word, signer_id, video_path, landmarks_path, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (word, signer_id, video_path, landmarks_path, created_at),
    )
    conn.commit()
    return cursor.lastrowid


def count_by_word(
    conn: sqlite3.Connection, signer_id: str | None = None
) -> dict[str, int]:
    if signer_id is not None:
        rows = conn.execute(
            "SELECT word, COUNT(*) as n FROM recordings WHERE signer_id = ? GROUP BY word",
            (signer_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT word, COUNT(*) as n FROM recordings GROUP BY word"
        ).fetchall()
    return {row["word"]: row["n"] for row in rows}

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS stories (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, input TEXT NOT NULL,
                    opening TEXT, opening_internal TEXT, created REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS progress (
                    session_id TEXT NOT NULL, story_id TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0,
                    playback TEXT, internal TEXT, job_id TEXT NOT NULL,
                    PRIMARY KEY(session_id, story_id)
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, story_id TEXT NOT NULL,
                    status TEXT NOT NULL, payload TEXT NOT NULL, error TEXT,
                    created REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS decisions (
                    session_id TEXT NOT NULL, story_id TEXT NOT NULL, request_id TEXT NOT NULL,
                    choice_id TEXT NOT NULL, expected_revision INTEGER NOT NULL, job_id TEXT NOT NULL,
                    PRIMARY KEY(session_id, story_id, request_id)
                );
                CREATE TABLE IF NOT EXISTS media (
                    scene_id TEXT NOT NULL, filename TEXT NOT NULL,
                    PRIMARY KEY(scene_id, filename)
                );
                CREATE TABLE IF NOT EXISTS limits (
                    kind TEXT NOT NULL, subject TEXT NOT NULL, created REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS limits_recent ON limits(kind, subject, created);
            ''')

    @contextmanager
    def connect(self, write: bool = False) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute(query, params).fetchone()
            return dict(row) if row else None

    def all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.connect() as db:
            return [dict(row) for row in db.execute(query, params).fetchall()]


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def decode(value: str | None, fallback: Any = None) -> Any:
    return json.loads(value) if value else fallback

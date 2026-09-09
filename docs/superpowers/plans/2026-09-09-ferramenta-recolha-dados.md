# Ferramenta de Recolha de Dados LGA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web tool that guides a signer through a target vocabulary, records each gesture (video + MediaPipe hand landmarks), and persists labeled examples for later model training.

**Architecture:** A FastAPI backend (SQLite for metadata, filesystem for video/landmark files) serves both a JSON API and the static frontend. A vanilla-JS frontend captures the webcam, runs MediaPipe's HandLandmarker in-browser, records a clip with MediaRecorder, and uploads the clip plus its landmark sequence to the backend on stop.

**Tech Stack:** Python 3.10+, FastAPI, Uvicorn, SQLite (stdlib `sqlite3`), pytest, httpx (via FastAPI `TestClient`), vanilla JavaScript (ES modules, no bundler), MediaPipe Tasks Vision (loaded from CDN), Node.js 18+ (built-in `node:test` runner for frontend unit tests only).

**Spec:** [docs/superpowers/specs/2026-09-08-lga-para-portugues-design.md](../specs/2026-09-08-lga-para-portugues-design.md) — this plan implements the "Recolha de dados" and supporting parts of the "Componentes" sections. Model training, the inference backend, and the recognition client are out of scope for this plan (see spec's "Próximos passos").

## Global Constraints

- Every recording stores the raw video and the extracted landmarks as separate files (spec: "Guardar o vídeo bruto ... e os landmarks já extraídos").
- Every recording is tagged with the word label and signer id (spec: "Anotar cada exemplo com o rótulo da palavra e metadados").
- Target vocabulary is ~50-100 everyday words/phrases, community-defined (spec) — this plan ships a small starter list as a placeholder for the real list, not as a plan placeholder.
- This is a web app; no native mobile app (spec: out of scope).
- No text-to-speech output in this tool (spec: out of scope for the whole MVP, and irrelevant to data collection).

---

## File Structure

```
backend/
  requirements.txt
  run.py
  app/
    __init__.py
    db.py            - SQLite schema + CRUD for recordings metadata
    vocabulary.py     - Loads the target word list from JSON
    storage.py        - Saves video + landmarks files to disk
    main.py            - FastAPI app: API routes + static frontend serving
    vocabulary.json    - Starter vocabulary (replace with community list)
  tests/
    test_db.py
    test_vocabulary.py
    test_storage.py
    test_api.py

frontend/
  index.html
  style.css
  js/
    landmarks.js      - Pure functions: accumulate/serialize landmark frames
    progress.js         - Pure functions: pick next word from progress
    main.js              - Wires camera, MediaPipe, recording, upload
  tests/
    landmarks.test.js
    progress.test.js

.gitignore
```

---

### Task 1: Backend scaffold + persistence layer

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/db.py`
- Create: `backend/tests/test_db.py`
- Create: `.gitignore`

**Interfaces:**
- Produces: `get_connection(db_path: str) -> sqlite3.Connection`, `init_db(conn: sqlite3.Connection) -> None`, `insert_recording(conn, word: str, signer_id: str, video_path: str, landmarks_path: str) -> int`, `count_by_word(conn, signer_id: str | None = None) -> dict[str, int]`

- [ ] **Step 1: Create the project scaffold**

```bash
mkdir -p backend/app backend/tests frontend/js frontend/tests
touch backend/app/__init__.py
```

`backend/requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.32.0
python-multipart==0.0.12
pytest==8.3.3
httpx==0.27.2
```

`.gitignore`:
```
backend/venv/
backend/__pycache__/
backend/**/__pycache__/
backend/.pytest_cache/
data/
```

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 2: Write the failing tests for the persistence layer**

`backend/tests/test_db.py`:
```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db'` (or `ImportError`)

- [ ] **Step 4: Implement the persistence layer**

`backend/app/db.py`:
```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_db.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/__init__.py backend/app/db.py backend/tests/test_db.py .gitignore
git commit -m "feat: add SQLite persistence layer for recordings metadata"
```

---

### Task 2: Vocabulary loader

**Files:**
- Create: `backend/app/vocabulary.py`
- Create: `backend/app/vocabulary.json`
- Create: `backend/tests/test_vocabulary.py`

**Interfaces:**
- Produces: `load_vocabulary(path: str) -> list[str]`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_vocabulary.py`:
```python
import json

import pytest

from app.vocabulary import load_vocabulary


def test_load_vocabulary_reads_word_list(tmp_path):
    vocab_file = tmp_path / "vocab.json"
    vocab_file.write_text(json.dumps(["olá", "obrigado"]), encoding="utf-8")
    assert load_vocabulary(str(vocab_file)) == ["olá", "obrigado"]


def test_load_vocabulary_rejects_non_list(tmp_path):
    vocab_file = tmp_path / "vocab.json"
    vocab_file.write_text(json.dumps({"not": "a list"}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_vocabulary(str(vocab_file))


def test_load_vocabulary_rejects_non_string_items(tmp_path):
    vocab_file = tmp_path / "vocab.json"
    vocab_file.write_text(json.dumps(["olá", 123]), encoding="utf-8")
    with pytest.raises(ValueError):
        load_vocabulary(str(vocab_file))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_vocabulary.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.vocabulary'`

- [ ] **Step 3: Implement the vocabulary loader and starter list**

`backend/app/vocabulary.py`:
```python
import json


def load_vocabulary(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        words = json.load(f)
    if not isinstance(words, list) or not all(isinstance(w, str) for w in words):
        raise ValueError("vocabulary file must contain a JSON array of strings")
    return words
```

`backend/app/vocabulary.json` (starter list — replace with the list defined together with the LGA community):
```json
[
  "olá",
  "obrigado",
  "por favor",
  "sim",
  "não",
  "água",
  "comida",
  "ajuda",
  "casa",
  "bom dia",
  "boa noite",
  "desculpa",
  "1",
  "2",
  "3",
  "4",
  "5"
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_vocabulary.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/vocabulary.py backend/app/vocabulary.json backend/tests/test_vocabulary.py
git commit -m "feat: add vocabulary loader and starter word list"
```

---

### Task 3: Recording file storage

**Files:**
- Create: `backend/app/storage.py`
- Create: `backend/tests/test_storage.py`

**Interfaces:**
- Produces: `save_recording_files(base_dir: str, word: str, signer_id: str, video_bytes: bytes, landmarks: list) -> tuple[str, str]` (returns `(video_path, landmarks_path)`)

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_storage.py`:
```python
import json
from pathlib import Path

from app.storage import save_recording_files


def test_save_recording_files_writes_video_and_landmarks(tmp_path):
    video_path, landmarks_path = save_recording_files(
        str(tmp_path), "olá", "signer1", b"fake-video-bytes", [{"t": 0, "hands": []}]
    )
    assert Path(video_path).read_bytes() == b"fake-video-bytes"
    assert json.loads(Path(landmarks_path).read_text()) == [{"t": 0, "hands": []}]


def test_save_recording_files_sanitizes_word_with_spaces(tmp_path):
    video_path, _ = save_recording_files(str(tmp_path), "por favor", "signer1", b"x", [])
    assert " " not in Path(video_path).name
    assert "por_favor" in video_path


def test_save_recording_files_creates_unique_paths_for_same_word(tmp_path):
    video_path1, _ = save_recording_files(str(tmp_path), "olá", "signer1", b"x", [])
    video_path2, _ = save_recording_files(str(tmp_path), "olá", "signer1", b"x", [])
    assert video_path1 != video_path2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_storage.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.storage'`

- [ ] **Step 3: Implement storage**

`backend/app/storage.py`:
```python
import json
import uuid
from pathlib import Path


def save_recording_files(
    base_dir: str,
    word: str,
    signer_id: str,
    video_bytes: bytes,
    landmarks: list,
) -> tuple[str, str]:
    recordings_dir = Path(base_dir)
    videos_dir = recordings_dir / "videos"
    landmarks_dir = recordings_dir / "landmarks"
    videos_dir.mkdir(parents=True, exist_ok=True)
    landmarks_dir.mkdir(parents=True, exist_ok=True)

    safe_word = word.replace(" ", "_")
    recording_id = uuid.uuid4().hex
    filename_stem = f"{safe_word}__{signer_id}__{recording_id}"

    video_path = videos_dir / f"{filename_stem}.webm"
    landmarks_path = landmarks_dir / f"{filename_stem}.json"

    video_path.write_bytes(video_bytes)
    landmarks_path.write_text(json.dumps(landmarks), encoding="utf-8")

    return str(video_path), str(landmarks_path)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_storage.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/storage.py backend/tests/test_storage.py
git commit -m "feat: add recording file storage helper"
```

---

### Task 4: FastAPI application (API + static frontend serving)

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/run.py`
- Create: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `get_connection`, `init_db`, `insert_recording`, `count_by_word` from `app.db` (Task 1); `load_vocabulary` from `app.vocabulary` (Task 2); `save_recording_files` from `app.storage` (Task 3)
- Produces: `create_app(db_path: str, storage_dir: str, vocabulary_path: str, frontend_dir: str) -> FastAPI`; HTTP API:
  - `GET /api/vocabulary` → `list[str]`
  - `GET /api/progress?signer_id=<id>` (optional) → `dict[str, int]`
  - `POST /api/recordings` (multipart form: `word`, `signer_id`, `landmarks` as a JSON string, `video` as a file) → `{"id": int, "word": str, "signer_id": str}`
  - `GET /` and other static paths → serves `frontend_dir` (built in Task 7)

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_api.py`:
```python
import json

from fastapi.testclient import TestClient

from app.main import create_app


def make_client(tmp_path, vocabulary=None):
    vocab_path = tmp_path / "vocab.json"
    vocab_path.write_text(json.dumps(vocabulary or ["olá", "obrigado"]), encoding="utf-8")
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    (frontend_dir / "index.html").write_text("<!DOCTYPE html>", encoding="utf-8")
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        storage_dir=str(tmp_path / "recordings"),
        vocabulary_path=str(vocab_path),
        frontend_dir=str(frontend_dir),
    )
    return TestClient(app)


def test_get_vocabulary_returns_word_list(tmp_path):
    client = make_client(tmp_path)
    response = client.get("/api/vocabulary")
    assert response.status_code == 200
    assert response.json() == ["olá", "obrigado"]


def test_post_recording_saves_files_and_returns_id(tmp_path):
    client = make_client(tmp_path)
    response = client.post(
        "/api/recordings",
        data={
            "word": "olá",
            "signer_id": "signer1",
            "landmarks": json.dumps([{"t": 0, "hands": []}]),
        },
        files={"video": ("clip.webm", b"fake-bytes", "video/webm")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["word"] == "olá"
    assert body["signer_id"] == "signer1"
    assert "id" in body


def test_post_recording_rejects_invalid_landmarks_json(tmp_path):
    client = make_client(tmp_path)
    response = client.post(
        "/api/recordings",
        data={"word": "olá", "signer_id": "signer1", "landmarks": "not-json"},
        files={"video": ("clip.webm", b"fake-bytes", "video/webm")},
    )
    assert response.status_code == 400


def test_get_progress_counts_recordings_per_word(tmp_path):
    client = make_client(tmp_path)
    for _ in range(2):
        client.post(
            "/api/recordings",
            data={"word": "olá", "signer_id": "signer1", "landmarks": "[]"},
            files={"video": ("clip.webm", b"x", "video/webm")},
        )
    response = client.get("/api/progress", params={"signer_id": "signer1"})
    assert response.json() == {"olá": 2}


def test_serves_frontend_index_at_root(tmp_path):
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir()
    (frontend_dir / "index.html").write_text(
        "<!DOCTYPE html><title>Recolha LGA</title>", encoding="utf-8"
    )
    vocab_path = tmp_path / "vocab.json"
    vocab_path.write_text("[]", encoding="utf-8")
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        storage_dir=str(tmp_path / "recordings"),
        vocabulary_path=str(vocab_path),
        frontend_dir=str(frontend_dir),
    )
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "Recolha LGA" in response.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement the FastAPI app**

`backend/app/main.py`:
```python
import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from app.db import count_by_word, get_connection, init_db, insert_recording
from app.storage import save_recording_files
from app.vocabulary import load_vocabulary


def create_app(
    db_path: str, storage_dir: str, vocabulary_path: str, frontend_dir: str
) -> FastAPI:
    app = FastAPI()

    conn = get_connection(db_path)
    init_db(conn)

    @app.get("/api/vocabulary")
    def get_vocabulary():
        return load_vocabulary(vocabulary_path)

    @app.get("/api/progress")
    def get_progress(signer_id: str | None = None):
        return count_by_word(conn, signer_id=signer_id)

    @app.post("/api/recordings")
    async def create_recording(
        word: str = Form(...),
        signer_id: str = Form(...),
        landmarks: str = Form(...),
        video: UploadFile = File(...),
    ):
        try:
            parsed_landmarks = json.loads(landmarks)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400, detail="landmarks must be valid JSON"
            ) from exc

        video_bytes = await video.read()
        video_path, landmarks_path = save_recording_files(
            storage_dir, word, signer_id, video_bytes, parsed_landmarks
        )
        recording_id = insert_recording(
            conn, word, signer_id, video_path, landmarks_path
        )
        return {"id": recording_id, "word": word, "signer_id": signer_id}

    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

    return app
```

`backend/run.py`:
```python
import os

import uvicorn

from app.main import create_app

app = create_app(
    db_path=os.environ.get("LGA_DB_PATH", "data/recordings.db"),
    storage_dir=os.environ.get("LGA_STORAGE_DIR", "data"),
    vocabulary_path=os.environ.get("LGA_VOCAB_PATH", "app/vocabulary.json"),
    frontend_dir=os.environ.get("LGA_FRONTEND_DIR", "../frontend"),
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_api.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/run.py backend/tests/test_api.py
git commit -m "feat: add FastAPI app wiring recordings API and static frontend"
```

---

### Task 5: Frontend landmark buffer module

**Files:**
- Create: `frontend/js/landmarks.js`
- Create: `frontend/tests/landmarks.test.js`

**Interfaces:**
- Produces: `createLandmarkBuffer()`, `addFrame(buffer, timestampMs, handLandmarksResult)`, `resetBuffer(buffer)`, `serializeBuffer(buffer)`

- [ ] **Step 1: Write the failing tests**

`frontend/tests/landmarks.test.js`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLandmarkBuffer,
  addFrame,
  resetBuffer,
  serializeBuffer,
} from "../js/landmarks.js";

test("createLandmarkBuffer starts empty", () => {
  const buffer = createLandmarkBuffer();
  assert.deepEqual(buffer.frames, []);
});

test("addFrame appends a frame with timestamp and hand points", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 100, [[{ x: 0.1, y: 0.2, z: 0.3 }]]);
  assert.equal(buffer.frames.length, 1);
  assert.equal(buffer.frames[0].t, 100);
  assert.deepEqual(buffer.frames[0].hands, [[{ x: 0.1, y: 0.2, z: 0.3 }]]);
});

test("addFrame records an empty hands array when no hand is detected", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 200, []);
  assert.deepEqual(buffer.frames[0].hands, []);
});

test("addFrame treats a null result as no hand detected", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 300, null);
  assert.deepEqual(buffer.frames[0].hands, []);
});

test("resetBuffer clears accumulated frames", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 100, []);
  resetBuffer(buffer);
  assert.deepEqual(buffer.frames, []);
});

test("serializeBuffer returns a JSON string of the frames", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 100, [[{ x: 1, y: 2, z: 3 }]]);
  const parsed = JSON.parse(serializeBuffer(buffer));
  assert.deepEqual(parsed, [{ t: 100, hands: [[{ x: 1, y: 2, z: 3 }]] }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test frontend/tests/landmarks.test.js`
Expected: FAIL with a module-not-found error for `../js/landmarks.js`

- [ ] **Step 3: Implement the landmark buffer module**

`frontend/js/landmarks.js`:
```javascript
export function createLandmarkBuffer() {
  return { frames: [] };
}

export function addFrame(buffer, timestampMs, handLandmarksResult) {
  const hands = (handLandmarksResult || []).map((hand) =>
    hand.map((point) => ({ x: point.x, y: point.y, z: point.z }))
  );
  buffer.frames.push({ t: timestampMs, hands });
  return buffer;
}

export function resetBuffer(buffer) {
  buffer.frames = [];
  return buffer;
}

export function serializeBuffer(buffer) {
  return JSON.stringify(buffer.frames);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test frontend/tests/landmarks.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/js/landmarks.js frontend/tests/landmarks.test.js
git commit -m "feat: add frontend landmark buffer module"
```

---

### Task 6: Frontend progress module

**Files:**
- Create: `frontend/js/progress.js`
- Create: `frontend/tests/progress.test.js`

**Interfaces:**
- Produces: `pickNextWord(vocabulary: string[], counts: Record<string, number>, targetPerWord: number) -> string | null` (returns `null` once every word has reached the target — this is how the UI detects completion, so no separate "is complete" check is needed)

- [ ] **Step 1: Write the failing tests**

`frontend/tests/progress.test.js`:
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNextWord } from "../js/progress.js";

test("pickNextWord returns the first word with zero recordings", () => {
  assert.equal(pickNextWord(["olá", "obrigado"], {}, 20), "olá");
});

test("pickNextWord prioritizes the word with the fewest recordings", () => {
  const word = pickNextWord(["olá", "obrigado"], { "olá": 10, obrigado: 3 }, 20);
  assert.equal(word, "obrigado");
});

test("pickNextWord skips words that already reached the target", () => {
  const word = pickNextWord(["olá", "obrigado"], { "olá": 20 }, 20);
  assert.equal(word, "obrigado");
});

test("pickNextWord returns null when all words reached the target", () => {
  assert.equal(pickNextWord(["olá"], { "olá": 20 }, 20), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test frontend/tests/progress.test.js`
Expected: FAIL with a module-not-found error for `../js/progress.js`

- [ ] **Step 3: Implement the progress module**

`frontend/js/progress.js`:
```javascript
export function pickNextWord(vocabulary, counts, targetPerWord) {
  let nextWord = null;
  let lowestCount = Infinity;
  for (const word of vocabulary) {
    const count = counts[word] || 0;
    if (count < targetPerWord && count < lowestCount) {
      lowestCount = count;
      nextWord = word;
    }
  }
  return nextWord;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test frontend/tests/progress.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/js/progress.js frontend/tests/progress.test.js
git commit -m "feat: add frontend progress/next-word module"
```

---

### Task 7: Recording UI + end-to-end verification

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/style.css`
- Create: `frontend/js/main.js`

**Interfaces:**
- Consumes: `createLandmarkBuffer`, `addFrame`, `resetBuffer`, `serializeBuffer` from `./landmarks.js` (Task 5); `pickNextWord`, `isComplete` from `./progress.js` (Task 6); `GET /api/vocabulary`, `GET /api/progress`, `POST /api/recordings` from the backend (Task 4)

This task's deliverable depends on real camera hardware and a real MediaPipe model download, which cannot be exercised by an automated test. Its test cycle is the manual verification procedure in Step 4.

- [ ] **Step 1: Write the HTML shell**

`frontend/index.html`:
```html
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <title>Recolha de Gestos LGA</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <section id="signer-setup">
      <label for="signer-id">O teu identificador (ex: o teu nome):</label>
      <input type="text" id="signer-id" />
      <button id="start-session">Começar</button>
    </section>

    <section id="recording-session" hidden>
      <h1 id="current-word"></h1>
      <p id="progress-label"></p>
      <div class="video-wrap">
        <video id="camera-preview" autoplay muted playsinline></video>
        <canvas id="landmark-overlay"></canvas>
      </div>
      <button id="record-button">Gravar</button>
      <button id="next-word-button">Próxima palavra</button>
      <p id="status-message"></p>
    </section>
  </main>
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the styles**

`frontend/style.css`:
```css
body {
  font-family: system-ui, sans-serif;
  max-width: 640px;
  margin: 2rem auto;
  padding: 0 1rem;
}

.video-wrap {
  position: relative;
  width: 100%;
}

#camera-preview,
#landmark-overlay {
  width: 100%;
  border-radius: 8px;
}

#landmark-overlay {
  position: absolute;
  top: 0;
  left: 0;
}

button {
  font-size: 1rem;
  padding: 0.5rem 1rem;
  margin-right: 0.5rem;
}
```

- [ ] **Step 3: Wire the camera, MediaPipe, recording, and upload logic**

`frontend/js/main.js`:
```javascript
import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import {
  createLandmarkBuffer,
  addFrame,
  resetBuffer,
  serializeBuffer,
} from "./landmarks.js";
import { pickNextWord } from "./progress.js";

const TARGET_PER_WORD = 20;

const signerSetup = document.getElementById("signer-setup");
const signerIdInput = document.getElementById("signer-id");
const startSessionButton = document.getElementById("start-session");

const recordingSession = document.getElementById("recording-session");
const currentWordEl = document.getElementById("current-word");
const progressLabelEl = document.getElementById("progress-label");
const videoEl = document.getElementById("camera-preview");
const overlayEl = document.getElementById("landmark-overlay");
const recordButton = document.getElementById("record-button");
const nextWordButton = document.getElementById("next-word-button");
const statusEl = document.getElementById("status-message");

let signerId = "";
let vocabulary = [];
let counts = {};
let currentWord = null;
let handLandmarker = null;
let mediaRecorder = null;
let recordedChunks = [];
let landmarkBuffer = createLandmarkBuffer();

async function loadHandLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

async function fetchVocabulary() {
  const response = await fetch("/api/vocabulary");
  return response.json();
}

async function fetchProgress(forSignerId) {
  const response = await fetch(
    `/api/progress?signer_id=${encodeURIComponent(forSignerId)}`
  );
  return response.json();
}

function updateWordDisplay() {
  currentWord = pickNextWord(vocabulary, counts, TARGET_PER_WORD);
  if (currentWord === null) {
    currentWordEl.textContent = "Concluído!";
    progressLabelEl.textContent = `Todas as ${vocabulary.length} palavras atingiram ${TARGET_PER_WORD} gravações.`;
    recordButton.disabled = true;
    return;
  }
  currentWordEl.textContent = currentWord;
  const count = counts[currentWord] || 0;
  progressLabelEl.textContent = `${count}/${TARGET_PER_WORD} gravações`;
  recordButton.disabled = false;
}

function detectionLoop() {
  if (!handLandmarker || videoEl.readyState < 2) {
    requestAnimationFrame(detectionLoop);
    return;
  }
  const timestampMs = performance.now();
  const result = handLandmarker.detectForVideo(videoEl, timestampMs);

  const ctx = overlayEl.getContext("2d");
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  for (const hand of result.landmarks) {
    for (const point of hand) {
      ctx.beginPath();
      ctx.arc(
        point.x * overlayEl.width,
        point.y * overlayEl.height,
        3,
        0,
        2 * Math.PI
      );
      ctx.fillStyle = "#00ff88";
      ctx.fill();
    }
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    addFrame(landmarkBuffer, timestampMs, result.landmarks);
  }

  requestAnimationFrame(detectionLoop);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = resolve;
  });
  overlayEl.width = videoEl.videoWidth;
  overlayEl.height = videoEl.videoHeight;
  return stream;
}

async function uploadRecording(word, videoBlob) {
  const formData = new FormData();
  formData.append("word", word);
  formData.append("signer_id", signerId);
  formData.append("landmarks", serializeBuffer(landmarkBuffer));
  formData.append("video", videoBlob, "clip.webm");

  const response = await fetch("/api/recordings", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status}`);
  }
  return response.json();
}

function startRecording(stream) {
  recordedChunks = [];
  resetBuffer(landmarkBuffer);
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.start();
}

function stopRecording() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      resolve(new Blob(recordedChunks, { type: "video/webm" }));
    };
    mediaRecorder.stop();
  });
}

async function onRecordButtonClick() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    recordButton.textContent = "Gravar";
    statusEl.textContent = "A enviar...";
    const videoBlob = await stopRecording();
    try {
      await uploadRecording(currentWord, videoBlob);
      counts[currentWord] = (counts[currentWord] || 0) + 1;
      statusEl.textContent = "Gravação guardada.";
      updateWordDisplay();
    } catch (error) {
      statusEl.textContent = `Erro ao enviar: ${error.message}`;
    }
    return;
  }

  recordButton.textContent = "Parar";
  statusEl.textContent = "A gravar...";
  startRecording(videoEl.srcObject);
}

async function startSession() {
  signerId = signerIdInput.value.trim();
  if (!signerId) {
    alert("Indica um identificador antes de começar.");
    return;
  }

  signerSetup.hidden = true;
  recordingSession.hidden = false;
  statusEl.textContent = "A carregar o modelo de deteção de mãos...";

  [vocabulary, counts, handLandmarker] = await Promise.all([
    fetchVocabulary(),
    fetchProgress(signerId),
    loadHandLandmarker(),
  ]);

  await startCamera();
  statusEl.textContent = "";
  updateWordDisplay();
  detectionLoop();
}

startSessionButton.addEventListener("click", startSession);
recordButton.addEventListener("click", onRecordButtonClick);
nextWordButton.addEventListener("click", updateWordDisplay);
```

- [ ] **Step 4: Manual end-to-end verification**

```bash
cd backend
source venv/bin/activate
python run.py
```

Then, with the server running on `http://localhost:8000`:

1. Open `http://localhost:8000` in Chrome or Firefox.
2. Enter a signer id and click "Começar". Grant camera permission when prompted.
3. Confirm the video preview shows your camera feed and green dots track your hand when you raise it in frame.
4. Confirm the current word and a "0/20 gravações" label are shown.
5. Click "Gravar", sign the displayed word for ~2 seconds, click the button again (now labeled "Parar") to stop.
6. Confirm the status message shows "Gravação guardada." and the progress label increments to "1/20 gravações".
7. In a second terminal, confirm the files were written:
   ```bash
   ls backend/data/videos
   ls backend/data/landmarks
   sqlite3 backend/data/recordings.db "SELECT word, signer_id, video_path, landmarks_path FROM recordings;"
   ```
   Expected: one row matching the word you signed, and matching video/landmark files on disk.
8. Reload the page and start a new session with the same signer id — confirm the progress count for that word now starts at 1 instead of 0 (proves `/api/progress` reflects prior recordings).

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/style.css frontend/js/main.js
git commit -m "feat: add recording UI wiring camera, MediaPipe, and upload"
```

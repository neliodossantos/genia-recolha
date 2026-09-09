# Ferramenta de Recolha de Dados — LGA

A web tool for collecting a video + hand-landmark dataset of Angolan Sign
Language (LGA — Língua Gestual Angolana) gestures. Signers use a browser to
record short clips of themselves signing words from a fixed vocabulary; the
backend stores the video, MediaPipe hand-landmark data, and per-word progress
counts. This is the data-collection step for the first of two planned
sub-projects (LGA → Portuguese recognition); see the design spec at
`docs/superpowers/specs/2026-09-08-lga-para-portugues-design.md`.

## Backend setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Running tests

```bash
cd backend && pytest -v      # backend
cd frontend && npm test      # frontend
```

## Running the server

```bash
cd backend
python run.py
```

The working directory **must** be `backend/` — `run.py`'s default paths
(`data/recordings.db`, `app/vocabulary.json`, `../frontend`) are all relative
to it. Override any of them with environment variables instead of changing
directory:

- `LGA_DB_PATH` — path to the SQLite database file
- `LGA_STORAGE_DIR` — directory where videos/landmarks are written
- `LGA_VOCAB_PATH` — path to the vocabulary JSON file
- `LGA_FRONTEND_DIR` — path to the static frontend to serve

## Where data lands

- `backend/data/recordings.db` — SQLite metadata (words, signer IDs, file paths)
- `backend/data/videos/` — recorded `.webm` clips
- `backend/data/landmarks/` — serialized MediaPipe hand-landmark JSON per clip

`backend/data/` is gitignored and should be backed up separately — it holds
the actual dataset, including video of real people.

## Replacing the starter vocabulary

Edit `backend/app/vocabulary.json` — a JSON array of strings — with the
community-defined word list.

## Known limitation

The server binds `0.0.0.0` so other devices on the same network can reach it,
but browsers only expose the camera API (`getUserMedia`) on secure contexts:
`localhost` works, but another device connecting via `http://<ip>:8000` will
**not** get camera access. Real multi-signer sessions from separate devices
need HTTPS (e.g. a local certificate via `mkcert`, or an SSH tunnel) — not
set up yet.

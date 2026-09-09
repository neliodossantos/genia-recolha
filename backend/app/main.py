import json
import re
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from app.db import count_by_word, get_connection, init_db, insert_recording
from app.storage import save_recording_files
from app.vocabulary import load_vocabulary


def create_app(
    db_path: str, storage_dir: str, vocabulary_path: str, frontend_dir: str
) -> FastAPI:
    app = FastAPI()

    # Create the schema once at startup, then close this connection. Each
    # request below opens its own connection instead of sharing one across
    # threads: FastAPI runs sync path operations in a threadpool, and a
    # single sqlite3.Connection (default check_same_thread=True) cannot be
    # reused from a different thread than the one that created it.
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    init_conn = get_connection(db_path)
    init_db(init_conn)
    init_conn.close()

    @app.get("/api/vocabulary")
    def get_vocabulary():
        return load_vocabulary(vocabulary_path)

    @app.get("/api/progress")
    def get_progress(signer_id: str | None = None):
        conn = get_connection(db_path)
        try:
            return count_by_word(conn, signer_id=signer_id)
        finally:
            conn.close()

    @app.post("/api/recordings")
    async def create_recording(
        word: str = Form(...),
        signer_id: str = Form(...),
        landmarks: str = Form(...),
        video: UploadFile = File(...),
    ):
        if word not in load_vocabulary(vocabulary_path):
            raise HTTPException(status_code=400, detail="unknown word")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", signer_id):
            raise HTTPException(status_code=400, detail="invalid signer_id")

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
        conn = get_connection(db_path)
        try:
            recording_id = insert_recording(
                conn, word, signer_id, video_path, landmarks_path
            )
        finally:
            conn.close()
        return {"id": recording_id, "word": word, "signer_id": signer_id}

    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

    return app

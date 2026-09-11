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


def test_post_recording_rejects_word_not_in_vocabulary(tmp_path):
    client = make_client(tmp_path)
    response = client.post(
        "/api/recordings",
        data={
            "word": "../evil",
            "signer_id": "signer1",
            "landmarks": json.dumps([{"t": 0, "hands": []}]),
        },
        files={"video": ("clip.webm", b"fake-bytes", "video/webm")},
    )
    assert response.status_code == 400


def test_post_recording_rejects_signer_id_with_path_separator(tmp_path):
    client = make_client(tmp_path)
    response = client.post(
        "/api/recordings",
        data={
            "word": "olá",
            "signer_id": "../evil",
            "landmarks": json.dumps([{"t": 0, "hands": []}]),
        },
        files={"video": ("clip.webm", b"fake-bytes", "video/webm")},
    )
    assert response.status_code == 400

    response = client.post(
        "/api/recordings",
        data={
            "word": "olá",
            "signer_id": "a/b",
            "landmarks": json.dumps([{"t": 0, "hands": []}]),
        },
        files={"video": ("clip.webm", b"fake-bytes", "video/webm")},
    )
    assert response.status_code == 400


def test_post_recording_accepts_signer_id_with_accents_and_spaces(tmp_path):
    client = make_client(tmp_path)
    response = client.post(
        "/api/recordings",
        data={
            "word": "olá",
            "signer_id": "Nélio Santos",
            "landmarks": json.dumps([{"t": 0, "hands": []}]),
        },
        files={"video": ("clip.webm", b"fake-bytes", "video/webm")},
    )
    assert response.status_code == 200
    assert response.json()["signer_id"] == "Nélio Santos"


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

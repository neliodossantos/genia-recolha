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


def test_save_recording_files_sanitizes_signer_id_with_spaces(tmp_path):
    video_path, _ = save_recording_files(str(tmp_path), "olá", "Nélio Santos", b"x", [])
    assert " " not in Path(video_path).name
    assert "Nélio_Santos" in video_path


def test_save_recording_files_creates_unique_paths_for_same_word(tmp_path):
    video_path1, _ = save_recording_files(str(tmp_path), "olá", "signer1", b"x", [])
    video_path2, _ = save_recording_files(str(tmp_path), "olá", "signer1", b"x", [])
    assert video_path1 != video_path2

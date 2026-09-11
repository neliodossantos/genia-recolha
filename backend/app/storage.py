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
    safe_signer_id = signer_id.replace(" ", "_")
    recording_id = uuid.uuid4().hex
    filename_stem = f"{safe_word}__{safe_signer_id}__{recording_id}"

    video_path = videos_dir / f"{filename_stem}.webm"
    landmarks_path = landmarks_dir / f"{filename_stem}.json"

    video_path.write_bytes(video_bytes)
    landmarks_path.write_text(json.dumps(landmarks), encoding="utf-8")

    return str(video_path), str(landmarks_path)

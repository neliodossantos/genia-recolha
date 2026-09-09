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

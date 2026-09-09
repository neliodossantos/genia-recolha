import json


def load_vocabulary(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        words = json.load(f)
    if not isinstance(words, list) or not all(isinstance(w, str) for w in words):
        raise ValueError("vocabulary file must contain a JSON array of strings")
    return words

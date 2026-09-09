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

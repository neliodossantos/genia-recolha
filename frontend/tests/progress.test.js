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

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

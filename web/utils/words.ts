export interface VocabWord {
  id: number
  word: string
  position: number
}

export function pickNextWord(
  words: VocabWord[],
  counts: Record<number, number>,
  target: number,
  skipped: ReadonlySet<number>,
): VocabWord | null {
  const ordered = [...words].sort((a, b) => a.position - b.position)
  const below = ordered.filter((w) => (counts[w.id] ?? 0) < target)
  const notSkipped = below.filter((w) => !skipped.has(w.id))
  const candidates = notSkipped.length > 0 ? notSkipped : below

  let best: VocabWord | null = null
  for (const w of candidates) {
    if (best === null || (counts[w.id] ?? 0) < (counts[best.id] ?? 0)) {
      best = w
    }
  }
  return best
}

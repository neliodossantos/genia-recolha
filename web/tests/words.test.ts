import { describe, expect, it } from 'vitest'
import { pickNextWord, type VocabWord } from '../utils/words'

const words: VocabWord[] = [
  { id: 1, word: 'olá', position: 1 },
  { id: 2, word: 'obrigado', position: 2 },
  { id: 3, word: 'sim', position: 3 },
]
const none = new Set<number>()

describe('pickNextWord', () => {
  it('returns the first word when nothing was recorded', () => {
    expect(pickNextWord(words, {}, 20, none)?.id).toBe(1)
  })
  it('prefers the word with the fewest recordings', () => {
    expect(pickNextWord(words, { 1: 10, 2: 3, 3: 8 }, 20, none)?.id).toBe(2)
  })
  it('skips words in the skipped set', () => {
    expect(pickNextWord(words, {}, 20, new Set([1]))?.id).toBe(2)
  })
  it('falls back to skipped words when every remaining word was skipped', () => {
    expect(pickNextWord(words, { 1: 20 }, 20, new Set([2, 3]))?.id).toBe(2)
  })
  it('never returns words that reached the target', () => {
    expect(pickNextWord(words, { 1: 20, 2: 20 }, 20, new Set([3]))?.id).toBe(3)
  })
  it('returns null when every word reached the target', () => {
    expect(pickNextWord(words, { 1: 20, 2: 20, 3: 20 }, 20, none)).toBeNull()
  })
})

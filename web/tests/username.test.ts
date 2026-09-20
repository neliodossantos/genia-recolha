import { describe, expect, it } from 'vitest'
import { isValidUsername, toAuthEmail, toUsernameSlug } from '../utils/username'

describe('toUsernameSlug', () => {
  it('strips accents and replaces spaces', () => {
    expect(toUsernameSlug('Nélio Santos')).toBe('nelio_santos')
  })
  it('trims and removes punctuation', () => {
    expect(toUsernameSlug('  Ana!! ')).toBe('ana')
  })
  it('collapses repeated separators', () => {
    expect(toUsernameSlug('a - - b')).toBe('a_b')
  })
  it('returns an empty string for only symbols', () => {
    expect(toUsernameSlug('!!!')).toBe('')
  })
})

describe('isValidUsername', () => {
  it('requires 3 to 32 characters', () => {
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('a'.repeat(33))).toBe(false)
  })
})

describe('toAuthEmail', () => {
  it('builds a synthetic email from the slug', () => {
    expect(toAuthEmail('Nélio Santos', 'lga.local')).toBe('nelio_santos@lga.local')
  })
})

import { describe, expect, it } from 'vitest'
import { averageLuma, handStatus, isTooDark, noHandsHint } from '../utils/guidance'

describe('handStatus', () => {
  it('reports no hands as a warning', () => {
    expect(handStatus(0)).toEqual({ label: 'Sem mãos', tone: 'warn' })
  })
  it('reports one hand as good', () => {
    expect(handStatus(1)).toEqual({ label: '1 mão detetada', tone: 'good' })
  })
  it('reports two hands as good', () => {
    expect(handStatus(2)).toEqual({ label: '2 mãos detetadas', tone: 'good' })
  })
})

describe('noHandsHint', () => {
  it('gives no hint before the threshold', () => {
    expect(noHandsHint(1000)).toBeNull()
  })
  it('gives a hint once hands were missing for at least 1.5 s', () => {
    expect(noHandsHint(1500)).toContain('Não vejo as tuas mãos')
  })
  it('gives no hint when the hands are visible (no missing time)', () => {
    expect(noHandsHint(0)).toBeNull()
  })
})

describe('averageLuma', () => {
  it('is 0 for black pixels and 255 for white pixels', () => {
    expect(averageLuma([0, 0, 0, 255, 0, 0, 0, 255])).toBe(0)
    expect(averageLuma([255, 255, 255, 255])).toBeCloseTo(255, 5)
  })
  it('weights green more than red and blue', () => {
    const red = averageLuma([255, 0, 0, 255])
    const green = averageLuma([0, 255, 0, 255])
    const blue = averageLuma([0, 0, 255, 255])
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
  it('averages across pixels and ignores alpha', () => {
    expect(averageLuma([255, 255, 255, 0, 0, 0, 0, 0])).toBeCloseTo(127.5, 5)
  })
  it('returns 0 for empty data', () => {
    expect(averageLuma([])).toBe(0)
  })
})

describe('isTooDark', () => {
  it('flags a low average brightness', () => {
    expect(isTooDark(40)).toBe(true)
  })
  it('accepts a normal brightness', () => {
    expect(isTooDark(120)).toBe(false)
  })
})

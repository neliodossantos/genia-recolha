import { describe, expect, it } from 'vitest'
import { toCsv } from '../utils/csv'

describe('toCsv', () => {
  it('writes a header and one line per row', () => {
    const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }], ['a', 'b'])
    expect(csv).toBe('a,b\n1,x\n2,y')
  })

  it('quotes values with commas, quotes and newlines', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"' }], ['a', 'b'])
    expect(csv).toBe('a,b\n"x,y","say ""hi"""')
  })

  it('writes null as an empty cell', () => {
    expect(toCsv([{ a: null, b: 1 }], ['a', 'b'])).toBe('a,b\n,1')
  })

  it('neutralises spreadsheet formulas with a leading apostrophe', () => {
    expect(toCsv([{ a: '=1+1' }], ['a'])).toBe("a\n'=1+1")
  })

  it('quotes values containing a carriage return', () => {
    expect(toCsv([{ a: 'x\ry' }], ['a'])).toBe('a\n"x\ry"')
  })
})

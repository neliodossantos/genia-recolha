import { describe, expect, it } from 'vitest'
import { fileExtensionFor, pickMimeType } from '../utils/mime'

describe('pickMimeType', () => {
  it('picks the first supported candidate', () => {
    expect(pickMimeType(() => true)).toBe('video/webm;codecs=vp9')
  })
  it('falls through to mp4 when only mp4 is supported', () => {
    expect(pickMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
  })
  it('returns null when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBeNull()
  })
})

describe('fileExtensionFor', () => {
  it('maps mime types to extensions', () => {
    expect(fileExtensionFor('video/mp4')).toBe('mp4')
    expect(fileExtensionFor('video/webm;codecs=vp9')).toBe('webm')
  })
})

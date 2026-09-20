import { describe, expect, it, vi } from 'vitest'
import { uploadRecording, type UploadPayload } from '../utils/uploadClient'

const payload: UploadPayload = {
  wordId: 3,
  durationMs: 2100,
  width: 640,
  height: 480,
  video: new Blob(['video'], { type: 'video/webm' }),
  landmarksJson: '[]',
}

describe('uploadRecording', () => {
  it('posts a multipart body with the bearer token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: 'rec-9' }), { status: 200 }))

    const result = await uploadRecording(fetchFn as unknown as typeof fetch, 'jwt-1', payload)

    expect(result).toEqual({ id: 'rec-9' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recordings')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
    const form = init.body as FormData
    expect(form.get('word_id')).toBe('3')
    expect(form.get('duration_ms')).toBe('2100')
    expect(form.get('width')).toBe('640')
    expect(form.get('height')).toBe('480')
    expect(form.get('video')).toBeInstanceOf(Blob)
    expect(form.get('landmarks')).toBeInstanceOf(Blob)
  })

  it('throws the server message when the upload fails', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ statusMessage: 'unknown word' }), { status: 400 }),
    )
    await expect(
      uploadRecording(fetchFn as unknown as typeof fetch, 'jwt-1', payload),
    ).rejects.toThrow('unknown word')
  })

  it('throws a generic message when the server sends no body', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 502 }))
    await expect(
      uploadRecording(fetchFn as unknown as typeof fetch, 'jwt-1', payload),
    ).rejects.toThrow('Erro 502')
  })
})

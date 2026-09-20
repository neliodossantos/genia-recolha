import { describe, expect, it, vi } from 'vitest'
import {
  handleRecordingUpload,
  UploadError,
  type UploadDeps,
  type UploadInput,
} from '../server/utils/recordingUpload'

function makeDeps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    authenticate: vi.fn(async () => ({ id: 'user-1' })),
    wordIsActive: vi.fn(async () => true),
    putObject: vi.fn(async () => {}),
    deleteObjects: vi.fn(async () => {}),
    insertRecording: vi.fn(async () => ({ error: null })),
    newId: () => 'rec-1',
    ...overrides,
  }
}

function makeInput(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    token: 'jwt',
    wordId: 1,
    durationMs: 2000,
    width: 640,
    height: 480,
    userAgent: 'test-agent',
    video: { type: 'video/webm;codecs=vp9', size: 1000, bytes: new Uint8Array(1000) },
    landmarks: { size: 20, text: '[{"t":0,"hands":[]}]' },
    ...overrides,
  }
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
  } catch (err) {
    if (err instanceof UploadError) return err.status
    throw err
  }
  return 200
}

describe('handleRecordingUpload', () => {
  it('rejects a missing token with 401', async () => {
    expect(await statusOf(handleRecordingUpload(makeDeps(), makeInput({ token: null })))).toBe(401)
  })

  it('rejects an invalid token with 401', async () => {
    const deps = makeDeps({ authenticate: vi.fn(async () => null) })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(401)
  })

  it('rejects an unknown or inactive word with 400', async () => {
    const deps = makeDeps({ wordIsActive: vi.fn(async () => false) })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(400)
  })

  it('rejects an invalid duration with 400', async () => {
    expect(await statusOf(handleRecordingUpload(makeDeps(), makeInput({ durationMs: 0 })))).toBe(400)
    expect(await statusOf(handleRecordingUpload(makeDeps(), makeInput({ durationMs: 15001 })))).toBe(400)
  })

  it('rejects an unsupported video type with 400', async () => {
    const input = makeInput({ video: { type: 'image/png', size: 10, bytes: new Uint8Array(10) } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects a video type that only starts like an allowed one with 400', async () => {
    const input = makeInput({ video: { type: 'video/webmXYZ', size: 10, bytes: new Uint8Array(10) } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects empty landmarks with 400', async () => {
    const input = makeInput({ landmarks: { size: 2, text: '[]' } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects a video over 10 MB with 400', async () => {
    const input = makeInput({
      video: { type: 'video/webm', size: 10 * 1024 * 1024 + 1, bytes: new Uint8Array(1) },
    })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects landmarks that are not valid JSON with 400', async () => {
    const input = makeInput({ landmarks: { size: 8, text: 'not-json' } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('rejects landmarks that are not an array with 400', async () => {
    const input = makeInput({ landmarks: { size: 2, text: '{}' } })
    expect(await statusOf(handleRecordingUpload(makeDeps(), input))).toBe(400)
  })

  it('stores both files under server-generated keys and inserts the row', async () => {
    const deps = makeDeps()
    const result = await handleRecordingUpload(deps, makeInput())

    expect(result).toEqual({ id: 'rec-1' })
    expect(deps.putObject).toHaveBeenCalledWith(
      'user-1/rec-1.webm',
      expect.any(Uint8Array),
      'video/webm;codecs=vp9',
    )
    expect(deps.putObject).toHaveBeenCalledWith(
      'user-1/rec-1.json',
      expect.any(Uint8Array),
      'application/json',
    )
    expect(deps.insertRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'rec-1',
        user_id: 'user-1',
        word_id: 1,
        video_key: 'user-1/rec-1.webm',
        landmarks_key: 'user-1/rec-1.json',
        duration_ms: 2000,
        mime: 'video/webm;codecs=vp9',
      }),
    )
  })

  it('deletes both objects and returns 500 when the insert fails', async () => {
    const deps = makeDeps({ insertRecording: vi.fn(async () => ({ error: 'boom' })) })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    expect(deps.deleteObjects).toHaveBeenCalledWith(['user-1/rec-1.webm', 'user-1/rec-1.json'])
  })

  it('deletes both objects and returns 500 when a storage write fails', async () => {
    const putObject = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('r2 down'))
    const deps = makeDeps({ putObject })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    expect(deps.deleteObjects).toHaveBeenCalledWith(['user-1/rec-1.webm', 'user-1/rec-1.json'])
  })

  it('still returns a 500 UploadError when cleanup throws after a failed insert', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = makeDeps({
      insertRecording: vi.fn(async () => ({ error: 'boom' })),
      deleteObjects: vi.fn(async () => {
        throw new Error('r2 delete down')
      }),
    })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    expect(deps.deleteObjects).toHaveBeenCalledWith(['user-1/rec-1.webm', 'user-1/rec-1.json'])
    spy.mockRestore()
  })

  it('still returns a 500 UploadError when cleanup throws after a storage failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = makeDeps({
      putObject: vi.fn().mockRejectedValue(new Error('r2 down')),
      deleteObjects: vi.fn(async () => {
        throw new Error('r2 delete down')
      }),
    })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    spy.mockRestore()
  })

  it('cleans up and returns 500 when insertRecording throws', async () => {
    const deps = makeDeps({
      insertRecording: vi.fn(async () => {
        throw new Error('network')
      }),
    })
    expect(await statusOf(handleRecordingUpload(deps, makeInput()))).toBe(500)
    expect(deps.deleteObjects).toHaveBeenCalledWith(['user-1/rec-1.webm', 'user-1/rec-1.json'])
  })
})

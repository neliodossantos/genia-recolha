import { fileExtensionFor } from '../../utils/mime'

export const MAX_VIDEO_BYTES = 10 * 1024 * 1024
export const MAX_LANDMARKS_BYTES = 2 * 1024 * 1024
export const MAX_DURATION_MS = 15_000

export class UploadError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface NewRecording {
  id: string
  user_id: string
  word_id: number
  video_key: string
  landmarks_key: string
  duration_ms: number
  width: number | null
  height: number | null
  mime: string
  user_agent: string | null
}

export interface UploadDeps {
  authenticate(token: string): Promise<{ id: string } | null>
  wordIsActive(wordId: number): Promise<boolean>
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>
  deleteObjects(keys: string[]): Promise<void>
  insertRecording(row: NewRecording): Promise<{ error: string | null }>
  newId(): string
}

export interface UploadInput {
  token: string | null
  wordId: number
  durationMs: number
  width: number | null
  height: number | null
  userAgent: string | null
  video: { type: string; size: number; bytes: Uint8Array }
  landmarks: { size: number; text: string }
}

export async function handleRecordingUpload(
  deps: UploadDeps,
  input: UploadInput,
): Promise<{ id: string }> {
  if (!input.token) throw new UploadError(401, 'missing token')
  const user = await deps.authenticate(input.token)
  if (!user) throw new UploadError(401, 'invalid token')

  if (!Number.isInteger(input.wordId) || !(await deps.wordIsActive(input.wordId))) {
    throw new UploadError(400, 'unknown word')
  }
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs <= 0 ||
    input.durationMs > MAX_DURATION_MS
  ) {
    throw new UploadError(400, 'invalid duration')
  }
  if (!/^video\/(webm|mp4)($|;)/.test(input.video.type)) {
    throw new UploadError(400, 'unsupported video type')
  }
  if (input.video.size <= 0 || input.video.size > MAX_VIDEO_BYTES) {
    throw new UploadError(400, 'video too large')
  }
  if (input.landmarks.size > MAX_LANDMARKS_BYTES) {
    throw new UploadError(400, 'landmarks too large')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.landmarks.text)
  } catch {
    throw new UploadError(400, 'landmarks must be valid JSON')
  }
  if (!Array.isArray(parsed)) throw new UploadError(400, 'landmarks must be a JSON array')
  if (parsed.length === 0) throw new UploadError(400, 'empty landmarks')

  const id = deps.newId()
  const videoKey = `${user.id}/${id}.${fileExtensionFor(input.video.type)}`
  const landmarksKey = `${user.id}/${id}.json`

  const cleanup = async () => {
    try {
      await deps.deleteObjects([videoKey, landmarksKey])
    } catch (e) {
      console.error('cleanup failed', videoKey, landmarksKey, e)
    }
  }

  try {
    await deps.putObject(videoKey, input.video.bytes, input.video.type)
    await deps.putObject(
      landmarksKey,
      new TextEncoder().encode(input.landmarks.text),
      'application/json',
    )
  } catch {
    await cleanup()
    throw new UploadError(500, 'could not store files')
  }

  let error: string | null
  try {
    ;({ error } = await deps.insertRecording({
      id,
      user_id: user.id,
      word_id: input.wordId,
      video_key: videoKey,
      landmarks_key: landmarksKey,
      duration_ms: input.durationMs,
      width: input.width,
      height: input.height,
      mime: input.video.type,
      user_agent: input.userAgent,
    }))
  } catch {
    error = 'insert failed'
  }
  if (error) {
    await cleanup()
    throw new UploadError(500, 'could not save recording')
  }

  return { id }
}

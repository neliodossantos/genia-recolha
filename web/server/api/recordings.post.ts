import { createClient } from '@supabase/supabase-js'
import {
  handleRecordingUpload,
  MAX_LANDMARKS_BYTES,
  MAX_VIDEO_BYTES,
  UploadError,
} from '../utils/recordingUpload'

interface R2Bucket {
  put(key: string, body: Uint8Array, options?: { httpMetadata?: { contentType: string } }): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const authorization = getHeader(event, 'authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'missing token' })
  }
  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (contentLength > MAX_VIDEO_BYTES + MAX_LANDMARKS_BYTES + 64 * 1024) {
    throw createError({ statusCode: 413, statusMessage: 'body too large' })
  }

  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: 'multipart body required' })
  }
  const part = (name: string) => parts.find((p) => p.name === name)
  const text = (name: string) => part(name)?.data.toString('utf-8') ?? ''
  const optionalNumber = (name: string) => {
    const value = text(name)
    return value === '' ? null : Number(value)
  }

  const videoPart = part('video')
  const landmarksPart = part('landmarks')
  if (!videoPart || !landmarksPart) {
    throw createError({ statusCode: 400, statusMessage: 'video and landmarks are required' })
  }

  const bucket = (event.context.cloudflare?.env?.RECORDINGS_BUCKET ?? null) as R2Bucket | null
  if (!bucket) {
    throw createError({ statusCode: 500, statusMessage: 'storage not configured' })
  }

  const client = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })

  try {
    return await handleRecordingUpload(
      {
        async authenticate(jwt) {
          const { data, error } = await client.auth.getUser(jwt)
          return error || !data.user ? null : { id: data.user.id }
        },
        async wordIsActive(wordId) {
          const { data } = await client
            .from('vocabulary')
            .select('id')
            .eq('id', wordId)
            .eq('active', true)
            .maybeSingle()
          return data !== null
        },
        async putObject(key, body, contentType) {
          await bucket.put(key, body, { httpMetadata: { contentType } })
        },
        async deleteObjects(keys) {
          await bucket.delete(keys)
        },
        async insertRecording(row) {
          const { error } = await client.from('recordings').insert(row)
          return { error: error ? error.message : null }
        },
        newId: () => crypto.randomUUID(),
      },
      {
        token,
        wordId: Number(text('word_id')),
        durationMs: Number(text('duration_ms')),
        width: optionalNumber('width'),
        height: optionalNumber('height'),
        userAgent: getHeader(event, 'user-agent') ?? null,
        video: {
          type: videoPart.type ?? '',
          size: videoPart.data.byteLength,
          bytes: videoPart.data,
        },
        landmarks: {
          size: landmarksPart.data.byteLength,
          text: landmarksPart.data.toString('utf-8'),
        },
      },
    )
  } catch (err) {
    if (err instanceof UploadError) {
      throw createError({ statusCode: err.status, statusMessage: err.message })
    }
    throw err
  }
})

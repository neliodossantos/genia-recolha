import { cameraErrorMessage } from '~/utils/camera'
import { pickMimeType } from '~/utils/mime'

export interface RecordedClip {
  blob: Blob
  mime: string
  durationMs: number
  width: number
  height: number
}

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('A câmara só funciona em ligações seguras (HTTPS) ou em localhost.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    })
  } catch (error) {
    throw new Error(cameraErrorMessage(error))
  }
}

export function createRecorder(stream: MediaStream) {
  const mime = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
  if (!mime) {
    throw new Error('Este browser não suporta gravação de vídeo. Experimenta o Chrome ou o Firefox.')
  }

  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let startedAt = 0

  return {
    start(): number {
      chunks = []
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 600_000 })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      startedAt = performance.now()
      recorder.start()
      return startedAt
    },

    stop(): Promise<RecordedClip> {
      return new Promise((resolve, reject) => {
        if (!recorder) {
          reject(new Error('A gravação não foi iniciada.'))
          return
        }
        if (recorder.state !== 'recording') {
          reject(new Error('A gravação não está ativa.'))
          return
        }
        const settings = stream.getVideoTracks()[0]?.getSettings() ?? {}
        recorder.onstop = () => {
          resolve({
            blob: new Blob(chunks, { type: mime }),
            mime,
            durationMs: Math.round(performance.now() - startedAt),
            width: settings.width ?? 0,
            height: settings.height ?? 0,
          })
        }
        recorder.stop()
      })
    },
  }
}

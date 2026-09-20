export interface UploadPayload {
  wordId: number
  durationMs: number
  width: number
  height: number
  video: Blob
  landmarksJson: string
}

export async function uploadRecording(
  fetchFn: typeof fetch,
  token: string,
  payload: UploadPayload,
): Promise<{ id: string }> {
  const form = new FormData()
  form.append('word_id', String(payload.wordId))
  form.append('duration_ms', String(payload.durationMs))
  form.append('width', String(payload.width))
  form.append('height', String(payload.height))
  form.append('video', payload.video, 'clip')
  form.append('landmarks', new Blob([payload.landmarksJson], { type: 'application/json' }), 'landmarks.json')

  const response = await fetchFn('/api/recordings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.statusMessage ?? `Erro ${response.status}`)
  }
  return response.json()
}

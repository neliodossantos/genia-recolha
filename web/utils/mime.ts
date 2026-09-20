const CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return CANDIDATES.find(isSupported) ?? null
}

export function fileExtensionFor(mime: string): 'webm' | 'mp4' {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

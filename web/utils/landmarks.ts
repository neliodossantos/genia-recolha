export interface HandPoint {
  x: number
  y: number
  z: number
}

export interface HandFrame {
  handedness: 'Left' | 'Right' | null
  points: HandPoint[]
}

export interface LandmarkFrame {
  t: number
  hands: HandFrame[]
}

export interface RawHandResult {
  landmarks: HandPoint[][]
  handedness?: { categoryName: string }[][]
}

export interface LandmarkBuffer {
  startMs: number
  frames: LandmarkFrame[]
}

export function createLandmarkBuffer(startMs: number): LandmarkBuffer {
  return { startMs, frames: [] }
}

function toHandedness(name: string | undefined): 'Left' | 'Right' | null {
  // MediaPipe HandLandmarker assumes a mirrored (selfie) input image. We feed it the raw,
  // unmirrored video frame (mirroring is CSS-only), so its labels are inverted: 'Left' is
  // the signer's physical right hand. Swap to store the signer's physical hand.
  if (name === 'Left') return 'Right'
  if (name === 'Right') return 'Left'
  return null
}

export function addFrame(
  buffer: LandmarkBuffer,
  nowMs: number,
  result: RawHandResult | null,
): LandmarkBuffer {
  const hands: HandFrame[] = (result?.landmarks ?? []).map((points, i) => ({
    handedness: toHandedness(result?.handedness?.[i]?.[0]?.categoryName),
    points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  }))
  buffer.frames.push({ t: Math.round(nowMs - buffer.startMs), hands })
  return buffer
}

export function serializeBuffer(buffer: LandmarkBuffer): string {
  return JSON.stringify(buffer.frames)
}

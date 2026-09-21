export const NO_HANDS_HINT_MS = 1500
export const DARK_LUMA_THRESHOLD = 60

export interface HandStatus {
  label: string
  tone: 'good' | 'warn'
}

export function handStatus(handsCount: number): HandStatus {
  if (handsCount <= 0) return { label: 'Sem mãos', tone: 'warn' }
  if (handsCount === 1) return { label: '1 mão detetada', tone: 'good' }
  return { label: `${handsCount} mãos detetadas`, tone: 'good' }
}

export function noHandsHint(msWithoutHands: number): string | null {
  if (msWithoutHands < NO_HANDS_HINT_MS) return null
  return 'Não vejo as tuas mãos: aproxima-te ou põe-nas dentro do enquadramento.'
}

// `data` is RGBA pixel data (as in ImageData.data); alpha is ignored.
export function averageLuma(data: ArrayLike<number>): number {
  const pixels = Math.floor(data.length / 4)
  if (pixels === 0) return 0
  let sum = 0
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    sum += 0.299 * r + 0.587 * g + 0.114 * b
  }
  return sum / pixels
}

export function isTooDark(luma: number): boolean {
  return luma < DARK_LUMA_THRESHOLD
}

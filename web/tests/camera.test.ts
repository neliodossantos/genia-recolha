import { describe, expect, it } from 'vitest'
import { cameraErrorMessage } from '../utils/camera'

function domError(name: string) {
  return Object.assign(new Error(name), { name })
}

describe('cameraErrorMessage', () => {
  it('explains a denied permission', () => {
    expect(cameraErrorMessage(domError('NotAllowedError'))).toContain('permissão')
  })
  it('explains a missing camera', () => {
    expect(cameraErrorMessage(domError('NotFoundError'))).toContain('Nenhuma câmara')
  })
  it('explains a camera in use', () => {
    expect(cameraErrorMessage(domError('NotReadableError'))).toContain('outra aplicação')
  })
  it('falls back to a generic message', () => {
    expect(cameraErrorMessage(new Error('x'))).toContain('Não foi possível')
  })
})

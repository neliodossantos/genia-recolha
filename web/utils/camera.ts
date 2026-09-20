export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError') {
    return 'Sem permissão para usar a câmara. Autoriza a câmara nas definições do browser e recarrega a página.'
  }
  if (name === 'NotFoundError') {
    return 'Nenhuma câmara encontrada neste dispositivo.'
  }
  if (name === 'NotReadableError') {
    return 'A câmara está a ser usada por outra aplicação. Fecha-a e tenta de novo.'
  }
  return 'Não foi possível abrir a câmara.'
}

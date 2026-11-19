// Textos de la actualización automática (Fase 9): lo que dice la píldora y lo
// que responde Ayuda → Buscar actualizaciones en cada estado. Puro, sin React.

import type { UpdateState } from '@shared/protocol.ts'

/** Lo que la píldora muestra; null = nada que decir (desactivada, al día, comprobando o con error). */
export function pillLabel(s: UpdateState | null): string | null {
  if (!s?.latest) return null
  if (s.status === 'available') return `Descargando ${s.latest}`
  if (s.status === 'downloading') return `Descargando ${s.latest} (${s.progress ?? 0} %)`
  if (s.status === 'downloaded') return `Reiniciar para actualizar a ${s.latest}`
  return null
}

/** La respuesta de Ayuda → Buscar actualizaciones…: un mensaje por estado. */
export function checkResult(s: UpdateState): { text: string; level: 'info' | 'error' } {
  switch (s.status) {
    case 'disabled':
      return {
        text:
          s.reason === 'env'
            ? 'Las actualizaciones están desactivadas (OSC_NO_UPDATE_CHECK=1).'
            : 'Las actualizaciones automáticas solo funcionan en la aplicación instalada, no en desarrollo.',
        level: 'info'
      }
    case 'idle':
      return { text: `Ya tienes la última versión (${s.current}).`, level: 'info' }
    case 'checking':
      return { text: 'Buscando actualizaciones…', level: 'info' }
    case 'available':
    case 'downloading':
      return {
        text: `Hay una versión nueva (${s.latest}); se está descargando en segundo plano.`,
        level: 'info'
      }
    case 'downloaded':
      return {
        text: `La versión ${s.latest} está lista: pulsa «Reiniciar para actualizar a ${s.latest}».`,
        level: 'info'
      }
    case 'error':
      return {
        text: `No se pudo buscar actualizaciones: ${s.error ?? 'error desconocido'}`,
        level: 'error'
      }
  }
}

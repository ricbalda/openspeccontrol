// safe-close (tarea 4.4): qué sesiones interrumpiría cerrar la app, el
// detalle que lo dice y el diálogo Cancelar / Cerrar igual. El diálogo de
// Electron se simula para responder cada lado.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '@shared/protocol.ts'

const box = vi.hoisted(() => ({ opts: null as unknown, response: 0 }))
vi.mock('electron', () => ({
  dialog: {
    showMessageBox: async (opts: unknown) => {
      box.opts = opts
      return { response: box.response }
    }
  }
}))

import { confirmQuit, liveWork, workDetail } from '../../src/main/desktop/safe-close.ts'

const session = (
  repo: string,
  over: Partial<SessionState>
): { repo: string; state: SessionState } => ({
  repo,
  state: {
    repo,
    agent: 'claude',
    status: 'ready',
    sessionId: '1',
    configOptions: [],
    pendingInteractions: 0,
    context: null,
    ...over
  }
})

describe('liveWork (tarea 4.4)', () => {
  it('mantiene las sesiones busy y las decisiones pendientes; descarta el resto', () => {
    const work = liveWork([
      session('/repos/idle', {}),
      session('/repos/busy', { status: 'busy' }),
      session('/repos/ask', { pendingInteractions: 2 })
    ])
    expect(work).toEqual([
      { repo: '/repos/busy', busy: true, pending: 0 },
      { repo: '/repos/ask', busy: false, pending: 2 }
    ])
  })

  it('sin sesiones vivas no hay trabajo que confirmar', () => {
    expect(liveWork([session('/repos/idle', {})])).toEqual([])
  })
})

describe('workDetail', () => {
  it('una línea por repo, con el nombre de la carpeta y lo que se interrumpe', () => {
    const d = workDetail([
      { repo: 'C:\\repos\\api', busy: true, pending: 0 },
      { repo: '/home/me/web', busy: false, pending: 1 },
      { repo: '/p/wait', busy: true, pending: 3 }
    ])
    expect(d).toContain('- api: un agente está trabajando.')
    expect(d).toContain('- web: 1 decisión pendiente.')
    expect(d).toContain('- wait: un agente está trabajando y 3 decisiones pendientes.')
  })
})

describe('confirmQuit (tarea 4.4)', () => {
  beforeEach(() => {
    box.opts = null
  })

  it('"Cancelar" mantiene la app (no sale)', async () => {
    box.response = 0
    await expect(confirmQuit([{ repo: '/r', busy: true, pending: 0 }])).resolves.toBe(false)
  })

  it('"Cerrar igual" deja salir', async () => {
    box.response = 1
    await expect(confirmQuit([{ repo: '/r', busy: false, pending: 3 }])).resolves.toBe(true)
  })

  it('el diálogo: warning, Cancelar por defecto y como cancelación, con el detalle', async () => {
    box.response = 0
    await confirmQuit([{ repo: '/r/app', busy: true, pending: 0 }])
    expect(box.opts).toMatchObject({
      type: 'warning',
      buttons: ['Cancelar', 'Cerrar igual'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    expect((box.opts as { detail: string }).detail).toContain('app')
    expect((box.opts as { detail: string }).detail).toContain('un agente está trabajando')
  })
})

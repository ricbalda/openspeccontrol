// renderer-health (tarea 4.7): un renderer muerto o colgado se registra y se
// ofrece recargar — el estado vive en el main, así que reload() es la vía de
// recuperación (el renderer re-suscribe y recibe el replay). El diálogo de
// Electron se simula.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const box = vi.hoisted(() => ({ opts: null as unknown, response: 0 }))
vi.mock('electron', () => ({
  dialog: {
    showMessageBox: async (opts: unknown) => {
      box.opts = opts
      return { response: box.response }
    }
  }
}))

import {
  attachRendererHealth,
  goneMessage,
  type HealthWindow
} from '../../src/main/desktop/renderer-health.ts'

/** a fake window: records reload/close, fires its own webContents events */
function fakeWin() {
  const listeners = new Map<string, (e: unknown, d?: unknown) => void>()
  const s = { destroyed: false, reloaded: 0, closed: 0 }
  const win = {
    isDestroyed: () => s.destroyed,
    close: () => {
      s.closed++
    },
    webContents: {
      on: (ev: string, fn: (e: unknown, d?: unknown) => void) => void listeners.set(ev, fn),
      reload: () => {
        s.reloaded++
      }
    }
  }
  return {
    win: win as unknown as HealthWindow,
    fire: (ev: 'render-process-gone' | 'unresponsive', d?: unknown) =>
      listeners.get(ev)!(undefined, d),
    counts: s,
    destroy: () => {
      s.destroyed = true
    }
  }
}

describe('goneMessage', () => {
  it('nombra el motivo y el código de salida', () => {
    expect(goneMessage({ reason: 'crashed', exitCode: 12 })).toContain('crashed')
    expect(goneMessage({ reason: 'crashed', exitCode: 12 })).toContain('12')
  })
})

describe('attachRendererHealth (tarea 4.7)', () => {
  let logs: string[]
  beforeEach(() => {
    box.opts = null
    logs = []
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logs.push(String(a[0]))
    })
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      logs.push(String(a[0]))
    })
    return () => vi.restoreAllMocks()
  })

  it('render-process-gone: registra el motivo y recargar es la salida por defecto', async () => {
    const f = fakeWin()
    attachRendererHealth(f.win)
    box.response = 0
    f.fire('render-process-gone', { reason: 'oom', exitCode: 5 })
    await Promise.resolve() // deja que el diálogo (mocked) se resuelva
    expect(logs.some((l) => l.includes('oom'))).toBe(true) // el motivo queda registrado
    expect(f.counts.reloaded).toBe(1)
    expect(f.counts.closed).toBe(0)
  })

  it('"Cerrar" cierra la ventana (que pasa por el cierre seguro 4.4)', async () => {
    const f = fakeWin()
    attachRendererHealth(f.win)
    box.response = 1
    f.fire('render-process-gone', { reason: 'crashed', exitCode: 1 })
    await Promise.resolve()
    expect(f.counts.closed).toBe(1)
    expect(f.counts.reloaded).toBe(0)
  })

  it('unresponsive también ofrece la recarga', async () => {
    const f = fakeWin()
    attachRendererHealth(f.win)
    box.response = 0
    f.fire('unresponsive')
    await Promise.resolve()
    expect(f.counts.reloaded).toBe(1)
    expect((box.opts as { detail: string }).detail).toContain('no responde')
  })

  it('la ventana puede morir mientras el diálogo está abierto: no se toca nada', async () => {
    const f = fakeWin()
    attachRendererHealth(f.win)
    box.response = 0
    f.fire('render-process-gone', { reason: 'kill', exitCode: 0 })
    f.destroy() // entre el evento y la respuesta del diálogo
    await Promise.resolve()
    expect(f.counts.reloaded).toBe(0)
    expect(f.counts.closed).toBe(0)
  })
})

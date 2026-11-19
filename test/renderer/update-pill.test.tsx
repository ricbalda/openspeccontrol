// @vitest-environment jsdom
// UpdatePill (tarea 9.3): "Descargando x.y.z (n %)" → "Reiniciar para actualizar a x.y.z",
// el clic pide a main que reinicie (main aplica la confirmación de cierre seguro) y el aspa
// la oculta hasta la próxima versión. Los cambios llegan como ServerMsg update_state (9.2).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg, UpdateState } from '@shared/protocol.ts'
import { UpdatePill } from '../../src/renderer/src/UpdatePill.tsx'
import { boot, useStore } from '../../src/renderer/src/store.ts'

const osc = vi.hoisted(() => ({
  installUpdate: vi.fn(),
  updateState: vi.fn(),
  config: vi.fn(),
  repos: vi.fn(),
  listener: null as null | ((m: ServerMsg) => void)
}))

window.osc = {
  installUpdate: osc.installUpdate,
  updateState: osc.updateState,
  config: osc.config,
  repos: osc.repos,
  send: () => {},
  onMessage: (cb: (m: ServerMsg) => void) => {
    osc.listener = cb
    return () => {}
  }
} as unknown as typeof window.osc

let root: Root | null = null
const renderUi = (ui: React.ReactNode): HTMLElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(ui))
  return el
}
const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
const restartButton = (el: HTMLElement): HTMLButtonElement | undefined =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Reiniciar'))

const downloading: UpdateState = {
  status: 'downloading',
  current: '0.1.0',
  latest: '0.1.1',
  progress: 42
}
const downloaded: UpdateState = { status: 'downloaded', current: '0.1.0', latest: '0.1.1' }

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  localStorage.clear()
  osc.installUpdate.mockReset()
  osc.updateState.mockReset().mockResolvedValue({ status: 'idle', current: '0.1.0' })
  osc.config.mockResolvedValue({ platform: 'win32', defaultAgent: 'claude', agents: [], tools: [] })
  osc.repos.mockResolvedValue({ roots: [], repos: [] })
  useStore.setState({ update: null, toasts: [] })
})

describe('el estado llega por update_state (9.2)', () => {
  it('boot() pide el estado actual y se suscribe a los cambios', async () => {
    osc.updateState.mockResolvedValue(downloaded)
    await boot()
    await flush()
    expect(useStore.getState().update).toEqual(downloaded)
    act(() => osc.listener!({ type: 'update_state', state: downloading }))
    expect(useStore.getState().update).toEqual(downloading)
  })
})

describe('UpdatePill (9.3)', () => {
  it('sin actualización (desactivada, al día, comprobando, error) no se muestra', () => {
    const el = renderUi(<UpdatePill />)
    for (const state of [
      { status: 'disabled', current: '0.1.0', reason: 'dev' },
      { status: 'idle', current: '0.1.0' },
      { status: 'checking', current: '0.1.0' },
      { status: 'error', current: '0.1.0', error: 'offline' }
    ] as UpdateState[]) {
      act(() => useStore.setState({ update: state }))
      expect(el.textContent).toBe('')
    }
  })

  it('muestra "Descargando x.y.z (n %)" y luego "Reiniciar para actualizar a x.y.z"', () => {
    const el = renderUi(<UpdatePill />)
    act(() => useStore.setState({ update: downloading }))
    expect(el.textContent).toContain('Descargando 0.1.1 (42 %)')
    expect(restartButton(el)).toBeUndefined() // mientras descarga no se puede reiniciar
    act(() => useStore.setState({ update: downloaded }))
    expect(el.textContent).toContain('Reiniciar para actualizar a 0.1.1')
    expect(restartButton(el)).toBeDefined()
  })

  it('el clic pide a main instalar; Cancelar en la confirmación no es un error', async () => {
    osc.installUpdate.mockResolvedValue({ installing: false }) // el usuario canceló en main
    const el = renderUi(<UpdatePill />)
    act(() => useStore.setState({ update: downloaded }))
    await act(async () => restartButton(el)!.click())
    await flush()
    expect(osc.installUpdate).toHaveBeenCalledTimes(1)
    expect(useStore.getState().toasts).toEqual([])
    expect(el.textContent).toContain('Reiniciar para actualizar a 0.1.1') // se puede reintentar
  })

  it('si main rechaza el reinicio, lo avisa con su mensaje', async () => {
    osc.installUpdate.mockRejectedValue(new Error('no hay una actualización descargada'))
    const el = renderUi(<UpdatePill />)
    act(() => useStore.setState({ update: downloaded }))
    await act(async () => restartButton(el)!.click())
    await flush()
    expect(useStore.getState().toasts.map((t) => t.text)).toEqual([
      'no hay una actualización descargada'
    ])
  })

  it('"Ocultar hasta la próxima versión" la oculta para esa versión y vuelve con otra', () => {
    const el = renderUi(<UpdatePill />)
    act(() => useStore.setState({ update: downloaded }))
    const hide = el.querySelector('button[title="Ocultar hasta la próxima versión"]') as HTMLElement
    act(() => hide.click())
    expect(el.textContent).toBe('')
    expect(localStorage.getItem('update-dismissed')).toBe('0.1.1')
    act(() => useStore.setState({ update: { ...downloaded, latest: '0.1.2' } }))
    expect(el.textContent).toContain('Reiniciar para actualizar a 0.1.2')
  })
})

// @vitest-environment jsdom
// Asas de arrastre del rail (derecha) y del panel del agente (izquierda): puntero, teclado,
// doble clic, ARIA y limpieza al desmontar. Comparten PanelResizer.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ColumnResizer,
  RailResizer,
  RAIL_MAX,
  RAIL_MIN
} from '../../src/renderer/src/panes/ColumnResizer.tsx'

let root: Root | null = null
let host: HTMLElement

// jsdom no implementa la captura de puntero
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  window.innerWidth = 1600
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
})

const renderUi = (ui: React.ReactNode): HTMLElement => {
  root = createRoot(host)
  act(() => root!.render(ui))
  return host.querySelector('[role="separator"]') as HTMLElement
}
// React escucha los eventos nativos pointer*; un MouseEvent con ese tipo lleva clientX y button
const pointer = (el: HTMLElement, type: string, clientX: number): void =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }))
  })
const press = (el: HTMLElement, key: string, shiftKey = false): void =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })

describe('RailResizer', () => {
  const mount = (width = 272, agent = 400) => {
    const onChange = vi.fn()
    const onReset = vi.fn()
    const el = renderUi(
      <RailResizer width={width} onChange={onChange} onReset={onReset} agentWidth={() => agent} />
    )
    return { el, onChange, onReset }
  }

  it('is a vertical separator with its limits', () => {
    const { el } = mount()
    expect(el.getAttribute('role')).toBe('separator')
    expect(el.getAttribute('aria-orientation')).toBe('vertical')
    expect(el.getAttribute('aria-valuenow')).toBe('272')
    expect(el.getAttribute('aria-valuemin')).toBe(String(RAIL_MIN))
    // 1600 - 400 (chat) - 480 (document) = 720, capped at RAIL_MAX
    expect(el.getAttribute('aria-valuemax')).toBe(String(RAIL_MAX))
    expect(el.getAttribute('aria-label')).toBeTruthy()
    expect(el.tabIndex).toBe(0)
    expect(el.className).toContain('cursor-col-resize')
  })

  it('reports a lower maximum when the chat takes the room', () => {
    window.innerWidth = 1200
    const { el } = mount(272, 400)
    // 1200 - 400 - 480 = 320
    expect(el.getAttribute('aria-valuemax')).toBe('320')
  })

  it('moves 16 px with the arrows (64 with Shift): right widens, left narrows', () => {
    const { el, onChange } = mount(272)
    press(el, 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(288)
    press(el, 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(256)
    press(el, 'ArrowRight', true)
    expect(onChange).toHaveBeenLastCalledWith(336)
    press(el, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('stops at the limits with the keyboard', () => {
    const { el, onChange } = mount(RAIL_MIN)
    press(el, 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(RAIL_MIN)
    act(() => root!.unmount())
    const wide = mount(RAIL_MAX)
    press(wide.el, 'ArrowRight')
    expect(wide.onChange).toHaveBeenLastCalledWith(RAIL_MAX)
  })

  it('does not take the document room: the maximum counts the chat', () => {
    window.innerWidth = 1200
    const { el, onChange } = mount(312, 400)
    press(el, 'ArrowRight')
    // 1200 - 400 - 480 = 320
    expect(onChange).toHaveBeenLastCalledWith(320)
  })

  it('resets on double-click', () => {
    const { el, onReset } = mount()
    act(() => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('follows the pointer: dragging right widens, and the change lands on release', () => {
    const { el, onChange } = mount(272)
    pointer(el, 'pointerdown', 272)
    expect(document.body.style.userSelect).toBe('none')
    expect(document.body.style.cursor).toBe('col-resize')
    pointer(el, 'pointermove', 322)
    pointer(el, 'pointerup', 322)
    expect(onChange).toHaveBeenLastCalledWith(322)
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })

  it('clamps the drag, and ignores moves when no drag started', () => {
    const { el, onChange } = mount(272)
    pointer(el, 'pointermove', 900)
    expect(onChange).not.toHaveBeenCalled()
    pointer(el, 'pointerdown', 272)
    pointer(el, 'pointermove', 5000)
    pointer(el, 'pointerup', 5000)
    expect(onChange).toHaveBeenLastCalledWith(RAIL_MAX)
    pointer(el, 'pointerdown', 300)
    pointer(el, 'pointermove', -5000)
    pointer(el, 'pointerup', -5000)
    expect(onChange).toHaveBeenLastCalledWith(RAIL_MIN)
  })

  it('cleans up when unmounted in the middle of a drag', () => {
    const { el } = mount()
    pointer(el, 'pointerdown', 272)
    expect(document.body.style.userSelect).toBe('none')
    act(() => root!.unmount())
    root = null
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })
})

describe('ColumnResizer (the agent edge keeps its behaviour)', () => {
  const mount = (width = 400, rail = 272) => {
    const onChange = vi.fn()
    const onReset = vi.fn()
    const el = renderUi(
      <ColumnResizer width={width} onChange={onChange} onReset={onReset} railWidth={() => rail} />
    )
    return { el, onChange, onReset }
  }

  it('moving left widens the chat, and so does ArrowLeft', () => {
    const { el, onChange } = mount(400)
    pointer(el, 'pointerdown', 1000)
    pointer(el, 'pointermove', 900)
    pointer(el, 'pointerup', 900)
    expect(onChange).toHaveBeenLastCalledWith(500)
    press(el, 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(416)
    press(el, 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(384)
  })

  it('keeps the document room counting the rail it is given', () => {
    window.innerWidth = 1200
    const { el, onChange } = mount(400, 320)
    // 1200 - 320 - 480 = 400
    expect(el.getAttribute('aria-valuemax')).toBe('400')
    press(el, 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith(400)
  })

  it('sits on the left edge, the rail one on the right', () => {
    expect(mount().el.className).toContain('-left-1.5')
    act(() => root!.unmount())
    const rail = renderUi(
      <RailResizer width={272} onChange={() => {}} onReset={() => {}} agentWidth={() => 400} />
    )
    expect(rail.className).toContain('-right-1.5')
  })
})

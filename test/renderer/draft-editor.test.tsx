// @vitest-environment jsdom
// Fase 5 (design D-6): el editor de borradores — vista previa del markdown,
// autoguardado a 1 s con temporizadores falsos (un solo guardado tras varias
// pulsaciones, guardado forzado al cambiar de vista, fallo que conserva el texto),
// contador n / 4000 con bloqueo de envío, Ctrl/Cmd+Enter, vista de un enviado,
// duplicado y borrado con confirmación. Se renderiza a través de DocReview, que
// es quien decide mostrar el editor cuando browse.kind === 'draft'.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft, DraftSummary } from '@shared/ipc.ts'
import type { SessionState } from '@shared/protocol.ts'
import { DocReview } from '../../src/renderer/src/panes/DocReview.tsx'
import { flushDraft, useStore } from '../../src/renderer/src/store.ts'

const APP = 'C:/repos/app'

const mkDraft = (o: Partial<Draft> = {}): Draft => ({
  id: 'd1',
  repo: APP,
  title: '',
  body: '',
  status: 'draft',
  sentMode: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  sentAt: null,
  length: 0,
  ...o
})

const READY: SessionState = {
  repo: APP,
  agent: 'fake',
  status: 'ready',
  sessionId: null,
  configOptions: [],
  pendingInteractions: 0,
  context: null
}

const osc = vi.hoisted(() => ({
  draft: vi.fn(),
  saveDraft: vi.fn(),
  duplicateDraft: vi.fn(),
  deleteDraft: vi.fn(),
  sendDraft: vi.fn(),
  drafts: vi.fn()
}))

// React 19: los updates de act necesitan este entorno
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

window.osc = osc as unknown as typeof window.osc

/** El borrador «en la base»: los mocks lo mutan como haría el núcleo. */
let currentDraft: Draft = mkDraft()

let root: Root | null = null
let el: HTMLElement | null = null

const render = (): HTMLElement => {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<DocReview />))
  return el
}

/** Renderiza y espera a que el editor cargue el borrador. */
const renderEditor = async (): Promise<HTMLElement> => {
  const e = render()
  await act(async () => {})
  return e
}

/** Vaciados de microtareas: cada eslabón de la cadena de guardado es un then. */
const settle = async (ticks = 8): Promise<void> => {
  for (let i = 0; i < ticks; i++) await act(async () => {})
}

const button = (e: HTMLElement, text: string, index = 0): HTMLButtonElement => {
  const hits = [...e.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text)
  return hits[index] as HTMLButtonElement
}

/** Escribe en un input controlado de React vía el setter nativo + evento input. */
const type = (node: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(node.constructor.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = (node: Element): void => {
  act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  currentDraft = mkDraft()
  osc.draft.mockImplementation(async (id: string) => ({ ...currentDraft, id }))
  osc.saveDraft.mockImplementation(
    async (_id: string, patch: { title?: string; body?: string }) => {
      currentDraft = {
        ...currentDraft,
        ...patch,
        updatedAt: '2026-11-19T11:00:00.000Z',
        length: (patch.body ?? currentDraft.body).length
      }
      return { ...currentDraft }
    }
  )
  osc.drafts.mockResolvedValue([] as DraftSummary[])
  osc.duplicateDraft.mockImplementation(async () => {
    currentDraft = mkDraft({
      id: 'd2',
      title: `${currentDraft.title} (copy)`,
      body: currentDraft.body,
      createdAt: '2026-11-19T12:00:00.000Z',
      updatedAt: '2026-11-19T12:00:00.000Z'
    })
    return { ...currentDraft }
  })
  osc.deleteDraft.mockResolvedValue({ ok: true as const })
  osc.sendDraft.mockImplementation(async () => {
    currentDraft = {
      ...currentDraft,
      status: 'sent',
      sentMode: 'propose',
      sentAt: '2026-11-19T12:30:00.000Z'
    }
    return { ...currentDraft }
  })
  useStore.setState({
    repo: APP,
    repos: [],
    openRepos: [APP],
    views: {},
    changes: [],
    browse: { kind: 'draft', id: 'd1' },
    change: null,
    file: null,
    content: '',
    session: READY,
    draftsByRepo: {},
    toasts: []
  })
})

afterEach(async () => {
  vi.useRealTimers()
  const r = root
  if (r) {
    act(() => r.unmount())
    root = null
  }
  if (el) {
    el.remove()
    el = null
  }
  // deja terminar los guardados en vuelo antes del siguiente test
  await new Promise((r) => setTimeout(r, 0))
})

describe('tarea 5.1: título, contenido y vista previa', () => {
  it('la vista previa renderiza un título y una lista markdown', async () => {
    currentDraft = mkDraft({ title: 'Export', body: '# Title\n\n- one\n- two' })
    const e = await renderEditor()
    click(button(e, 'Preview'))
    const doc = e.querySelector('.doc')!
    expect(doc.querySelector('h1')?.textContent).toBe('Title')
    expect([...doc.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two'])
  })

  it('Edit vuelve al textarea con el mismo contenido', async () => {
    currentDraft = mkDraft({ body: 'draft body' })
    const e = await renderEditor()
    click(button(e, 'Preview'))
    click(button(e, 'Edit'))
    expect((e.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft body')
  })

  it('muestra el título vacío como Untitled draft', async () => {
    currentDraft = mkDraft({ title: '' })
    const e = await renderEditor()
    expect((e.querySelector('input') as HTMLInputElement).value).toBe('')
    expect(e.querySelector('input')?.placeholder).toBe('Untitled draft')
  })

  it('muestra las fechas de creación y modificación', async () => {
    const e = await renderEditor()
    expect(e.textContent).toContain('Created')
    expect(e.textContent).toContain('Modified')
  })
})

describe('tarea 5.2: autoguardado e indicador', () => {
  it('varias pulsaciones producen un solo guardado con el texto final', async () => {
    const e = await renderEditor()
    const ta = e.querySelector('textarea')!
    type(ta, 'Add a CSV')
    type(ta, 'Add a CSV export')
    type(ta, 'Add a CSV export of the report')
    expect(e.textContent).toContain('Saving…')
    expect(osc.saveDraft).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(osc.saveDraft).toHaveBeenCalledTimes(1)
    expect(osc.saveDraft).toHaveBeenCalledWith('d1', { body: 'Add a CSV export of the report' })
    expect(e.textContent).toContain('Saved')
  })

  it('cambiar de vista fuerza el guardado pendiente (sin doble guardado)', async () => {
    const e = await renderEditor()
    type(e.querySelector('textarea')!, 'pending text')
    expect(osc.saveDraft).not.toHaveBeenCalled()
    act(() => useStore.setState({ browse: null }))
    await settle()
    expect(osc.saveDraft).toHaveBeenCalledTimes(1)
    expect(osc.saveDraft).toHaveBeenCalledWith('d1', { body: 'pending text' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(osc.saveDraft).toHaveBeenCalledTimes(1) // el temporizador ya no dispara
  })

  it('cambiar de repositorio también fuerza el guardado', async () => {
    const e = await renderEditor()
    type(e.querySelector('textarea')!, 'before switching repo')
    act(() => useStore.setState({ repo: 'C:/repos/other' }))
    await settle()
    expect(osc.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('flushDraft() del store fuerza el guardado pendiente', async () => {
    const e = await renderEditor()
    type(e.querySelector('textarea')!, 'flushed by the store')
    act(() => flushDraft())
    await settle()
    expect(osc.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('el blur del contenido fuerza el guardado', async () => {
    const e = await renderEditor()
    const ta = e.querySelector('textarea')!
    type(ta, 'saved on blur')
    await act(async () => {
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await settle()
    expect(osc.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('un fallo conserva el texto y muestra Not saved con el motivo', async () => {
    const e = await renderEditor()
    osc.saveDraft.mockRejectedValueOnce(new Error('database is locked'))
    type(e.querySelector('textarea')!, 'important text')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(osc.saveDraft).toHaveBeenCalledTimes(1)
    expect(e.textContent).toContain('Not saved')
    expect(e.textContent).toContain('database is locked')
    expect((e.querySelector('textarea') as HTMLTextAreaElement).value).toBe('important text')
    // el reintento (siguiente edición) vuelve a intentar el mismo texto
    type(e.querySelector('textarea')!, 'important text!')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(osc.saveDraft).toHaveBeenCalledTimes(2)
    expect(osc.saveDraft).toHaveBeenLastCalledWith('d1', { body: 'important text!' })
    expect(e.textContent).toContain('Saved')
  })

  it('el título también se autoguarda', async () => {
    const e = await renderEditor()
    type(e.querySelector('input') as HTMLInputElement, 'CSV export')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(osc.saveDraft).toHaveBeenCalledWith('d1', { title: 'CSV export' })
  })
})

describe('tarea 5.3: contador, límite de 4000 y envío', () => {
  it('con 3200 caracteres: «3200 / 4000» sin advertencia y envío habilitado', async () => {
    currentDraft = mkDraft({ body: 'a'.repeat(3200) })
    const e = await renderEditor()
    expect(e.textContent).toContain('3200 / 4000')
    expect(e.textContent).not.toContain('shorten the draft to send it')
    expect(button(e, 'Explore').disabled).toBe(false)
    expect(button(e, 'Propose').disabled).toBe(false)
  })

  it('con 4210 caracteres: advertencia, envío bloqueado, edición y guardado siguen', async () => {
    currentDraft = mkDraft({ body: 'a'.repeat(4210) })
    const e = await renderEditor()
    expect(e.textContent).toContain('4210 / 4000: shorten the draft to send it')
    expect(button(e, 'Explore').disabled).toBe(true)
    expect(button(e, 'Propose').disabled).toBe(true)
    type(e.querySelector('textarea')!, 'recortado')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(osc.saveDraft).toHaveBeenCalledWith('d1', { body: 'recortado' })
    expect(button(e, 'Explore').disabled).toBe(false)
  })

  it('con el contenido vacío: Propose deshabilitado, Explore disponible', async () => {
    currentDraft = mkDraft({ body: '' })
    const e = await renderEditor()
    expect(button(e, 'Propose').disabled).toBe(true)
    expect(button(e, 'Explore').disabled).toBe(false)
  })

  it('Ctrl+Enter sobre el contenido envía como Propose', async () => {
    currentDraft = mkDraft({ body: 'Añadir exportación a CSV' })
    const e = await renderEditor()
    await act(async () => {
      e.querySelector('textarea')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
      )
    })
    await settle()
    expect(osc.sendDraft).toHaveBeenCalledWith('d1', 'propose')
    // aceptado: el editor pasa a la vista de enviado, sin botones de envío
    expect(e.querySelector('textarea')).toBeNull()
    expect(e.textContent).toContain('Sent as proposal')
    expect(button(e, 'Explore')).toBeUndefined()
    expect(button(e, 'Propose')).toBeUndefined()
  })

  it('Explore envía con el modo explore', async () => {
    currentDraft = mkDraft({ body: 'investigar el costo' })
    const e = await renderEditor()
    await act(async () => {
      button(e, 'Explore').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(osc.sendDraft).toHaveBeenCalledWith('d1', 'explore')
  })
})

describe('tarea 5.4: enviado, duplicado y borrado', () => {
  it('un enviado se muestra en solo lectura con modo y fecha, sin envío', async () => {
    currentDraft = mkDraft({
      status: 'sent',
      sentMode: 'explore',
      sentAt: '2026-11-19T12:30:00.000Z',
      title: 'Exportación CSV',
      body: '# Hello'
    })
    const e = await renderEditor()
    expect(e.querySelector('textarea')).toBeNull()
    expect(e.querySelector('input')).toBeNull() // el título también es de solo lectura
    expect(e.textContent).toContain('Sent as explore')
    expect(button(e, 'Explore')).toBeUndefined()
    expect(button(e, 'Propose')).toBeUndefined()
    expect(button(e, 'Duplicate').disabled).toBe(false)
    expect(button(e, 'Delete').disabled).toBe(false)
    expect(e.querySelector('.doc h1')?.textContent).toBe('Hello')
  })

  it('Duplicate guarda lo pendiente, crea la copia «… (copy)» y la abre', async () => {
    currentDraft = mkDraft({ title: 'Exportación CSV', body: 'Añadir exportación' })
    const e = await renderEditor()
    type(e.querySelector('textarea')!, 'Añadir exportación a CSV del informe')
    await act(async () => {
      button(e, 'Duplicate').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    // la copia parte del texto que se ve (guardado antes de duplicar)
    expect(osc.saveDraft).toHaveBeenCalledWith('d1', {
      body: 'Añadir exportación a CSV del informe'
    })
    expect(osc.duplicateDraft).toHaveBeenCalledWith('d1')
    expect(useStore.getState().browse).toEqual({ kind: 'draft', id: 'd2' })
    expect(osc.draft).toHaveBeenCalledWith('d2')
    expect((e.querySelector('input') as HTMLInputElement).value).toBe('Exportación CSV (copy)')
    expect((e.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Añadir exportación a CSV del informe'
    )
    expect(button(e, 'Propose')).toBeTruthy() // la copia es editable y sin enviar
  })

  it('Delete pide confirmación; al confirmar borra y cierra el editor', async () => {
    const e = await renderEditor()
    click(button(e, 'Delete'))
    expect(e.textContent).toContain('Delete draft')
    expect(osc.deleteDraft).not.toHaveBeenCalled()
    // el segundo botón «Delete» es el del diálogo de confirmación
    await act(async () => {
      button(e, 'Delete', 1).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(osc.deleteDraft).toHaveBeenCalledWith('d1')
    expect(useStore.getState().browse).toBeNull()
    expect(e.textContent).toContain('Nothing open') // DocReview volvió a la vista vacía
  })

  it('cancelar la confirmación conserva el borrador', async () => {
    const e = await renderEditor()
    click(button(e, 'Delete'))
    await act(async () => {
      button(e, 'Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(osc.deleteDraft).not.toHaveBeenCalled()
    expect(useStore.getState().browse).toEqual({ kind: 'draft', id: 'd1' })
    expect(e.querySelector('textarea')).toBeTruthy()
  })
})

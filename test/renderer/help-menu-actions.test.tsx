// @vitest-environment jsdom
// Cableado final del menú Ayuda en el renderer: 'demo-repo' (5.7) abre el diálogo
// del agente y createDemo aplica el workspace y abre el cambio; 'open-data-folder'
// (5.8) llama a window.osc.openDataFolder; 'dependency-diagnostics' (6.4) abre el
// ToolsDialog. 'check-updates' (Fase 9) sigue sin cablear.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DemoRepoOutcome } from '@shared/ipc.ts'
import { DemoRepoDialog } from '../../src/renderer/src/panes/DemoRepoDialog.tsx'
import { ToolsDialog } from '../../src/renderer/src/panes/ToolsDialog.tsx'
import { createDemo, menuAction, useStore } from '../../src/renderer/src/store.ts'

const DEMO = 'C:/tmp/hello-app'
const CHANGE = 'add-hello-endpoint'

const osc = vi.hoisted(() => ({
  createDemoRepo: vi.fn(),
  openDataFolder: vi.fn(),
  config: vi.fn(),
  send: vi.fn()
}))

const outcome = (over: Partial<DemoRepoOutcome> = {}): DemoRepoOutcome => ({
  workspace: {
    roots: [{ path: DEMO, fromEnv: false, truncated: false }],
    repos: [{ id: DEMO, name: 'hello-app', root: DEMO, rel: '', openspec: true, session: null }]
  },
  repo: DEMO,
  change: CHANGE,
  openspecOk: true,
  gitOk: true,
  warnings: [],
  ...over
})

window.osc = {
  config: osc.config,
  createDemoRepo: osc.createDemoRepo,
  openDataFolder: osc.openDataFolder,
  send: osc.send,
  onMessage: () => () => {},
  changes: () =>
    Promise.resolve({
      active: [{ name: CHANGE, files: ['proposal.md', 'tasks.md'] }],
      archived: [],
      specs: [],
      workflows: [],
      reviewInRepo: false
    }),
  file: () => Promise.resolve({ content: '# Add hello' }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false })
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
const toasts = (): string[] => useStore.getState().toasts.map((t) => t.text)
const button = (el: HTMLElement, text: string): HTMLButtonElement =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  osc.createDemoRepo.mockReset()
  osc.openDataFolder.mockReset()
  osc.config.mockReset()
  osc.send.mockReset()
  osc.config.mockResolvedValue({ platform: 'win32', defaultAgent: 'claude', agents: [], tools: [] })
  useStore.setState({
    demoOpen: false,
    diagOpen: false,
    toasts: [],
    repo: null,
    change: null,
    agents: [
      { id: 'claude', label: 'Claude Code', openspecTool: 'claude' },
      { id: 'custom', label: 'Custom', openspecTool: null }
    ],
    defaultAgent: 'claude',
    agent: 'claude'
  })
})

describe("menuAction 'demo-repo' (tarea 5.7)", () => {
  it('abre el diálogo de creación, sin llamar aún a main', () => {
    menuAction('demo-repo')
    expect(useStore.getState().demoOpen).toBe(true)
    expect(osc.createDemoRepo).not.toHaveBeenCalled()
  })

  it('el diálogo propone el agente activo y manda el elegido a main', async () => {
    osc.createDemoRepo.mockResolvedValue(null) // el usuario cierra el selector
    menuAction('demo-repo')
    const el = renderUi(<DemoRepoDialog />)
    const select = el.querySelector('select')!
    expect(select.value).toBe('claude')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, 'custom')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(el.textContent).toContain('without')
    await act(async () => button(el, 'Choose').click())
    await flush()
    expect(osc.createDemoRepo).toHaveBeenCalledWith('custom')
    // cancelar el selector deja el diálogo abierto
    expect(useStore.getState().demoOpen).toBe(true)
  })

  it('createDemo aplica el workspace, selecciona el repo y abre el cambio', async () => {
    osc.createDemoRepo.mockResolvedValue(outcome())
    useStore.setState({ demoOpen: true })
    const ok = await createDemo('claude')
    expect(ok).toBe(true)
    const s = useStore.getState()
    expect(s.repos.map((r) => r.id)).toEqual([DEMO])
    expect(s.repo).toBe(DEMO)
    expect(s.change).toBe(CHANGE)
    expect(s.file).toBe('proposal.md')
    expect(osc.send).toHaveBeenCalledWith({ type: 'subscribe', repo: DEMO })
    expect(toasts()).toContain('Demo repository created')
  })

  it('el éxito cierra el diálogo y los avisos de git/openspec salen como toast', async () => {
    osc.createDemoRepo.mockResolvedValue(outcome({ warnings: ['git not found'] }))
    menuAction('demo-repo')
    const el = renderUi(<DemoRepoDialog />)
    await act(async () => button(el, 'Choose').click())
    await flush()
    expect(osc.createDemoRepo).toHaveBeenCalledWith('claude')
    expect(useStore.getState().demoOpen).toBe(false)
    expect(toasts()).toContain('git not found')
  })

  it('cancelar el selector (null) no toca el workspace', async () => {
    osc.createDemoRepo.mockResolvedValue(null)
    const ok = await createDemo(null)
    expect(ok).toBe(false)
    expect(useStore.getState().repo).toBeNull()
    expect(toasts()).toEqual([])
  })

  it('un error de main se muestra como toast y devuelve false', async () => {
    osc.createDemoRepo.mockRejectedValue(new Error('unknown agent: x'))
    expect(await createDemo('x')).toBe(false)
    expect(toasts()).toContain('unknown agent: x')
  })
})

describe("menuAction 'open-data-folder' (tarea 5.8)", () => {
  it('llama a window.osc.openDataFolder', async () => {
    osc.openDataFolder.mockResolvedValue({ ok: true })
    menuAction('open-data-folder')
    await flush()
    expect(osc.openDataFolder).toHaveBeenCalledTimes(1)
    expect(toasts()).toEqual([])
  })

  it('si main no puede abrirla, lo avisa con un toast', async () => {
    osc.openDataFolder.mockRejectedValue(new Error('could not open the data folder: nope'))
    menuAction('open-data-folder')
    await flush()
    expect(toasts()).toContain('could not open the data folder: nope')
  })
})

describe("menuAction 'dependency-diagnostics' (tarea 6.4)", () => {
  it('abre el ToolsDialog', async () => {
    const el = renderUi(<ToolsDialog />)
    expect(el.textContent).not.toContain('Dependency diagnostics')
    await act(async () => menuAction('dependency-diagnostics'))
    await flush()
    expect(useStore.getState().diagOpen).toBe(true)
    expect(el.textContent).toContain('Dependency diagnostics')
  })
})

describe("menuAction 'check-updates' (Fase 9)", () => {
  it('sigue sin cablear: solo avisa', () => {
    menuAction('check-updates')
    expect(toasts().some((t) => t.includes('check-updates'))).toBe(true)
    expect(osc.createDemoRepo).not.toHaveBeenCalled()
    expect(osc.openDataFolder).not.toHaveBeenCalled()
  })
})

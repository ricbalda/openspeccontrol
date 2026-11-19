// @vitest-environment jsdom
// Fase 5 in the renderer: markdown links go through window.osc.openExternal
// (and never navigate the page), setTheme mirrors the choice onto the native
// theme, a permission that arrives unfocused asks the main for an `attention`
// notification, and browseRoot applies the folder the native dialog picked.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import Markdown from 'react-markdown'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg, ServerMsg } from '@shared/protocol.ts'
import { ExternalAnchor } from '../../src/renderer/src/lib/ExternalLink.tsx'
import { boot, browseRoot, setTheme, useStore } from '../../src/renderer/src/store.ts'

const APP = 'C:/repos/app'
const WORK = 'C:/repos'

const osc = vi.hoisted(() => ({
  openExternal: vi.fn(async () => ({ opened: true })),
  notify: vi.fn(async () => ({ ok: true as const })),
  setNativeTheme: vi.fn(async () => ({ ok: true as const })),
  pickFolder: vi.fn()
}))

let server: ((m: ServerMsg) => void) | null = null
const sends: ClientMsg[] = []

window.osc = {
  config: () =>
    Promise.resolve({
      platform: 'win32',
      defaultAgent: 'fake',
      agents: [{ id: 'fake', label: 'Fake', openspecTool: null }]
    }),
  repos: () =>
    Promise.resolve({
      roots: [{ path: WORK, fromEnv: false, truncated: false }],
      repos: [{ id: APP, name: 'app', root: WORK, rel: 'app', openspec: true, session: null }]
    }),
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  send: (m) => sends.push(m),
  onMessage: (cb) => {
    server = cb
    return () => {}
  },
  openExternal: osc.openExternal,
  notify: osc.notify,
  setNativeTheme: osc.setNativeTheme,
  pickFolder: osc.pickFolder
} as unknown as typeof window.osc

let root: Root | null = null
const renderUi = (ui: React.ReactNode): HTMLElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(ui))
  return el
}

beforeEach(() => {
  osc.openExternal.mockClear()
  osc.notify.mockClear()
  osc.setNativeTheme.mockClear()
  osc.pickFolder.mockReset()
})

describe('markdown links (tarea 5.5)', () => {
  it('an anchor click goes to openExternal and never navigates', () => {
    const el = renderUi(<ExternalAnchor href="https://example.com/docs">docs</ExternalAnchor>)
    const a = el.querySelector('a')!
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => a.dispatchEvent(click))
    expect(osc.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(click.defaultPrevented).toBe(true)
  })

  it('file: and javascript: links do nothing', () => {
    const el = renderUi(
      <>
        <ExternalAnchor href="file:///C:/Windows/system.ini">f</ExternalAnchor>
        <ExternalAnchor href="javascript:alert(1)">j</ExternalAnchor>
      </>
    )
    for (const a of el.querySelectorAll('a')) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      act(() => a.dispatchEvent(click))
      expect(click.defaultPrevented).toBe(true) // no navigation either
    }
    expect(osc.openExternal).not.toHaveBeenCalled()
  })

  it('react-markdown wires the component map the panes use', () => {
    const el = renderUi(
      <Markdown components={{ a: ExternalAnchor }}>
        {'see [the docs](https://example.com)'}
      </Markdown>
    )
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com')
    act(() => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(osc.openExternal).toHaveBeenCalledWith('https://example.com')
  })
})

describe('setTheme (tarea 5.6)', () => {
  it('mirrors the choice onto the native theme', () => {
    setTheme('dark')
    expect(osc.setNativeTheme).toHaveBeenCalledWith('dark')
    setTheme('system')
    expect(osc.setNativeTheme).toHaveBeenCalledWith('system')
  })
})

describe('notifications through the main (tarea 5.3)', () => {
  it('a permission that arrives unfocused asks for an attention notification', async () => {
    localStorage.setItem('repo', APP)
    await boot()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    server!({
      type: 'event',
      repo: APP,
      entry: { seq: 2, at: '2026-11-18T10:00:01.000Z', event: { kind: 'permission' } }
    } as never)
    expect(osc.notify).toHaveBeenCalledWith({
      title: 'OpenSpecControl',
      body: 'The agent needs your decision',
      kind: 'attention'
    })
  })
})

describe('browseRoot (tarea 5.2)', () => {
  it('applies the workspace the native picker added', async () => {
    const NEW = 'C:/other'
    osc.pickFolder.mockResolvedValue({
      roots: [{ path: NEW, fromEnv: false, truncated: false }],
      repos: []
    })
    await expect(browseRoot()).resolves.toBe(true)
    expect(useStore.getState().roots.map((r) => r.path)).toContain(NEW)
  })

  it('a cancelled dialog changes nothing', async () => {
    osc.pickFolder.mockResolvedValue(null)
    const before = useStore.getState().roots
    await expect(browseRoot()).resolves.toBe(false)
    expect(useStore.getState().roots).toBe(before)
  })
})

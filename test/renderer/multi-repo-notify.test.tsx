// @vitest-environment jsdom
// multi-repo-rail, fase 4: avisos en segundo plano (design.md D-J). El aviso de
// decisión pendiente y el de fin de turno de un repo no activo nombran el repo,
// con la ventana con foco no hay notificación del sistema, y el título de la
// ventana cuenta las decisiones pendientes de todos los repos abiertos.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientMsg,
  LoggedEvent,
  ServerMsg,
  SessionState,
  SessionStatus
} from '@shared/protocol.ts'
import { boot, useStore } from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'
import { AgentPanel } from '../../src/renderer/src/panes/AgentPanel.tsx'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []
let server: ((m: ServerMsg) => void) | null = null

const osc = vi.hoisted(() => ({ notify: vi.fn(async () => ({ ok: true as const })) }))

const repoInfo = (id: string) => ({
  id,
  name: id.split('/').pop()!,
  root: 'C:/repos',
  rel: id.split('/').pop()!,
  openspec: true,
  session: null
})

window.osc = {
  config: () =>
    Promise.resolve({
      platform: 'win32',
      defaultAgent: 'fake',
      agents: [{ id: 'fake', label: 'Fake', openspecTool: null }]
    }),
  updateState: () => Promise.resolve(null),
  repos: () =>
    Promise.resolve({
      roots: [{ path: 'C:/repos', fromEnv: false, truncated: false }],
      repos: [A, B].map(repoInfo)
    }),
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  file: () => Promise.resolve({ content: '# doc' }),
  notify: osc.notify,
  send: (m) => sends.push(m),
  onMessage: (cb) => {
    server = cb
    return () => {}
  }
} as unknown as typeof window.osc

const session = (status: SessionStatus, repo: string, pendingInteractions = 0): SessionState => ({
  repo,
  agent: 'fake',
  status,
  sessionId: null,
  configOptions: [],
  pendingInteractions,
  context: null
})

const view = (over: Partial<RepoView> = {}): RepoView => ({
  session: null,
  changes: [],
  archived: [],
  specs: [],
  workflows: [],
  reviewInRepo: false,
  browse: null,
  git: null,
  changesLoaded: false,
  change: null,
  file: null,
  ...over
})

/** Coloca el store como si esos repos estuvieran abiertos con `active` activo. */
const arrange = (active: string, open: string[], views: Record<string, RepoView> = {}) => {
  const v = views[active] ?? view()
  useStore.setState({
    repo: active,
    openRepos: open,
    views,
    session: v.session,
    changes: v.changes,
    archived: v.archived,
    specs: v.specs,
    workflows: v.workflows,
    reviewInRepo: v.reviewInRepo,
    browse: v.browse,
    git: v.git,
    changesLoaded: v.changesLoaded,
    change: v.change,
    file: v.file,
    events: [],
    doneUnseen: false
  })
}

const at = '2026-11-19T10:00:00.000Z'
const permissionEntry = (seq: number): LoggedEvent => ({
  seq,
  at,
  event: {
    kind: 'permission',
    id: `p${seq}`,
    toolCall: null,
    options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }]
  }
})
const permissionOf = (repo: string, seq: number): ServerMsg => ({
  type: 'event',
  repo,
  entry: permissionEntry(seq)
})
const turnEndOf = (repo: string, seq: number): ServerMsg => ({
  type: 'event',
  repo,
  entry: { seq, at, event: { kind: 'turn_end', stopReason: 'end_turn' } }
})

beforeAll(async () => {
  localStorage.setItem('repo', A)
  await boot() // conecta onServer con el puente simulado
})

let root: Root | null = null
const renderPanel = (): HTMLElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<AgentPanel />))
  return el
}

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  osc.notify.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks() // devuelve hasFocus al real
})

describe('avisos de un repo en segundo plano (tarea 4.1)', () => {
  it('un permiso de B sin foco notifica con el nombre del repo', () => {
    arrange(A, [A, B])
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    server!(permissionOf(B, 1))
    expect(osc.notify).toHaveBeenCalledTimes(1)
    expect(osc.notify).toHaveBeenCalledWith({
      title: 'Needs your decision · blog',
      body: 'The agent',
      kind: 'attention'
    })
  })

  it('una elicitation de B sin foco también nombra el repo', () => {
    arrange(A, [A, B])
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    server!({
      type: 'event',
      repo: B,
      entry: {
        seq: 2,
        at,
        event: { kind: 'elicitation', id: 'e1', message: 'Which one?', schema: {} }
      }
    })
    expect(osc.notify).toHaveBeenCalledWith({
      title: 'Needs your decision · blog',
      body: 'The agent',
      kind: 'attention'
    })
  })

  it('con la ventana con foco no hay notificación del sistema', () => {
    arrange(A, [A, B])
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    server!(permissionOf(B, 1))
    server!(turnEndOf(B, 2))
    expect(osc.notify).not.toHaveBeenCalled()
    expect(useStore.getState().doneUnseen).toBe(false) // sigue siendo solo del activo
  })

  it('un turn_end de B sin foco nombra el repo y no toca el transcript del activo', () => {
    arrange(A, [A, B])
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    server!(turnEndOf(B, 3))
    expect(osc.notify).toHaveBeenCalledWith({
      title: 'Done · blog',
      body: 'The agent',
      kind: 'info'
    })
    expect(useStore.getState().events).toEqual([])
  })

  it('el aviso de decisión del repo activo (repo único) no cambia', () => {
    arrange(A, [A])
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    server!(permissionOf(A, 1))
    expect(osc.notify).toHaveBeenCalledWith({
      title: 'OpenSpecControl',
      body: 'The agent needs your decision',
      kind: 'attention'
    })
  })
})

describe('título de la ventana (tarea 4.2)', () => {
  it('cuenta las decisiones pendientes de todos los repos abiertos', () => {
    // A (activo) tiene 1 decisión sin resolver en su transcript; B, en segundo
    // plano, tiene 2 pendientes según su sesión
    arrange(A, [A, B], { [B]: view({ session: session('busy', B, 2) }) })
    useStore.setState({ events: [permissionEntry(1)] })
    renderPanel()
    expect(document.title).toBe('(3) Needs you · OpenSpecControl')
  })

  it('con un solo repo el título cuenta solo lo suyo', () => {
    arrange(A, [A])
    useStore.setState({ events: [permissionEntry(1)] })
    renderPanel()
    expect(document.title).toBe('(1) Needs you · OpenSpecControl')
  })

  it('sin decisiones pendientes el título vuelve al normal', () => {
    arrange(A, [A, B], { [B]: view({ session: session('ready', B, 0) }) })
    renderPanel()
    expect(document.title).toBe('OpenSpecControl')
  })
})

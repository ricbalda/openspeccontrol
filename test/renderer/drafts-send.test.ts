// @vitest-environment jsdom
// Tarea 3.2 (add-proposal-drafts): store.sendDraft activa el repo, conecta el
// agente ANTES de enviar (ensureAgent, como runAction), muestra el fallo con
// guard y, tras un envío válido, recarga la lista y el borrador abierto. Si
// ensureAgent falla no cambia el estado.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg, ServerMsg, SessionState, SessionStatus } from '@shared/protocol.ts'
import type { Draft, DraftSummary } from '@shared/ipc.ts'
import { boot, sendDraft, useStore } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []
let server: ((m: ServerMsg) => void) | null = null

const session = (status: SessionStatus, repo: string): SessionState => ({
  repo,
  agent: 'fake',
  status,
  sessionId: null,
  configOptions: [],
  pendingInteractions: 0,
  context: null
})

const summary = (id: string, over: Partial<DraftSummary> = {}): DraftSummary => ({
  id,
  repo: A,
  title: 'Exportación CSV',
  status: 'draft',
  sentMode: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  sentAt: null,
  length: 10,
  ...over
})

const sentDraft = (id: string): Draft => ({
  ...summary(id, { status: 'sent', sentMode: 'propose', sentAt: '2026-11-19T11:00:00.000Z' }),
  body: 'Añadir exportación a CSV'
})

const osc = vi.hoisted(() => ({
  drafts: vi.fn(),
  draft: vi.fn(),
  sendDraft: vi.fn()
}))

window.osc = {
  config: () =>
    Promise.resolve({
      platform: 'win32',
      defaultAgent: 'fake',
      agents: [{ id: 'fake', label: 'Fake', openspecTool: null }]
    }),
  repos: () =>
    Promise.resolve({
      roots: [{ path: 'C:/repos', fromEnv: false, truncated: false }],
      repos: [A, B].map((id) => ({
        id,
        name: id.split('/').pop()!,
        root: 'C:/repos',
        rel: id.split('/').pop()!,
        openspec: true,
        session: null
      }))
    }),
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  file: () => Promise.resolve({ content: '' }),
  drafts: osc.drafts,
  draft: osc.draft,
  sendDraft: osc.sendDraft,
  send: (m) => sends.push(m),
  onMessage: (cb) => {
    server = cb
    return () => {}
  }
} as unknown as typeof window.osc

beforeAll(async () => {
  await boot()
})

beforeEach(() => {
  sends.length = 0
  osc.drafts.mockReset().mockResolvedValue([summary('d1')])
  osc.draft.mockReset().mockResolvedValue(sentDraft('d1'))
  osc.sendDraft.mockReset().mockResolvedValue(sentDraft('d1'))
})

/** Coloca A activo con B abierto y la proyección indicada. */
const arrange = (over: Partial<Parameters<typeof useStore.setState>[0]> = {}) => {
  useStore.setState({
    repo: A,
    openRepos: [A, B],
    views: { [A]: {}, [B]: {} } as never,
    session: null,
    browse: null,
    draftsByRepo: {},
    toasts: [],
    events: [],
    ...over
  })
}

describe('store.sendDraft (tarea 3.2, design D-5)', () => {
  it('conecta el agente antes de enviar: nada sale hasta que la sesión está lista', async () => {
    arrange({ session: session('exited', A) })
    const p = sendDraft('d1', 'propose')
    // ensureAgent arrancó el agente… y todavía no se envió nada
    expect(sends).toContainEqual({ type: 'start', repo: A, agent: 'fake', resume: true })
    expect(osc.sendDraft).not.toHaveBeenCalled()
    server!({ type: 'session', repo: A, session: session('ready', A) })
    await expect(p).resolves.toBe(true)
    expect(osc.sendDraft).toHaveBeenCalledWith('d1', 'propose')
  })

  it('si ensureAgent falla no envía nada y no cambia el estado', async () => {
    arrange({
      session: session('busy', A),
      browse: { kind: 'draft', id: 'd1' },
      draftsByRepo: { [A]: [summary('d1')] }
    })
    await expect(sendDraft('d1', 'explore')).resolves.toBe(false)
    expect(osc.sendDraft).not.toHaveBeenCalled()
    expect(osc.drafts).not.toHaveBeenCalled() // sin recargar la lista…
    expect(osc.draft).not.toHaveBeenCalled() // …ni el borrador abierto
    const s = useStore.getState()
    expect(s.browse).toEqual({ kind: 'draft', id: 'd1' })
    expect(s.draftsByRepo[A]).toEqual([summary('d1')])
    expect(s.toasts.at(-1)).toMatchObject({ level: 'error' }) // avisó del agente ocupado
  })

  it('tras un envío válido recarga la lista y el borrador abierto', async () => {
    arrange({ session: session('ready', A), browse: { kind: 'draft', id: 'd1' } })
    await expect(sendDraft('d1', 'propose')).resolves.toBe(true)
    expect(osc.sendDraft).toHaveBeenCalledWith('d1', 'propose')
    expect(osc.drafts).toHaveBeenCalledWith(A, undefined)
    // el openDraft real solo fija browse (el DraftEditor de la fase 5 carga el
    // borrador): el enviado sigue abierto y el historial quedó recargado
    expect(useStore.getState().browse).toEqual({ kind: 'draft', id: 'd1' })
    expect(useStore.getState().draftsByRepo[A]).toEqual([summary('d1')])
  })

  it('un borrador de un repo en segundo plano activa ese repo antes de enviar', async () => {
    arrange({
      views: {
        [A]: { session: session('ready', A) } as never,
        [B]: { session: session('ready', B) } as never
      }
    })
    await expect(sendDraft('d9', 'explore', B)).resolves.toBe(true)
    expect(useStore.getState().repo).toBe(B)
    expect(osc.sendDraft).toHaveBeenCalledWith('d9', 'explore')
    expect(osc.drafts).toHaveBeenCalledWith(B, undefined)
  })

  it('un fallo del núcleo se muestra con guard y no recarga nada', async () => {
    arrange({ session: session('ready', A) })
    osc.sendDraft.mockRejectedValueOnce(new Error('draft already sent'))
    await expect(sendDraft('d1', 'propose')).resolves.toBe(false)
    expect(useStore.getState().toasts.at(-1)).toMatchObject({
      text: 'draft already sent',
      level: 'error'
    })
    expect(osc.drafts).not.toHaveBeenCalled()
  })
})

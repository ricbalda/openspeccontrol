// @vitest-environment jsdom
// add-proposal-drafts (tarea 4.2): el store guarda el historial de borradores por
// repo (draftsByRepo), abre un borrador con browse { kind: 'draft' } y «New draft»
// en un repo en segundo plano activa ese repo antes y crea el borrador en él. Las
// respuestas tardías (de un repo cerrado o de una consulta sustituida) no se pintan.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMsg } from '@shared/protocol.ts'
import type { Draft, DraftSummary } from '@shared/ipc.ts'
import {
  closeRepo,
  createDraft,
  loadDrafts,
  openDraft,
  useStore
} from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []

const repoInfo = (id: string) => ({
  id,
  name: id.split('/').pop()!,
  root: 'C:/repos',
  rel: id.split('/').pop()!,
  openspec: true,
  session: null
})

const NOW = '2026-11-19T10:00:00.000Z'

const summary = (over: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1',
  repo: A,
  title: 'Exportación CSV',
  status: 'draft',
  sentMode: null,
  createdAt: NOW,
  updatedAt: NOW,
  sentAt: null,
  length: 30,
  ...over
})

const draftsApi = vi.fn(
  async (_repo: string, _query?: string): Promise<DraftSummary[]> => [] as DraftSummary[]
)
const createDraftApi = vi.fn(async (repo: string): Promise<Draft> => ({
  ...summary({ id: 'new-1', repo, title: '', length: 0 }),
  body: ''
}))

window.osc = {
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  file: () => Promise.resolve({ content: '' }),
  drafts: (repo: string, query?: string) => draftsApi(repo, query),
  createDraft: (repo: string) => createDraftApi(repo),
  send: (m) => sends.push(m),
  onMessage: () => () => {}
} as unknown as typeof window.osc

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

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
  changesStale: false,
  changesError: null,
  change: null,
  file: null,
  ...over
})

/** Coloca el store como si los repos estuvieran abiertos con esas vistas y `active` activo. */
const arrange = (active: string, open: string[], views: Record<string, RepoView> = {}) => {
  const v = views[active] ?? view()
  useStore.setState({
    repo: active,
    openRepos: open,
    views,
    collapsed: [],
    draftsByRepo: {},
    repos: [A, B].map(repoInfo),
    roots: [{ path: 'C:/repos', fromEnv: false, truncated: false }],
    reposLoaded: true,
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
    content: '',
    comments: [],
    rounds: [],
    events: [],
    doneUnseen: false
  })
}

beforeEach(() => {
  sends.length = 0
  draftsApi.mockClear()
  draftsApi.mockImplementation(async () => [] as DraftSummary[])
  createDraftApi.mockClear()
  createDraftApi.mockImplementation(async (repo: string): Promise<Draft> => ({
    ...summary({ id: 'new-1', repo, title: '', length: 0 }),
    body: ''
  }))
  arrange(A, [A, B])
})

describe('tarea 4.2: loadDrafts y openDraft', () => {
  it('loadDrafts guarda el historial del repo y le pasa la consulta al núcleo', async () => {
    const list = [summary({ id: 'y', repo: A })]
    draftsApi.mockResolvedValueOnce(list)
    await loadDrafts(A, 'export')
    expect(draftsApi).toHaveBeenCalledWith(A, 'export')
    expect(useStore.getState().draftsByRepo[A]).toEqual(list)
  })

  it('una consulta vacía llega al núcleo como undefined (sin filtro)', async () => {
    await loadDrafts(A)
    expect(draftsApi).toHaveBeenLastCalledWith(A, undefined)
    expect(useStore.getState().draftsByRepo[A]).toEqual([])
  })

  it('un fallo al cargar no cambia el historial ni lanza', async () => {
    useStore.setState({ draftsByRepo: { [A]: [summary()] } })
    draftsApi.mockRejectedValueOnce(new Error('boom'))
    await expect(loadDrafts(A)).resolves.toBeUndefined()
    expect(useStore.getState().draftsByRepo[A]).toEqual([summary()])
  })

  it('openDraft fija browse { kind: "draft" } y cierra lo que hubiera abierto', () => {
    arrange(A, [A, B], { [A]: view({ change: 'add-x', file: 'proposal.md' }) })
    openDraft('d9')
    const s = useStore.getState()
    expect(s.browse).toEqual({ kind: 'draft', id: 'd9' })
    expect(s.change).toBeNull()
    expect(s.file).toBeNull()
    expect(s.content).toBe('')
  })
})

describe('tarea 4.2: «New draft» y respuestas tardías', () => {
  it('«New draft» en un repo en segundo plano lo activa y crea el borrador allí', async () => {
    const fresh = summary({ id: 'new-1', repo: B, title: '', length: 0 })
    draftsApi.mockResolvedValueOnce([fresh])
    await createDraft(B)
    expect(createDraftApi).toHaveBeenCalledWith(B) // el borrador pertenece a B
    await tick() // createDraft recarga el historial sin await
    const s = useStore.getState()
    expect(s.repo).toBe(B) // B pasa a ser el activo
    expect(s.browse).toEqual({ kind: 'draft', id: 'new-1' }) // y se abre en el editor
    expect(draftsApi).toHaveBeenCalledWith(B, undefined)
    expect(s.draftsByRepo[B]).toEqual([fresh]) // el historial de B lo lista
  })

  it('una respuesta tardía de un repo cerrado mientras cargaba no se pinta', async () => {
    const d = deferred<DraftSummary[]>()
    draftsApi.mockImplementationOnce(() => d.promise)
    const p = loadDrafts(A)
    await closeRepo(A) // A se cierra con la carga en vuelo; B queda activo
    expect(useStore.getState().repo).toBe(B)
    d.resolve([summary({ id: 'z', repo: A })])
    await p
    expect(useStore.getState().draftsByRepo[A]).toBeUndefined()
  })

  it('la lista de un repo en segundo plano no pisa la del activo', async () => {
    draftsApi.mockResolvedValueOnce([summary({ id: 'a1', repo: A })])
    await loadDrafts(A)
    draftsApi.mockResolvedValueOnce([summary({ id: 'b1', repo: B })])
    await loadDrafts(B) // B sigue en segundo plano
    const { draftsByRepo } = useStore.getState()
    expect(useStore.getState().repo).toBe(A)
    expect(draftsByRepo[A]?.map((x) => x.id)).toEqual(['a1'])
    expect(draftsByRepo[B]?.map((x) => x.id)).toEqual(['b1'])
  })

  it('una consulta anterior del mismo repo no sobrescribe la última', async () => {
    const slow = deferred<DraftSummary[]>()
    draftsApi.mockImplementationOnce(() => slow.promise) // 'exp', lenta
    draftsApi.mockResolvedValueOnce([summary({ id: 'latest' })]) // 'export', rápida
    const p1 = loadDrafts(A, 'exp')
    await loadDrafts(A, 'export')
    expect(useStore.getState().draftsByRepo[A]?.map((x) => x.id)).toEqual(['latest'])
    slow.resolve([summary({ id: 'stale' })])
    await p1
    expect(useStore.getState().draftsByRepo[A]?.map((x) => x.id)).toEqual(['latest'])
  })
})

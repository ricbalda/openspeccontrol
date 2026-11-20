// @vitest-environment jsdom
// add-proposal-drafts (tarea 4.1): la sección Drafts del rail, junto a Specs y
// Archived: plegable, con «New draft», el buscador (espera de 250 ms entre teclas),
// la lista con título (o «Untitled draft»), fecha relativa e insignia
// «Sent · explore/propose», y los avisos de sin borradores y de sin coincidencias
// con «Clear search» (design D-6). La búsqueda sin acentos la resuelve el núcleo
// (D-2): aquí se comprueba que la consulta llega a api.drafts tal cual.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSummary, ClientMsg } from '@shared/protocol.ts'
import type { Draft, DraftSummary } from '@shared/ipc.ts'
import { RepoRail } from '../../src/renderer/src/panes/RepoRail.tsx'
import { useStore } from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const draft = (id: string, over: Partial<DraftSummary> = {}): DraftSummary => ({
  id,
  repo: A,
  title: `Draft ${id}`,
  status: 'draft',
  sentMode: null,
  createdAt: hoursAgo(48),
  updatedAt: hoursAgo(24),
  sentAt: null,
  length: 42,
  ...over
})

// eco del historial actual del store; los tests concretos lo reprograman
const draftsApi = vi.fn(
  async (repo: string, _query?: string): Promise<DraftSummary[]> =>
    useStore.getState().draftsByRepo[repo] ?? []
)
const createDraftApi = vi.fn(async (repo: string): Promise<Draft> => ({
  ...draft('new-1', { repo, title: '', updatedAt: hoursAgo(0) }),
  body: ''
}))

window.osc = {
  send: (m) => sends.push(m),
  onMessage: () => () => {},
  // eco del estado actual: la revalidación en segundo plano no cambia nada
  changes: (repo: string) => {
    const s = useStore.getState()
    const active = s.repo === repo ? s.changes : (s.views[repo]?.changes ?? [])
    return Promise.resolve({ active, archived: [], specs: [], workflows: [], reviewInRepo: false })
  },
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  file: () => Promise.resolve({ content: '' }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  drafts: (repo: string, query?: string) => draftsApi(repo, query),
  createDraft: (repo: string) => createDraftApi(repo)
} as unknown as typeof window.osc

let root: Root | null = null
const renderRail = (): HTMLElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<RepoRail />))
  return el
}

const repoInfo = (id: string) => ({
  id,
  name: id.split('/').pop()!,
  root: 'C:/repos',
  rel: id.split('/').pop()!,
  openspec: true,
  session: null
})

const change = (name: string): ChangeSummary => ({
  name,
  completedTasks: 0,
  totalTasks: 0,
  lastModified: '',
  status: 'in-progress',
  artifacts: [],
  isPlanningComplete: false,
  isComplete: false,
  files: [`${name}.md`],
  stage: 'draft',
  openComments: 0,
  validation: null,
  stale: [],
  nextTask: null
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
  changesStale: false,
  changesError: null,
  change: null,
  file: null,
  ...over
})

/** Coloca el store como si los repos estuvieran abiertos con esas vistas y `active` activo. */
function arrange(active: string, open: string[], views: Record<string, RepoView> = {}) {
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

/** Despliega la sección Drafts de la sección de un repo (arranca plegada). */
const expandDrafts = (section: HTMLElement) => {
  const btn = [...section.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.trim().startsWith('Drafts')
  )!
  act(() => btn.click())
}

/** Escribe en un input controlado de React y despacha su evento. */
const typeInto = (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  sends.length = 0
  draftsApi.mockClear()
  draftsApi.mockImplementation(
    async (repo: string, _query?: string): Promise<DraftSummary[]> =>
      useStore.getState().draftsByRepo[repo] ?? []
  )
  createDraftApi.mockClear()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tarea 4.1: historial de borradores', () => {
  it('la sección es plegable y lista el historial en orden, el más reciente primero', () => {
    arrange(A, [A], {
      [A]: view({ changes: [change('add-x')], changesLoaded: true, specs: [] })
    })
    useStore.setState({
      draftsByRepo: {
        [A]: [
          draft('y', { title: 'Publicado hoy', updatedAt: hoursAgo(1) }),
          draft('x', { title: 'Tocado ayer', updatedAt: hoursAgo(30) })
        ]
      }
    })
    const el = renderRail()
    const sa = el.querySelector<HTMLElement>(`[data-repo="${A}"]`)!
    expect(sa.textContent).toContain('Drafts') // junto a Specs y Archived
    expect(sa.querySelector('[data-draft-id="y"]')).toBeNull() // plegada de inicio
    expandDrafts(sa)
    const ids = [...sa.querySelectorAll('[data-draft-id]')].map((n) =>
      n.getAttribute('data-draft-id')!
    )
    expect(ids).toEqual(['y', 'x']) // orden por modificación descendente
  })

  it('con la sección plegada, el contador refleja los borradores guardados (se cargan al montar)', async () => {
    arrange(A, [A], { [A]: view({ changesLoaded: true }) })
    // el núcleo ya tiene un borrador de un arranque anterior; el store aún no lo conoce
    draftsApi.mockImplementation(async () => [draft('old', { title: 'De ayer' })])
    const el = renderRail()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const sa = el.querySelector<HTMLElement>(`[data-repo="${A}"]`)!
    const toggle = [...sa.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith('Drafts')
    )!
    expect(toggle.textContent?.replace(/\s+/g, '')).toBe('Drafts1') // sin desplegar
    expect(sa.querySelector('[data-draft-id="old"]')).toBeNull() // sigue plegada
    expandDrafts(sa)
    expect(sa.querySelector('[data-draft-id="old"]')).not.toBeNull()
  })

  it('un título vacío se muestra como «Untitled draft» sin guardarse', () => {
    arrange(A, [A], { [A]: view({ changesLoaded: true }) })
    useStore.setState({
      draftsByRepo: { [A]: [draft('t', { title: '', updatedAt: hoursAgo(0) })] }
    })
    const el = renderRail()
    const sa = el.querySelector<HTMLElement>(`[data-repo="${A}"]`)!
    expandDrafts(sa)
    expect(sa.textContent).toContain('Untitled draft')
    // el título guardado sigue vacío: lo que viaja al núcleo es lo del store
    expect(useStore.getState().draftsByRepo[A]![0]!.title).toBe('')
  })

  it('los enviados llevan la insignia «Sent · modo» y los demás no llevan ninguna', () => {
    arrange(A, [A], { [A]: view({ changesLoaded: true }) })
    useStore.setState({
      draftsByRepo: {
        [A]: [
          draft('e', {
            status: 'sent',
            sentMode: 'explore',
            sentAt: hoursAgo(2),
            updatedAt: hoursAgo(2)
          }),
          draft('p', {
            status: 'sent',
            sentMode: 'propose',
            sentAt: hoursAgo(3),
            updatedAt: hoursAgo(3)
          }),
          draft('w', { updatedAt: hoursAgo(0) })
        ]
      }
    })
    const el = renderRail()
    const sa = el.querySelector<HTMLElement>(`[data-repo="${A}"]`)!
    expandDrafts(sa)
    const sent = sa.querySelector('[data-draft-id="e"]')!
    expect(sent.textContent).toContain('Sent · explore')
    expect(sa.querySelector('[data-draft-id="p"]')!.textContent).toContain('Sent · propose')
    expect(sa.querySelector('[data-draft-id="w"]')!.textContent).not.toContain('Sent')
    // fecha relativa de la última modificación
    expect(sent.textContent).toContain('2h ago')
    expect(sa.querySelector('[data-draft-id="w"]')!.textContent).toContain('just now')
  })
})

describe('tarea 4.1: buscador de la sección', () => {
  it('espera 250 ms entre teclas y le pasa la consulta al núcleo una sola vez', async () => {
    vi.useFakeTimers()
    const full = [draft('a', { title: 'Exportación CSV' }), draft('b', { title: 'Otra cosa' })]
    arrange(A, [A], { [A]: view({ changesLoaded: true }) })
    useStore.setState({ draftsByRepo: { [A]: full } })
    const el = renderRail()
    const sa = el.querySelector<HTMLElement>(`[data-repo="${A}"]`)!
    expandDrafts(sa)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(draftsApi).toHaveBeenCalledWith(A, undefined) // carga al desplegar
    draftsApi.mockImplementationOnce(async () => [full[0]!]) // el núcleo filtra (D-2)
    const input = sa.querySelector<HTMLInputElement>('input[aria-label="Search drafts"]')!
    typeInto(input, 'e')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    typeInto(input, 'ex')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(draftsApi).not.toHaveBeenCalledWith(A, 'e') // aún dentro de la espera
    expect(draftsApi).not.toHaveBeenCalledWith(A, 'ex')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50) // 250 ms desde la última tecla
    })
    expect(draftsApi).toHaveBeenCalledTimes(2) // despliegue + una única búsqueda
    expect(draftsApi).toHaveBeenLastCalledWith(A, 'ex')
    expect(sa.querySelector('[data-draft-id="a"]')).not.toBeNull() // solo el que coincide
    expect(sa.querySelector('[data-draft-id="b"]')).toBeNull()
  })

  it('sin coincidencias lo avisa y «Clear search» recupera el historial completo', async () => {
    vi.useFakeTimers()
    const full = [draft('a', { title: 'Exportación CSV' })]
    // el núcleo filtra: «kubernetes» no está en ningún borrador (D-2)
    draftsApi.mockImplementation(async (_repo: string, q?: string) => (q ? [] : full))
    arrange(A, [A], { [A]: view({ changesLoaded: true }) })
    useStore.setState({ draftsByRepo: { [A]: full } })
    const el = renderRail()
    const sa = el.querySelector<HTMLElement>(`[data-repo="${A}"]`)!
    expandDrafts(sa)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const input = sa.querySelector<HTMLInputElement>('input[aria-label="Search drafts"]')!
    typeInto(input, 'kubernetes')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(sa.textContent).toContain('No drafts match "kubernetes"')
    act(() => {
      ;[...sa.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === 'Clear search')!
        .click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // sin consulta, recarga al instante
    })
    expect(sa.textContent).not.toContain('No drafts match')
    expect(sa.querySelector('[data-draft-id="a"]')).not.toBeNull()
    expect(draftsApi).toHaveBeenLastCalledWith(A, undefined)
  })
})

describe('tarea 4.1: estados vacíos y acciones de la sección', () => {
  it('un repo sin borradores muestra «New draft» y el aviso, sin buscador', () => {
    arrange(A, [A, B], {
      [A]: view({ changesLoaded: true, specs: [] }),
      [B]: view({ changesLoaded: true })
    })
    useStore.setState({ draftsByRepo: { [B]: [] } }) // B cargó: no tiene ninguno
    const el = renderRail()
    const sb = el.querySelector<HTMLElement>(`[data-repo="${B}"]`)!
    expandDrafts(sb)
    expect(
      sb.querySelector<HTMLButtonElement>('button[title^="Create an empty draft"]')
    ).not.toBeNull()
    expect(sb.textContent).toContain('No drafts yet.')
    expect(sb.querySelector('input[aria-label="Search drafts"]')).toBeNull()
  })

  it('«New draft» en un repo en segundo plano lo activa y crea el borrador allí', async () => {
    arrange(A, [A, B], {
      [A]: view({ changes: [change('add-a')], changesLoaded: true }),
      [B]: view({ changesLoaded: true })
    })
    const el = renderRail()
    const sb = el.querySelector<HTMLElement>(`[data-repo="${B}"]`)!
    expandDrafts(sb)
    await act(async () => {
      ;[...sb.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('New draft'))!
        .click()
    })
    expect(createDraftApi).toHaveBeenCalledWith(B) // el borrador pertenece a B
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)) // createDraft recarga el historial sin await
    })
    const s = useStore.getState()
    expect(s.repo).toBe(B) // B pasa a ser el activo (D-D)
    expect(s.browse).toEqual({ kind: 'draft', id: 'new-1' })
    expect(s.views[A]).toBeDefined() // A sigue abierto
  })

  it('abrir un borrador de un repo en segundo plano lo activa antes (D-D)', () => {
    arrange(A, [A, B], { [A]: view({ changesLoaded: true }) })
    useStore.setState({ draftsByRepo: { [B]: [draft('b1', { repo: B })] } })
    const el = renderRail()
    const sb = el.querySelector<HTMLElement>(`[data-repo="${B}"]`)!
    expandDrafts(sb)
    act(() => sb.querySelector<HTMLElement>('[data-draft-id="b1"] button')!.click())
    const s = useStore.getState()
    expect(s.repo).toBe(B)
    expect(s.browse).toEqual({ kind: 'draft', id: 'b1' })
  })
})

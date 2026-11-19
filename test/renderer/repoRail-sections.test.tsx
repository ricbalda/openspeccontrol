// @vitest-environment jsdom
// multi-repo-rail, fase 3 (tareas 3.1 y 3.2): el rail renderiza una RepoSection
// plegable por repo abierto leyendo de la RepoView de cada uno (el activo, de la
// proyección), la cabecera muestra rama/estado/decisiones, el plegado se recuerda
// y cada sección vive en su ErrorBoundary.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSummary, ClientMsg, SessionState, SpecSummary } from '@shared/protocol.ts'
import { RepoRail } from '../../src/renderer/src/panes/RepoRail.tsx'
import { useStore } from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []

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
  review: () => Promise.resolve({ comments: [], rounds: [] })
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
const spec = (name: string): SpecSummary => ({
  name,
  file: `specs/${name}/spec.md`,
  requirements: 1
})
const session = (status: SessionState['status'], repo: string, pending = 0): SessionState => ({
  repo,
  agent: 'fake',
  status,
  sessionId: null,
  configOptions: [],
  pendingInteractions: pending,
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

/** Coloca el store como si los repos estuvieran abiertos con esas vistas y `active` activo. */
function arrange(active: string, open: string[], views: Record<string, RepoView> = {}) {
  const v = views[active] ?? view()
  useStore.setState({
    repo: active,
    openRepos: open,
    views,
    collapsed: [],
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
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  sends.length = 0
  localStorage.clear()
})

describe('tarea 3.1: una RepoSection por repo abierto', () => {
  it('cada sección muestra sus cambios y no los del otro', () => {
    arrange(A, [A, B], {
      [A]: view({ changes: [change('add-x')], changesLoaded: true }),
      [B]: view({ changes: [change('add-y')], changesLoaded: true })
    })
    const el = renderRail()
    const sa = el.querySelector(`[data-repo="${A}"]`)!
    const sb = el.querySelector(`[data-repo="${B}"]`)!
    expect(sa.textContent).toContain('add-x')
    expect(sa.textContent).not.toContain('add-y')
    expect(sb.textContent).toContain('add-y')
    expect(sb.textContent).not.toContain('add-x')
  })

  it('specs y archivados también son los de cada repo', () => {
    arrange(A, [A, B], {
      [A]: view({ changes: [], changesLoaded: true, specs: [spec('core')], archived: ['old-a'] }),
      [B]: view({ changes: [], changesLoaded: true, archived: ['old-b'] })
    })
    const el = renderRail()
    const sa = el.querySelector(`[data-repo="${A}"]`)!
    const sb = el.querySelector(`[data-repo="${B}"]`)!
    // despliega los sub-listados (arrancan plegados, como antes)
    act(() => {
      ;[...sa.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('Archived'))!
        .click()
      ;[...sb.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('Archived'))!
        .click()
    })
    expect(sa.textContent).toContain('Specs')
    expect(sa.textContent).toContain('old-a')
    expect(sb.textContent).not.toContain('core')
    expect(sb.textContent).not.toContain('old-a')
    expect(sb.textContent).toContain('old-b')
  })

  it('con un solo repo abierto hay una única sección, como antes', () => {
    arrange(A, [A], {
      [A]: view({ changes: [change('add-x')], specs: [spec('core')], changesLoaded: true })
    })
    const el = renderRail()
    expect(el.querySelectorAll('[data-repo]').length).toBe(1)
    const sa = el.querySelector(`[data-repo="${A}"]`)!
    expect(sa.textContent).toContain('New change')
    expect(sa.textContent).toContain('add-x')
    expect(sa.textContent).toContain('Specs')
  })
})

describe('tarea 3.2: cabecera, plegado y aislamiento', () => {
  it('la cabecera muestra el nombre, la rama y el estado con decisiones pendientes', () => {
    arrange(A, [A, B], {
      [B]: view({
        changes: [],
        changesLoaded: true,
        git: { repo: true, branch: 'feat/b', base: 'main', onBase: false },
        session: session('busy', B, 2)
      })
    })
    const el = renderRail()
    const sb = el.querySelector(`[data-repo="${B}"]`)!
    expect(sb.textContent).toContain('blog')
    expect(sb.textContent).toContain('feat/b')
    expect(sb.textContent).toContain('Needs you')
    expect(sb.textContent).toContain('2')
  })

  it('la sección activa lleva el borde de acento y las demás no', () => {
    arrange(A, [A, B], { [A]: view({ changesLoaded: true }) })
    const el = renderRail()
    expect(el.querySelector(`[data-repo="${A}"]`)!.className).toContain('border-accent')
    expect(el.querySelector(`[data-repo="${B}"]`)!.className).not.toContain('border-accent')
  })

  it('plegar oculta el cuerpo, deja la cabecera y se recuerda', () => {
    arrange(A, [A, B], { [A]: view({ changes: [change('add-x')], changesLoaded: true }) })
    let el = renderRail()
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Collapse app"]')!.click())
    const sa = el.querySelector(`[data-repo="${A}"]`)!
    expect(sa.textContent).toContain('app') // la cabecera se mantiene
    expect(sa.textContent).not.toContain('add-x')
    expect(JSON.parse(localStorage.getItem('rail-collapsed')!)).toContain(A)
    // se recuerda al volver a montar el rail
    act(() => root!.unmount())
    document.body.innerHTML = ''
    el = renderRail()
    expect(el.querySelector(`[data-repo="${A}"]`)!.textContent).not.toContain('add-x')
    // y se puede desplegar de nuevo
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Expand app"]')!.click())
    expect(el.querySelector(`[data-repo="${A}"]`)!.textContent).toContain('add-x')
  })

  it('una sección que falla no tira a las demás (ErrorBoundary por sección)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = change('boom')
    broken.artifacts = undefined as unknown as ChangeSummary['artifacts']
    arrange(A, [A, B], {
      [A]: view({ changes: [change('add-x')], changesLoaded: true }),
      [B]: view({ changes: [broken], changesLoaded: true })
    })
    const el = renderRail()
    const alert = el.querySelector('div[role="alert"]')!
    expect(alert.textContent).toContain('Repository blog')
    expect(alert.textContent).toContain('Try again')
    // la otra sección sigue en pie
    const sa = el.querySelector(`[data-repo="${A}"]`)!
    expect(sa.textContent).toContain('add-x')
    err.mockRestore()
  })
})

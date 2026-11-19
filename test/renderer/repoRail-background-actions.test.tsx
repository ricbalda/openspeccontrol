// @vitest-environment jsdom
// multi-repo-rail, fase 3 (tarea 3.4): el clic y las acciones del menú de una
// ChangeCard que está en la sección de un repo en segundo plano activan ese repo
// primero y se ejecutan sobre él (spec «Abrir un cambio de otro repositorio»).

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeSummary, ClientMsg, SessionState } from '@shared/protocol.ts'
import { RepoRail } from '../../src/renderer/src/panes/RepoRail.tsx'
import { useStore } from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []
const action = vi.fn(async () => ({ ok: true as const }))

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
  file: () => Promise.resolve({ content: '# doc' }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  action
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

const change = (name: string, stage: ChangeSummary['stage']): ChangeSummary => ({
  name,
  completedTasks: 0,
  totalTasks: 0,
  lastModified: '',
  status: 'in-progress',
  artifacts: [],
  isPlanningComplete: false,
  isComplete: false,
  files: [`${name}.md`],
  stage,
  openComments: 0,
  validation: null,
  stale: [],
  nextTask: null
})
const session = (status: SessionState['status'], repo: string): SessionState => ({
  repo,
  agent: 'fake',
  status,
  sessionId: null,
  configOptions: [],
  pendingInteractions: 0,
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
  changesStale: false,
  changesError: null,
  change: null,
  file: null,
  ...over
})

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
  action.mockClear()
  localStorage.clear()
})

describe('tarea 3.4: tarjetas de un repo en segundo plano', () => {
  it('«Build (apply)» en la tarjeta de B ejecuta la acción sobre B y lo activa', async () => {
    arrange(A, [A, B], {
      [A]: view({ changes: [change('add-a', 'draft')], changesLoaded: true }),
      [B]: view({
        changes: [change('fix-b', 'ready')],
        changesLoaded: true,
        session: session('ready', B)
      })
    })
    const el = renderRail()
    const sb = el.querySelector(`[data-repo="${B}"]`)!
    act(() => sb.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click())
    const item = [...sb.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Build (apply)'
    )!
    await act(async () => item.click())
    expect(action).toHaveBeenCalledWith(B, 'apply', 'fix-b', undefined) // sobre B
    expect(useStore.getState().repo).toBe(B) // y activándolo antes (D-D)
    expect(useStore.getState().views[A]).toBeDefined() // A sigue abierto
  })

  it('clic en la tarjeta de B activa B, abre el cambio allí y A conserva lo suyo', async () => {
    arrange(A, [A, B], {
      [A]: view({
        changes: [change('add-a', 'draft')],
        changesLoaded: true,
        change: 'add-a',
        file: 'proposal.md'
      }),
      [B]: view({ changes: [change('fix-b', 'ready')], changesLoaded: true })
    })
    const el = renderRail()
    const sb = el.querySelector(`[data-repo="${B}"]`)!
    await act(async () => sb.querySelector<HTMLElement>('[title="fix-b"]')!.click())
    const s = useStore.getState()
    expect(s.repo).toBe(B) // B pasa a ser el activo
    expect(s.change).toBe('fix-b') // y el documento muestra su cambio
    expect(s.file).toBe('fix-b.md')
    expect(s.views[A]?.change).toBe('add-a') // lo abierto de A se guarda en su vista
    expect(s.views[A]?.file).toBe('proposal.md')
  })
})

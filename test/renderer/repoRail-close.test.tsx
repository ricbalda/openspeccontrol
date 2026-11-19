// @vitest-environment jsdom
// multi-repo-rail, fase 3 (tarea 3.5): cerrar un repo con sesión viva pide
// confirmación (Dialog con «Cancel» y «Close and disconnect», D-E): confirmar
// manda stop y unsubscribe; cancelar lo deja todo como estaba; sin agente se
// cierra sin diálogo.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ClientMsg, SessionState } from '@shared/protocol.ts'
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

const closeBtn = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('button[aria-label="Close blog"]')!
// el botón lleva icono: el texto viene con espacios alrededor
const dialogBtn = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  sends.length = 0
  localStorage.clear()
})

describe('tarea 3.5: confirmación de cierre con agente', () => {
  it('pide confirmación; «Close and disconnect» manda stop y luego unsubscribe', async () => {
    arrange(A, [A, B], { [B]: view({ session: session('busy', B) }) })
    const el = renderRail()
    act(() => closeBtn(el).click())
    // el diálogo aparece y aún no se ha cerrado ni enviado nada
    expect(el.textContent).toContain('disconnect its agent')
    expect(useStore.getState().openRepos).toEqual([A, B])
    expect(sends).toEqual([])
    await act(async () => dialogBtn(el, 'Close and disconnect').click())
    expect(sends.slice(0, 2)).toEqual([
      { type: 'stop', repo: B },
      { type: 'unsubscribe', repo: B }
    ])
    expect(useStore.getState().openRepos).toEqual([A])
    expect(useStore.getState().repo).toBe(A)
  })

  it('«Cancel» lo deja abierto con su sesión intacta', async () => {
    arrange(A, [A, B], { [B]: view({ session: session('ready', B) }) })
    const el = renderRail()
    act(() => closeBtn(el).click())
    await act(async () => dialogBtn(el, 'Cancel').click())
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A, B])
    expect(s.views[B]?.session?.status).toBe('ready')
    expect(sends).toEqual([]) // ni stop ni unsubscribe
    expect(el.textContent).not.toContain('disconnect its agent') // el diálogo se cerró
  })

  it('sin sesión viva cierra directo, sin diálogo', async () => {
    arrange(A, [A, B])
    const el = renderRail()
    await act(async () => closeBtn(el).click())
    expect(el.textContent).not.toContain('disconnect its agent')
    expect(sends).toEqual([{ type: 'unsubscribe', repo: B }])
    expect(useStore.getState().openRepos).toEqual([A])
  })
})

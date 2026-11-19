// @vitest-environment jsdom
// multi-repo-rail, fase 3 (tarea 3.3): el RepoPicker pasa de «cambiar de repo» a
// «abrir» uno: marca los abiertos, al elegir uno lo añade a la lista y lo activa
// sin cerrar los demás (D-G), y por defecto solo la nueva sección activa queda
// expandida (D-F). AddFolder y Explorer se quedan junto al selector.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChangeSummary, ClientMsg } from '@shared/protocol.ts'
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

/** Abre el menú del selector y devuelve las filas de A y B. */
const openMenu = (el: HTMLElement) => {
  act(() => el.querySelector('button')!.click()) // el primer botón del rail es el selector
  const rows = [...el.querySelectorAll<HTMLButtonElement>('button[title]')].filter(
    (b) => b.title === A || b.title === B
  )
  expect(rows.length).toBe(2)
  return { a: rows.find((b) => b.title === A)!, b: rows.find((b) => b.title === B)! }
}

beforeEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
  sends.length = 0
  localStorage.clear()
})

describe('tarea 3.3: el selector abre (no cambia) repos', () => {
  it('marca los abiertos y elegir un segundo repo lo añade sin cerrar el primero', () => {
    arrange(A, [A], { [A]: view({ changes: [change('add-x')], changesLoaded: true }) })
    const el = renderRail()
    const { a, b } = openMenu(el)
    expect(a.textContent).toContain('open') // A está abierto
    expect(b.textContent).not.toContain('open') // B todavía no
    act(() => b.click())
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A, B]) // se añade sin cerrar A
    expect(s.repo).toBe(B) // y pasa a ser el activo
    expect(el.querySelectorAll('[data-repo]').length).toBe(2) // el rail tiene dos secciones
    expect(s.collapsed).toEqual([A]) // D-F: solo la activa queda expandida
    expect(sends).toContainEqual({ type: 'subscribe', repo: B })
  })

  it('elegir un repo ya abierto solo lo activa, sin duplicar ni replicar', () => {
    arrange(B, [A, B], {
      [A]: view({ changes: [change('add-x')], changesLoaded: true })
    })
    const el = renderRail()
    const { a } = openMenu(el)
    act(() => a.click())
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A, B]) // sin duplicados
    expect(s.repo).toBe(A)
    expect(s.collapsed).toEqual([]) // no toca el plegado
  })

  it('Add folder… y el explorador se quedan junto al selector', () => {
    arrange(A, [A], { [A]: view({ changesLoaded: true }) })
    const el = renderRail()
    const add = el.querySelector('button[aria-label="Add folder…"]')!
    const show = el.querySelector<HTMLButtonElement>('button[aria-label^="Show "]')!
    expect(add).not.toBeNull()
    expect(show.title).toBe('Show app in the file manager')
    // están en la misma fila que el selector: selector, add, explorer
    const row = add.parentElement!
    expect(row.firstElementChild!.textContent).toContain('app')
    expect([...row.children].indexOf(add)).toBe(1)
    expect([...row.children].indexOf(show)).toBe(2)
  })
})

// @vitest-environment jsdom
// tarea 11.5: la sección del rail marca una lista sin confirmar (inferencia
// local) con un indicador «Checking changes…» y un aviso cuando el refresco
// falló, en el repo activo y en los de segundo plano.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChangeSummary } from '@shared/protocol.ts'
import { RepoRail } from '../../src/renderer/src/panes/RepoRail.tsx'
import { useStore } from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

window.osc = {
  send: () => {},
  onMessage: () => () => {},
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
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
  changesStale: false,
  changesError: null,
  change: null,
  file: null,
  ...over
})

function arrange(views: Record<string, RepoView>) {
  const active = Object.keys(views)[0]!
  useStore.setState({
    repo: active,
    openRepos: Object.keys(views),
    views,
    collapsed: [],
    repos: [A, B].map(repoInfo),
    roots: [{ path: 'C:/repos', fromEnv: false, truncated: false }],
    reposLoaded: true,
    session: views[active]!.session,
    changes: views[active]!.changes,
    archived: views[active]!.archived,
    specs: views[active]!.specs,
    workflows: views[active]!.workflows,
    reviewInRepo: views[active]!.reviewInRepo,
    browse: views[active]!.browse,
    git: views[active]!.git,
    changesLoaded: views[active]!.changesLoaded,
    changesStale: views[active]!.changesStale,
    changesError: views[active]!.changesError,
    change: views[active]!.change,
    file: views[active]!.file,
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
  localStorage.clear()
})

describe('rail marks an unconfirmed change list (tarea 11.5)', () => {
  it('a stale list shows the checking indicator; a confirmed one does not', () => {
    arrange({ [A]: view({ changes: [change('add-x')], changesLoaded: true, changesStale: true }) })
    const el = renderRail()
    expect(el.querySelector('[data-stale-changes]')).not.toBeNull()
    expect(el.querySelector('[data-stale-changes]')!.textContent).toContain(
      'Checking changes with the openspec CLI'
    )

    arrange({ [A]: view({ changes: [change('add-x')], changesLoaded: true }) })
    const el2 = renderRail()
    expect(el2.querySelector('[data-stale-changes]')).toBeNull()
  })

  it('a failed refresh shows the warning instead of the spinner', () => {
    arrange({
      [A]: view({
        changes: [change('add-x')],
        changesLoaded: true,
        changesStale: true,
        changesError: 'the openspec CLI gave no answer'
      })
    })
    const el = renderRail()
    expect(el.querySelector('[data-stale-changes]')).toBeNull() // not checking any more
    expect(el.textContent).toContain("Couldn't confirm with the openspec CLI")
  })

  it('a background repo shows its own indicator, independent of the active one', () => {
    arrange({
      [A]: view({ changes: [change('add-x')], changesLoaded: true }),
      [B]: view({ changes: [change('add-y')], changesLoaded: true, changesStale: true })
    })
    const el = renderRail()
    const sections = el.querySelectorAll('[data-repo]')
    expect(sections).toHaveLength(2)
    const b = el.querySelector('[data-repo="' + B + '"]')!
    const a = el.querySelector('[data-repo="' + A + '"]')!
    expect(b.querySelector('[data-stale-changes]')).not.toBeNull()
    expect(a.querySelector('[data-stale-changes]')).toBeNull()
  })

  it('no indicator while the first load is still in flight (skeletons rule)', () => {
    arrange({ [A]: view({ changesLoaded: false, changesStale: true }) })
    const el = renderRail()
    expect(el.querySelector('[data-stale-changes]')).toBeNull()
    expect(el.textContent).not.toContain('Checking changes')
  })
})

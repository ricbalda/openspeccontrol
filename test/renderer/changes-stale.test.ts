// @vitest-environment jsdom
// tarea 11.5: la lista de cambios puede llegar como inferencia local (stale) y
// el mensaje changes_updated entrega la confirmación del CLI. El store guarda
// la marca con la vista de cada repo, refresca al recibir el mensaje (activo y
// en segundo plano) y activar un repo restaura la marca que tenía.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChangeSummary, ClientMsg, ServerMsg } from '@shared/protocol.ts'
import type { OscChanges } from '@shared/ipc.ts'
import { activateRepo, boot, openRepo, useStore } from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'

const sends: ClientMsg[] = []
let server: ((m: ServerMsg) => void) | null = null
const changesLog: string[] = []
// what changes() answers per repo, mutable per test
let changesImpl: Record<string, OscChanges[]> = {}

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
  repos: () =>
    Promise.resolve({
      roots: [{ path: 'C:/repos', fromEnv: false, truncated: false }],
      repos: [A, B].map(repoInfo)
    }),
  changes: (repo: string) => {
    changesLog.push(repo)
    const queue = changesImpl[repo] ?? []
    const r = queue.shift() ?? {
      active: [],
      archived: [],
      specs: [],
      workflows: [],
      reviewInRepo: false
    }
    return Promise.resolve(r)
  },
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  file: () => Promise.resolve({ content: '# doc' }),
  send: (m) => sends.push(m),
  onMessage: (cb) => {
    server = cb
    return () => {}
  }
} as unknown as typeof window.osc

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
  stage: 'review',
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

const flush = () => new Promise((r) => setTimeout(r, 0))

// the store wires its onServer during boot (module flag: once per file)
beforeAll(() => void boot())

beforeEach(() => {
  useStore.setState(useStore.getInitialState())
  sends.length = 0
  changesLog.length = 0
  changesImpl = {}
  localStorage.clear()
})

describe('changes stale marker travels with the view (tarea 11.5)', () => {
  it('a stale answer marks the list; changes_updated refetches and clears it', async () => {
    changesImpl[A] = [
      {
        active: [change('add-x')],
        archived: [],
        specs: [],
        workflows: [],
        reviewInRepo: false,
        stale: true
      },
      { active: [change('add-x')], archived: [], specs: [], workflows: [], reviewInRepo: false }
    ]
    useStore.setState({ openRepos: [A], views: { [A]: view() }, repo: null })
    activateRepo(A)
    await flush()
    expect(useStore.getState().changesLoaded).toBe(true)
    expect(useStore.getState().changesStale).toBe(true) // inferred data, marked
    expect(changesLog).toEqual([A])

    server!({ type: 'changes_updated', repo: A })
    await flush()
    expect(changesLog).toEqual([A, A]) // the message reloaded the confirmed list
    expect(useStore.getState().changesStale).toBe(false)
  })

  it('a refresh failure is kept as changesError and shown instead of the spinner state', async () => {
    changesImpl[A] = [
      {
        active: [],
        archived: [],
        specs: [],
        workflows: [],
        reviewInRepo: false,
        stale: true,
        refreshError: 'the openspec CLI gave no answer'
      }
    ]
    useStore.setState({ openRepos: [A], views: { [A]: view() }, repo: null })
    activateRepo(A)
    await flush()
    expect(useStore.getState().changesStale).toBe(true)
    expect(useStore.getState().changesError).toBe('the openspec CLI gave no answer')
  })

  it('changes_updated also refreshes a background repo, writing only to its view', async () => {
    changesImpl[B] = [
      { active: [change('add-y')], archived: [], specs: [], workflows: [], reviewInRepo: false }
    ]
    useStore.setState({ openRepos: [A, B], views: { [A]: view(), [B]: view() }, repo: null })
    activateRepo(A)
    await flush()
    expect(changesLog.filter((r) => r === B).length).toBe(0) // the background repo has not been asked yet

    server!({ type: 'changes_updated', repo: B })
    await flush()
    expect(changesLog.filter((r) => r === B).length).toBe(1) // the message asked for it
    expect(useStore.getState().views[B]!.changesLoaded).toBe(true)
    expect(useStore.getState().views[B]!.changesStale).toBe(false)
    expect(useStore.getState().repo).toBe(A) // the projection stays on A
  })

  it('switching repos restores the saved stale mark and revalidates in background', async () => {
    changesImpl[A] = [
      { active: [change('add-x')], archived: [], specs: [], workflows: [], reviewInRepo: false }
    ]
    changesImpl[B] = [
      {
        active: [change('add-y')],
        archived: [],
        specs: [],
        workflows: [],
        reviewInRepo: false,
        stale: true
      },
      { active: [change('add-y')], archived: [], specs: [], workflows: [], reviewInRepo: false }
    ]
    useStore.setState({ openRepos: [A, B], views: { [A]: view(), [B]: view() }, repo: null })
    activateRepo(A)
    await flush()
    expect(useStore.getState().changesStale).toBe(false)

    activateRepo(B)
    expect(useStore.getState().changesStale).toBe(false) // B had nothing saved yet
    await flush()
    expect(useStore.getState().changesStale).toBe(true) // B's first answer was stale

    activateRepo(A)
    expect(useStore.getState().changesStale).toBe(false) // A's projection, at once
    expect(useStore.getState().views[B]!.changesStale).toBe(true) // B keeps its mark
  })

  it('openRepo on a new repo loads with the stale mark when the answer is inferred', async () => {
    changesImpl[B] = [
      {
        active: [change('add-y')],
        archived: [],
        specs: [],
        workflows: [],
        reviewInRepo: false,
        stale: true
      }
    ]
    useStore.setState({ openRepos: [A], views: { [A]: view() }, repo: A, changesLoaded: true })
    expect(openRepo(B)).toBe(true)
    await flush()
    expect(useStore.getState().repo).toBe(B)
    expect(useStore.getState().changesStale).toBe(true)
    expect(useStore.getState().views[A]!.changesStale).toBe(false)
  })
})

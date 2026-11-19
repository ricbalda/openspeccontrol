// @vitest-environment jsdom
// multi-repo-rail, fase 2 (tarea 2.6): boot() restaura los repos abiertos y el
// activo desde 'open-repos' (la clave antigua 'repo' siembra la lista cuando no
// existe o está corrupta), descarta los ids que ya no existen en el workspace,
// se suscribe a cada repo abierto y escalona las cargas de cambios de los que
// quedan en segundo plano (de una en una, D-H).

import { beforeAll, describe, expect, it } from 'vitest'
import type { ClientMsg, ChangeSummary } from '@shared/protocol.ts'
import type { OscChanges } from '@shared/ipc.ts'
import { boot, useStore } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'
const C = 'C:/repos/cli'
const GONE = 'C:/repos/gone' // estaba abierto la sesión anterior; ya no existe

const sends: ClientMsg[] = []
const changesLog: string[] = []

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
const changesResult = (active: ChangeSummary[]): OscChanges => ({
  active,
  archived: [],
  specs: [],
  workflows: [],
  reviewInRepo: false
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
// las cargas de A y C (segundo plano) no terminan hasta que el test lo decide
const dA = deferred<OscChanges>()
const dC = deferred<OscChanges>()

let changesImpl: (repo: string) => Promise<OscChanges> = (repo) =>
  Promise.resolve(changesResult(repo === B ? [change('add-b')] : []))

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
      repos: [A, B, C].map(repoInfo)
    }),
  changes: (repo: string) => {
    changesLog.push(repo)
    return changesImpl(repo)
  },
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  file: () => Promise.resolve({ content: '# doc' }),
  send: (m) => sends.push(m),
  onMessage: () => () => {}
} as unknown as typeof window.osc

beforeAll(async () => {
  localStorage.setItem('open-repos', JSON.stringify([A, B, C, GONE]))
  localStorage.setItem('repo', B)
  localStorage.setItem('rail-collapsed', JSON.stringify([A]))
  changesImpl = (repo) =>
    repo === A
      ? dA.promise
      : repo === C
        ? dC.promise
        : Promise.resolve(changesResult([change('add-b')]))
  await boot()
})

describe('boot restaura la sesión de trabajo (tarea 2.6)', () => {
  it('restaura los abiertos, el activo y las secciones plegadas, y descarta el repo desaparecido', () => {
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A, B, C]) // GONE no existe: fuera sin error
    expect(s.repo).toBe(B) // el activo guardado
    expect(s.collapsed).toEqual([A])
    expect(localStorage.getItem('open-repos')).toBe(JSON.stringify([A, B, C]))
    for (const id of [A, B, C]) expect(sends).toContainEqual({ type: 'subscribe', repo: id })
    expect(sends).not.toContainEqual({ type: 'subscribe', repo: GONE })
    expect(s.changesLoaded).toBe(true) // el activo ya cargó su lista
    expect(s.changes.map((c) => c.name)).toEqual(['add-b'])
  })

  it('escalona las cargas de cambios de los repos en segundo plano', async () => {
    expect(changesLog).toContain(B) // el activo carga al activarse
    expect(changesLog).toContain(A) // el primer repo en segundo plano arranca ya
    expect(changesLog).not.toContain(C) // C espera a que termine A (de una en una)
    dA.resolve(changesResult([change('add-a')]))
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(changesLog).toContain(C)
    dC.resolve(changesResult([]))
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const s = useStore.getState()
    expect(s.views[A]?.changesLoaded).toBe(true) // la carga de fondo escribió solo en views
    expect(s.views[A]?.changes.map((c) => c.name)).toEqual(['add-a'])
    expect(s.views[C]?.changesLoaded).toBe(true)
    expect(s.changes.map((c) => c.name)).toEqual(['add-b']) // el activo B no se tocó
  })
})

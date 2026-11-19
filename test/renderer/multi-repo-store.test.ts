// @vitest-environment jsdom
// multi-repo-rail, fase 2: estado por repo en el store (design.md D-A…D-H).
// El store guarda una RepoView por repo abierto, la proyección de nivel superior
// sigue siendo la del activo, los mensajes se enrutan por repo (activo / segundo
// plano / no abierto) y el cierre es ordenado (stop → unsubscribe → siguiente).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientMsg,
  ChangeSummary,
  ServerMsg,
  SessionState,
  SessionStatus
} from '@shared/protocol.ts'
import type { OscChanges } from '@shared/ipc.ts'
import {
  activateRepo,
  boot,
  closeRepo,
  loadChanges,
  loadRepos,
  openRepo,
  runAction,
  startAgent,
  toggleCollapsed,
  useStore
} from '../../src/renderer/src/store.ts'
import type { RepoView } from '../../src/renderer/src/store.ts'

const A = 'C:/repos/app'
const B = 'C:/repos/blog'
const EXTRA = Array.from({ length: 7 }, (_, i) => `C:/repos/r${i + 3}`) // r3..r9: 9 candidatos

const sends: ClientMsg[] = []
let server: ((m: ServerMsg) => void) | null = null
const changesLog: string[] = []

const repoInfo = (id: string) => ({
  id,
  name: id.split('/').pop()!,
  root: 'C:/repos',
  rel: id.split('/').pop()!,
  openspec: true,
  session: null
})
const defaultRepos = () => [A, B, ...EXTRA].map(repoInfo)
let reposImpl = defaultRepos

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
const defaultChanges = (repo: string): Promise<OscChanges> =>
  Promise.resolve(
    changesResult(repo === A ? [change('add-x')] : repo === B ? [change('add-y')] : [])
  )
let changesImpl: (repo: string) => Promise<OscChanges> = defaultChanges

const session = (status: SessionStatus, repo: string): SessionState => ({
  repo,
  agent: 'fake',
  status,
  sessionId: null,
  configOptions: [],
  pendingInteractions: 0,
  context: null
})

const osc = vi.hoisted(() => ({
  notify: vi.fn(async () => ({ ok: true as const })),
  action: vi.fn(async () => ({ ok: true as const }))
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
      repos: reposImpl()
    }),
  changes: (repo: string) => {
    changesLog.push(repo)
    return changesImpl(repo)
  },
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  file: () => Promise.resolve({ content: '# doc' }),
  action: osc.action,
  notify: osc.notify,
  send: (m) => sends.push(m),
  onMessage: (cb) => {
    server = cb
    return () => {}
  }
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
  change: null,
  file: null,
  ...over
})

/** Coloca el store como si A/B… estuvieran abiertos con esas vistas y `active` activo. */
const arrange = (active: string, open: string[], views: Record<string, RepoView> = {}) => {
  const v = views[active] ?? view()
  useStore.setState({
    repo: active,
    openRepos: open,
    views,
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

/** lo enviado durante boot() (beforeEach vacía sends entre tests) */
let bootSends: ClientMsg[] = []

beforeAll(async () => {
  // claves corruptas a propósito: la lista se siembra desde la clave antigua 'repo'
  localStorage.setItem('open-repos', '{"bad')
  localStorage.setItem('rail-collapsed', '[1,2]')
  localStorage.setItem('repo', A)
  await boot()
  bootSends = [...sends]
})

beforeEach(() => {
  sends.length = 0
  changesLog.length = 0
  changesImpl = defaultChanges
  reposImpl = defaultRepos
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('claves de localStorage (tarea 2.1)', () => {
  it('ignora JSON inválido y siembra la lista con la clave antigua repo', () => {
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A])
    expect(s.repo).toBe(A)
    expect(s.collapsed).toEqual([])
    expect(bootSends).toContainEqual({ type: 'subscribe', repo: A })
  })

  it('serializa open-repos al abrir y rail-collapsed al plegar', () => {
    expect(openRepo(B)).toBe(true)
    expect(localStorage.getItem('open-repos')).toBe(JSON.stringify([A, B]))
    toggleCollapsed(B)
    expect(localStorage.getItem('rail-collapsed')).toBe(JSON.stringify([B]))
    toggleCollapsed(B)
    expect(localStorage.getItem('rail-collapsed')).toBe('[]')
  })
})

describe('abrir y activar (tarea 2.2)', () => {
  it('el cambio y la pestaña abiertos en A se conservan al ir a B y volver', async () => {
    arrange(A, [A, B], {
      [A]: view({ changes: [change('add-x')], change: 'add-x', file: 'design.md' }),
      [B]: view({ changes: [change('add-y')] })
    })
    activateRepo(B)
    expect(useStore.getState().repo).toBe(B)
    expect(useStore.getState().change).toBeNull() // B no tiene nada abierto
    activateRepo(A)
    const s = useStore.getState()
    expect(s.change).toBe('add-x') // al instante (stale-while-revalidate)
    expect(s.file).toBe('design.md')
    expect(s.changes.map((c) => c.name)).toEqual(['add-x'])
    await tick()
    expect(useStore.getState().change).toBe('add-x') // la revalidación no lo cierra
    expect(useStore.getState().content).toBe('# doc') // y recarga el documento abierto
  })

  it('el noveno repo no se abre y avisa de cerrar otro primero', () => {
    const open = [A, B, ...EXTRA.slice(0, 6)] // 8 abiertos
    arrange(A, open, {})
    expect(openRepo(EXTRA[6])).toBe(false)
    const s = useStore.getState()
    expect(s.openRepos).toEqual(open)
    expect(s.repo).toBe(A)
    expect(sends).toEqual([]) // ni subscribe ni nada: no se abre
    expect(s.toasts.at(-1)?.level).toBe('error')
  })
})

describe('enrutado por repo (tarea 2.3)', () => {
  it('un session de B actualiza solo views.B y el RepoInfo, no la proyección del activo', () => {
    arrange(A, [A, B])
    server!({ type: 'session', repo: B, session: session('busy', B) })
    const s = useStore.getState()
    expect(s.views[B]?.session?.status).toBe('busy')
    expect(s.session).toBeNull()
    expect(s.repos.find((r) => r.id === B)?.session?.status).toBe('busy')
  })

  it('artifacts_changed de B recarga su lista con debounce y sin tocar al activo', async () => {
    vi.useFakeTimers()
    arrange(A, [A, B])
    changesImpl = (repo) => Promise.resolve(changesResult(repo === B ? [change('fresh-y')] : []))
    server!({ type: 'artifacts_changed', repo: B, path: 'openspec/changes/add-y/proposal.md' })
    server!({ type: 'artifacts_changed', repo: B, path: 'openspec/changes/add-y/tasks.md' })
    expect(changesLog).toEqual([]) // debounce de 200 ms
    await vi.advanceTimersByTimeAsync(200)
    expect(changesLog).toEqual([B]) // dos señales, una sola carga
    const s = useStore.getState()
    expect(s.views[B]?.changes.map((c) => c.name)).toEqual(['fresh-y'])
    expect(s.views[B]?.changesLoaded).toBe(true)
    expect(s.changes).toEqual([]) // el activo A sigue como estaba
  })

  it('un turn_end de B no toca al activo y avisa con el nombre del repo', () => {
    arrange(A, [A, B])
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    osc.notify.mockClear()
    server!({
      type: 'event',
      repo: B,
      entry: {
        seq: 1,
        at: '2026-11-19T10:00:00.000Z',
        event: { kind: 'turn_end', stopReason: 'end_turn' }
      }
    })
    const s = useStore.getState()
    expect(s.events).toEqual([]) // el transcript de B no se cachea (D-B)
    expect(s.doneUnseen).toBe(false) // doneUnseen es solo del activo
    expect(osc.notify).toHaveBeenCalledWith({
      title: 'Done · blog',
      body: 'The agent',
      kind: 'info'
    })
  })

  it('los mensajes de un repo que no está abierto se ignoran', () => {
    arrange(A, [A, B])
    server!({ type: 'session', repo: EXTRA[0], session: session('busy', EXTRA[0]) })
    const s = useStore.getState()
    expect(s.views[EXTRA[0]]).toBeUndefined()
    expect(s.repos.find((r) => r.id === EXTRA[0])?.session).toBeNull()
  })
})

describe('acciones con repo explícito y respuestas tardías (tarea 2.4)', () => {
  it('una respuesta de A que llega tras activar B no modifica lo que ve B', async () => {
    arrange(A, [A, B])
    const d = deferred<OscChanges>()
    changesImpl = (repo) =>
      repo === A ? d.promise : Promise.resolve(changesResult([change('add-y')]))
    const p = loadChanges() // con A activo
    activateRepo(B)
    d.resolve(changesResult([change('late-x')]))
    await p
    const s = useStore.getState()
    expect(s.repo).toBe(B)
    expect(s.changes.map((c) => c.name)).toEqual(['add-y']) // B ve lo suyo
    expect(s.views[A]?.changes.map((c) => c.name)).toEqual(['late-x']) // lo de A quedó en A
  })

  it('runAction sobre un repo en segundo plano lo activa primero', async () => {
    arrange(A, [A, B], { [B]: view({ session: session('ready', B) }) })
    await runAction('apply', 'add-y', undefined, B)
    expect(useStore.getState().repo).toBe(B)
    expect(osc.action).toHaveBeenCalledWith(B, 'apply', 'add-y', undefined)
  })

  it('startAgent con repo explícito activa y arranca el agente de ese repo', () => {
    arrange(A, [A, B])
    startAgent(true, B)
    expect(useStore.getState().repo).toBe(B)
    expect(sends).toContainEqual({ type: 'start', repo: B, agent: 'fake', resume: true })
  })
})

describe('cierre ordenado (tarea 2.5)', () => {
  it('cerrar un repo sin agente manda unsubscribe y no stop', async () => {
    arrange(A, [A, B])
    await expect(closeRepo(B)).resolves.toBe(true)
    expect(sends).toEqual([{ type: 'unsubscribe', repo: B }])
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A])
    expect(s.views[B]).toBeUndefined()
    expect(s.repo).toBe(A)
  })

  it('con sesión viva pide confirmación: cancelar lo deja todo como estaba', async () => {
    arrange(A, [A, B], { [B]: view({ session: session('ready', B) }) })
    const confirm = vi.fn(async () => false)
    await expect(closeRepo(B, { confirm })).resolves.toBe(false)
    expect(confirm).toHaveBeenCalledWith(B)
    expect(sends).toEqual([])
    expect(useStore.getState().openRepos).toEqual([A, B])
  })

  it('confirmar manda stop y luego unsubscribe', async () => {
    arrange(A, [A, B], { [B]: view({ session: session('busy', B) }) })
    await expect(closeRepo(B, { confirm: () => true })).resolves.toBe(true)
    expect(sends.slice(0, 2)).toEqual([
      { type: 'stop', repo: B },
      { type: 'unsubscribe', repo: B }
    ])
    expect(useStore.getState().openRepos).toEqual([A])
  })

  it('cerrar el activo activa el siguiente; cerrar el último deja el estado vacío', async () => {
    arrange(A, [A, B])
    await closeRepo(A)
    expect(useStore.getState().repo).toBe(B)
    expect(useStore.getState().openRepos).toEqual([B])
    await closeRepo(B)
    const s = useStore.getState()
    expect(s.repo).toBeNull() // «Pick a repository»
    expect(s.openRepos).toEqual([])
    expect(s.changes).toEqual([])
    expect(localStorage.getItem('open-repos')).toBe('[]')
  })
})

describe('el workspace barre repos (tarea 2.6)', () => {
  it('un repo abierto que desaparece se quita sin error y suelta el vigilante', async () => {
    arrange(A, [A, B])
    reposImpl = () => [repoInfo(A)]
    await loadRepos(true)
    const s = useStore.getState()
    expect(s.openRepos).toEqual([A])
    expect(s.views[B]).toBeUndefined()
    expect(sends).toContainEqual({ type: 'unsubscribe', repo: B })
    expect(s.repo).toBe(A)
  })

  it('si desaparece el activo, se activa el primero que queda', async () => {
    arrange(A, [A, B])
    reposImpl = () => [repoInfo(B)]
    await loadRepos(true)
    expect(useStore.getState().repo).toBe(B)
    expect(useStore.getState().openRepos).toEqual([B])
  })
})

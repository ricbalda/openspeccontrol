import { create } from 'zustand'
import type {
  AgentEvent,
  AgentInfo,
  ArchivedChange,
  ChangeSummary,
  ClientMsg,
  GitInfo,
  OptionalWorkflow,
  SpecSummary,
  LifecycleAction,
  LoggedEvent,
  MenuAction,
  RepoInfo,
  ReviewComment,
  ReviewRound,
  RootInfo,
  ServerMsg,
  SessionState,
  UpdateState,
  Workspace
} from '@shared/protocol.ts'
import type { ToolStatus } from '@shared/ipc.ts'
import { api } from './lib/api.ts'
import { checkResult } from './lib/update-text.ts'

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  }
}

/** A read-only document open in the middle pane instead of an active change. */
export type Browse =
  | { kind: 'spec'; name: string; file: string }
  /** file: an artifact of the archived change, or HISTORY_TAB */
  | { kind: 'archived'; name: string; file: string; data: ArchivedChange }

export const HISTORY_TAB = '__history__'

export interface Toast {
  id: number
  text: string
  level: 'info' | 'error'
}

interface State {
  agents: AgentInfo[]
  defaultAgent: string
  platform: string
  /** external CLIs from config() (Fase 6): warnings and the diagnostics dialog */
  tools: ToolStatus[]
  roots: RootInfo[]
  reposLoaded: boolean
  repos: RepoInfo[]
  repo: string | null
  /** multi-repo-rail (fase 2): repos abiertos a la vez; `repo` es el activo (D-A) */
  openRepos: string[]
  /** estado por repo abierto (D-A); los campos de nivel superior son la proyección del activo */
  views: Record<string, RepoView>
  /** secciones del rail plegadas; persistidas en 'rail-collapsed' (D-F) */
  collapsed: string[]
  agent: string
  session: SessionState | null
  events: LoggedEvent[]
  changes: ChangeSummary[]
  archived: string[]
  specs: SpecSummary[]
  /** optional OpenSpec workflows installed in the repo */
  workflows: OptionalWorkflow[]
  /** this repo keeps its review history in openspec/changes/<change>/.openspeccontrol-review.json */
  reviewInRepo: boolean
  browse: Browse | null
  /** the repo's branch; refreshed on focus, file changes and turn ends */
  git: GitInfo | null
  changesLoaded: boolean
  change: string | null
  file: string | null // relative to change dir, or '__changes__' for the diff view
  content: string
  comments: ReviewComment[]
  rounds: ReviewRound[]
  focusComment: string | null
  toasts: Toast[]
  addFolderOpen: boolean
  /** Ayuda → Diagnóstico de dependencias (Fase 6); the Help menu opens it */
  diagOpen: boolean
  /** Ayuda → Crear repositorio de demostración… (Fase 5.7): the agent picker dialog */
  demoOpen: boolean
  /** a turn finished while the tab was in the background (cleared when it gets focus) */
  doneUnseen: boolean
  /** estado de la actualización automática (Fase 9); null hasta que main responde */
  update: UpdateState | null
}

export const useStore = create<State>(() => ({
  // defaultAgent / agent come from /api/config (the server owns DEFAULT_AGENT)
  agents: [],
  defaultAgent: '',
  platform: '',
  tools: [],
  roots: [],
  reposLoaded: false,
  repos: [],
  repo: null,
  openRepos: [],
  views: {},
  collapsed: [],
  agent: '',
  session: null,
  events: [],
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
  content: '',
  comments: [],
  rounds: [],
  focusComment: null,
  toasts: [],
  addFolderOpen: false,
  diagOpen: false,
  demoOpen: false,
  doneUnseen: false,
  update: null
}))
const set = useStore.setState
const get = useStore.getState

// ---- multi-repo (multi-repo-rail, fase 2) ----------------------------------------
// design.md D-A: el estado por repo vive en un mapa y los campos de nivel superior
// son la proyección del activo; D-B: transcript y comentarios no se cachean (se
// recargan al activar); D-E: cierre ordenado con `unsubscribe`.

/** Máximo de repos abiertos a la vez (D-I): cada uno cuesta un vigilante de archivos. */
export const MAX_OPEN_REPOS = 8

/** Lo que el rail y el cambio de repo necesitan de cada repo abierto (D-A). El
 *  transcript (`events`) y los comentarios no se guardan: se recargan al activar (D-B). */
export interface RepoView {
  session: SessionState | null
  changes: ChangeSummary[]
  archived: string[]
  specs: SpecSummary[]
  workflows: OptionalWorkflow[]
  reviewInRepo: boolean
  browse: Browse | null
  git: GitInfo | null
  changesLoaded: boolean
  change: string | null
  file: string | null
}

const emptyView = (): RepoView => ({
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
  file: null
})

/** Listas de ids en localStorage ('open-repos', 'rail-collapsed'); JSON inválido → null. */
const readList = (k: string): string[] | null => {
  const raw = ls.get(k)
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null
  } catch {
    return null
  }
}
const writeList = (k: string, list: string[]) => ls.set(k, JSON.stringify(list))

/** TODO(fase1): `{ type: 'unsubscribe'; repo }` se añade a `ClientMsg` en la fase 1
 *  (otro worker, en paralelo sobre protocol.ts). Hasta integrar, este molde local
 *  sigue el contrato del diseño (D-E); al integrar, el cast sobra. */
const unsubscribeMsg = (repo: string): ClientMsg =>
  ({ type: 'unsubscribe', repo }) as unknown as ClientMsg

/** La proyección del activo pasa a `views[repo]`: la única vía de escritura (D-A). */
function saveView(id: string) {
  const s = get()
  set({
    views: {
      ...s.views,
      [id]: {
        session: s.session,
        changes: s.changes,
        archived: s.archived,
        specs: s.specs,
        workflows: s.workflows,
        reviewInRepo: s.reviewInRepo,
        browse: s.browse,
        git: s.git,
        changesLoaded: s.changesLoaded,
        change: s.change,
        file: s.file
      }
    }
  })
}

/** Escribe en la vista de un repo abierto (los de segundo plano actualizan solo aquí). */
function setView(id: string, patch: (v: RepoView) => RepoView) {
  if (!get().openRepos.includes(id)) return
  set((s) => ({ views: { ...s.views, [id]: patch(s.views[id] ?? emptyView()) } }))
}

/** Sin ningún repo abierto: el centro vuelve a «Pick a repository». */
function resetProjection() {
  set({
    repo: null,
    session: null,
    events: [],
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
    content: '',
    comments: [],
    rounds: [],
    focusComment: null
  })
}

/** Quita un repo de la lista de abiertos y arregla el activo (D-E, paso 2). */
function dropRepo(id: string, opts: { unsubscribe?: boolean } = {}) {
  clearRefreshTimer(id)
  const openRepos = get().openRepos.filter((r) => r !== id)
  const views = { ...get().views }
  delete views[id]
  writeList('open-repos', openRepos)
  set({ openRepos, views })
  if (opts.unsubscribe) sendMsg(unsubscribeMsg(id))
  if (get().repo === id) {
    dropPendingEvents()
    const next = openRepos[0]
    if (next) activateRepo(next)
    else resetProjection()
  }
}

const liveSession = (s: SessionState | null): boolean =>
  !!s && (s.status === 'starting' || s.status === 'ready' || s.status === 'busy')

/** La sesión de un repo abierto: la proyección si es el activo; si no, su RepoView. */
function sessionOf(id: string): SessionState | null {
  return get().repo === id ? get().session : (get().views[id]?.session ?? null)
}

// ---- toasts --------------------------------------------------------------------
let toastId = 0
export function toast(text: string, level: Toast['level'] = 'info') {
  const id = ++toastId
  set((s) => ({ toasts: [...s.toasts, { id, text, level }] }))
  setTimeout(
    () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    level === 'error' ? 7000 : 3500
  )
}
const guard = async <T>(p: Promise<T>): Promise<T | undefined> => {
  try {
    return await p
  } catch (e) {
    toast((e as Error).message, 'error')
    return undefined
  }
}

// ---- realtime over the preload bridge -----------------------------------------
// No network and no reconnects (Fase 3): the main process pushes
// 'osc:server-msg' events and a page reload recovers by subscribing again —
// the core answers with the session and the transcript replay.

/** Waiting for a session to become ready (ensureAgent). */
const readyWaiters: (() => void)[] = []

export function sendMsg(m: ClientMsg) {
  window.osc.send(m)
}

// The server replays at most this many events (db.ts events.list); keep the live
// transcript to the same window so a long session doesn't slow the page down.
const MAX_EVENTS = 2000
const appendEvents = (list: LoggedEvent[], batch: LoggedEvent[]) => {
  const all = list.concat(batch)
  return all.length > MAX_EVENTS ? all.slice(all.length - MAX_EVENTS) : all
}

// Fase 11 (tarea 11.5): a long turn streams thousands of events. Applying each one
// re-folded the log and re-rendered the whole transcript (~30 ms apiece, ~80 s for
// 2500 events, with the page frozen). Events are buffered and applied in one batch
// every EVENT_BATCH_MS; the ones the user must see at once flush the buffer first.
const EVENT_BATCH_MS = 80
const SHOW_NOW = new Set(['user', 'permission', 'elicitation', 'turn_end'])
let pendingEvents: LoggedEvent[] = []
let pendingTimer: ReturnType<typeof setTimeout> | undefined
function flushEvents() {
  clearTimeout(pendingTimer)
  pendingTimer = undefined
  if (!pendingEvents.length) return
  const batch = pendingEvents
  pendingEvents = []
  set((s) => ({ events: appendEvents(s.events, batch) }))
}
/** A replay or a change of repo replaces the log: what was buffered belongs to the old one. */
function dropPendingEvents() {
  clearTimeout(pendingTimer)
  pendingTimer = undefined
  pendingEvents = []
}

// Refresco con debounce por repo (D-C): al activo le recarga la lista y el archivo
// abierto; a uno de segundo plano solo su lista (loadChangesFor, que escribe en views).
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleRefresh(repo: string) {
  clearTimeout(refreshTimers.get(repo))
  refreshTimers.set(
    repo,
    setTimeout(() => {
      refreshTimers.delete(repo)
      if (!get().openRepos.includes(repo)) return // cerrado mientras esperaba
      if (get().repo === repo) {
        void loadChanges()
        void reloadFile()
      } else {
        void loadChangesFor(repo)
      }
    }, 200)
  )
}
function clearRefreshTimer(repo: string) {
  clearTimeout(refreshTimers.get(repo))
  refreshTimers.delete(repo)
}

function onServer(m: ServerMsg) {
  if (m.type === 'error') return toast(m.message, 'error')
  if (m.type === 'menu') return menuAction(m.action) // Fase 4: menú nativo → renderer
  if (m.type === 'update_state') return void set({ update: m.state }) // Fase 9
  if (!get().openRepos.includes(m.repo)) return // D-C: mensajes de repos no abiertos
  const active = m.repo === get().repo
  switch (m.type) {
    case 'session':
      // el session de RepoInfo alimenta el nombre de repo en avisos y el picker
      set((s) => ({
        repos: s.repos.map((r) => (r.id === m.repo ? { ...r, session: m.session } : r))
      }))
      setView(m.repo, (v) => ({ ...v, session: m.session }))
      if (active) {
        set({ session: m.session })
        if (m.session?.status === 'ready') for (const f of readyWaiters.splice(0)) f()
      }
      break
    case 'replay':
      if (!active) break // D-C: el transcript solo es el del activo (D-B)
      dropPendingEvents()
      set({ events: m.entries })
      break
    case 'event':
      if (active) {
        pendingEvents.push(m.entry)
        if (SHOW_NOW.has(m.entry.event.kind)) flushEvents()
        else pendingTimer ??= setTimeout(flushEvents, EVENT_BATCH_MS)
        if (m.entry.event.kind === 'permission' || m.entry.event.kind === 'elicitation')
          notifyAttention()
        if (m.entry.event.kind === 'turn_end') {
          notifyTurnEnd(m.entry.event.stopReason)
          loadGit()
        }
      } else {
        onBackgroundEvent(m.repo, m.entry.event)
      }
      break
    case 'artifacts_changed':
      scheduleRefresh(m.repo)
      break
    case 'review_changed':
      if (active) {
        if (m.change === get().change) loadReview()
        loadChanges()
      } else {
        void loadChangesFor(m.repo)
      }
      break
  }
}

/** Evento de un repo en segundo plano (D-C): sin transcript (D-B), solo avisos (D-J). */
function onBackgroundEvent(repo: string, e: AgentEvent) {
  if (e.kind === 'permission' || e.kind === 'elicitation') return notifyAttention()
  if (e.kind === 'turn_end') return notifyTurnEnd(e.stopReason, repo)
}

/** OS notification, through the main process (Fase 5.3): it shows one only while
 * the window is unfocused, flashes the taskbar for `attention` and refocuses on click. */
function notify(title: string, body: string, kind: 'info' | 'attention' = 'info') {
  try {
    void window.osc.notify({ title, body, kind })
  } catch {
    /* preload missing */
  }
}

function notifyAttention() {
  if (document.hasFocus()) return
  notify('OpenSpecControl', 'The agent needs your decision', 'attention')
}

const STOP_TEXT: Record<string, string> = {
  end_turn: 'Done',
  cancelled: 'Stopped',
  refusal: 'Stopped early (refusal)',
  max_tokens: 'Stopped: output token limit',
  max_turn_requests: 'Stopped: step limit',
  error: 'Failed'
}

/** Long turns (build, review) finish while you are elsewhere: say so. Con `repoId`
 *  (un repo en segundo plano) no hay transcript a mano (D-B) y el aviso nombra el
 *  repo (D-J); doneUnseen sigue siendo solo del activo. */
function notifyTurnEnd(stopReason: string, repoId?: string) {
  if (document.hasFocus()) return
  if (repoId) {
    const name = get().repos.find((r) => r.id === repoId)?.name ?? repoId
    notify(`${STOP_TEXT[stopReason] ?? stopReason} · ${name}`, 'The agent')
    return
  }
  // the request this turn answered: the last "user" entry
  const req = [...get().events].reverse().find((e) => e.event.kind === 'user')?.event
  const what =
    req?.kind === 'user' ? (req.label ?? req.text.split('\n')[0].slice(0, 80)) : 'The agent'
  const repo = get().repos.find((r) => r.id === get().repo)?.name
  notify(`${STOP_TEXT[stopReason] ?? stopReason}${repo ? ` · ${repo}` : ''}`, what)
  set({ doneUnseen: true })
}

// back from a terminal or git client: the branch may have changed
if (typeof window !== 'undefined')
  window.addEventListener('focus', () => {
    if (get().doneUnseen) set({ doneUnseen: false })
    loadGit()
  })

// ---- actions -------------------------------------------------------------------
let booted = false
export async function boot() {
  if (booted) return
  booted = true
  // core events for this page's lifetime; a reload re-subscribes and replays
  window.osc.onMessage(onServer)
  void loadUpdateState() // Fase 9: el estado puede haber cambiado antes de que la página arrancara
  const cfg = await guard(api.config())
  if (cfg)
    set({
      agents: cfg.agents,
      defaultAgent: cfg.defaultAgent,
      agent: get().agent || cfg.defaultAgent,
      platform: cfg.platform,
      tools: cfg.tools ?? []
    })
  await loadRepos()
  restoreOpenRepos()
}

/**
 * multi-repo-rail (fase 2, D-H): restaura los repos abiertos, el activo y las
 * secciones plegadas. La clave antigua 'repo' siembra la lista cuando no existe
 * 'open-repos' (migración); los ids que ya no existan en el workspace se descartan
 * sin error. Cada repo abierto se suscribe; las cargas de cambios de los repos en
 * segundo plano se escalonan (de una en una) para no saturar `openspec list`.
 */
function restoreOpenRepos() {
  set({ collapsed: readList('rail-collapsed') ?? [] })
  const saved = readList('open-repos')
  const last = ls.get('repo')
  const hit = last && get().repos.find((r) => r.id === last || (r.rel && r.rel === last))
  const exists = (id: string) => get().repos.some((r) => r.id === id)
  // 'open-repos' manda; sin ella (o con JSON inválido), la clave antigua 'repo' siembra
  const open = [...new Set((saved ?? (hit ? [hit.id] : [])).filter(exists))]
  writeList('open-repos', open)
  if (!open.length) return
  const active = hit && open.includes(hit.id) ? hit.id : open[0]
  set({
    openRepos: open,
    views: Object.fromEntries(open.map((id): [string, RepoView] => [id, emptyView()]))
  })
  activateRepo(active)
  const bg = open.filter((id) => id !== active)
  for (const id of bg) sendMsg({ type: 'subscribe', repo: id })
  void (async () => {
    for (const id of bg) await loadChangesFor(id)
  })()
}

const applyWorkspace = (w: Workspace) => {
  set({ roots: w.roots, repos: w.repos, reposLoaded: true })
  // multi-repo (fase 2): los abiertos que ya no existan se quitan de la lista sin
  // error (spec) y se sueltan sus vigilantes con unsubscribe (D-E) por si el
  // núcleo no los limpió aún; si el que desaparece es el activo, se activa el
  // primero que quede o el centro vuelve a «Pick a repository».
  const exists = (id: string) => w.repos.some((r) => r.id === id)
  for (const id of [...get().openRepos]) if (!exists(id)) dropRepo(id, { unsubscribe: true })
}

export async function loadRepos(refresh = false) {
  const w = await guard(api.repos(refresh))
  if (w) applyWorkspace(w)
}

export async function addRoot(path: string): Promise<boolean> {
  const w = await guard(api.addRoot(path))
  if (!w) return false
  applyWorkspace(w)
  return true
}

/** Native folder picker (Fase 5.2): adds the chosen folder, or nothing on cancel. */
export async function browseRoot(): Promise<boolean> {
  const w = await guard(api.pickFolder()) // null = the user closed the dialog
  if (!w) return false
  applyWorkspace(w)
  return true
}

export const openAddFolder = (open = true) => set({ addFolderOpen: open })

/**
 * Open/close the dependency diagnostics dialog (Fase 6). Exported so the Help
 * menu entry (wired to the native menu by the orchestrator, Fase 4 owns
 * menu.ts) can reach it, like openAddFolder.
 */
export const openDiagnostics = (open = true) => set({ diagOpen: open })

export const openDemoRepo = (open = true) => set({ demoOpen: open })

// ---- Fase 9: actualización automática --------------------------------------------

/** El estado actual de la actualización (los cambios siguientes llegan como `update_state`). */
async function loadUpdateState() {
  try {
    set({ update: await api.updateState() })
  } catch {
    /* sin puente o main sin updater: la píldora simplemente no aparece */
  }
}

/** Ayuda → Buscar actualizaciones…: fuerza la comprobación y avisa del resultado. */
export async function checkForUpdates() {
  const s = await guard(api.checkForUpdates())
  if (!s) return
  set({ update: s })
  const r = checkResult(s)
  toast(r.text, r.level)
}

/**
 * "Reiniciar para actualizar a x.y.z": main pide la confirmación de cierre seguro si
 * hay un agente trabajando o decisiones pendientes y reinicia; Cancelar no hace nada.
 */
export async function installUpdate() {
  await guard(api.installUpdate())
}

/**
 * Ayuda → Crear repositorio de demostración (Fase 5.7). The main process shows the
 * native folder picker and creates `hello-app` asynchronously; here we only apply
 * the refreshed workspace and land on the demo change, waiting in "In review".
 * false when the picker was cancelled or the creation failed (toasted).
 */
export async function createDemo(agent: string | null): Promise<boolean> {
  const r = await guard(api.createDemoRepo(agent))
  if (!r) return false // null = the user closed the picker
  applyWorkspace(r.workspace)
  for (const w of r.warnings) toast(w, 'error')
  toast('Demo repository created')
  selectRepo(r.repo)
  await loadChanges() // selectRepo already asked; this one is awaitable
  if (get().repo === r.repo && get().changes.some((c) => c.name === r.change))
    await openChange(r.change)
  return true
}

/** Ayuda → Abrir carpeta de datos (Fase 5.8): errors surface as a toast. */
export const openDataFolder = () => guard(api.openDataFolder())

export async function removeRoot(path: string) {
  const w = await guard(api.removeRoot(path))
  if (w) applyWorkspace(w)
}

/**
 * multi-repo-rail (D-G): abrir un repo lo añade a la lista de abiertos (si no
 * estaba) y lo activa, sin cerrar los demás. false (con un aviso) si ya hay
 * MAX_OPEN_REPOS abiertos (D-I).
 */
export function openRepo(id: string): boolean {
  const open = get().openRepos
  if (!open.includes(id)) {
    if (open.length >= MAX_OPEN_REPOS) {
      toast(`Close a repository first: at most ${MAX_OPEN_REPOS} can be open at once`, 'error')
      return false
    }
    set({ openRepos: [...open, id], views: { ...get().views, [id]: emptyView() } })
    writeList('open-repos', get().openRepos)
  }
  activateRepo(id)
  return true
}

/** Compat: el picker y el rail siguen llamando a selectRepo hasta la fase 3 (D-G). */
export const selectRepo = (id: string) => openRepo(id)

/**
 * Activar un repo abierto (D-A): guarda la proyección del anterior en `views`,
 * restaura la del nuevo al instante (stale-while-revalidate) y recarga el
 * transcript (subscribe → replay) y los comentarios (D-B) en segundo plano.
 */
export function activateRepo(id: string) {
  const prev = get().repo
  if (prev) saveView(prev) // prev === id: reactivar conserva la vista y vacía el transcript
  const v = get().views[id] ?? emptyView()
  ls.set('repo', id)
  const agent = ls.get(`agent:${id}`) || get().defaultAgent
  dropPendingEvents()
  set({
    repo: id,
    agent,
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
    focusComment: null,
    events: []
  })
  sendMsg({ type: 'subscribe', repo: id })
  // revalidación en segundo plano (D-A): lo guardado se ve al instante
  void loadChanges()
  if (docPath()) void reloadFile()
  if (get().change) void loadReview()
}

/**
 * Cerrar un repo abierto (D-E). Con sesión viva (`starting`, `ready`, `busy`) pide
 * confirmación a través de `opts.confirm` (la fase 3 la conecta al diálogo); al
 * confirmar: `stop` y luego `unsubscribe`, fuera de la lista, y el activo pasa al
 * primero que quede (o a «Pick a repository»). false si se cancela o no estaba abierto.
 */
export async function closeRepo(
  id: string,
  opts: { confirm?: (repo: string) => boolean | Promise<boolean> } = {}
): Promise<boolean> {
  if (!get().openRepos.includes(id)) return false
  if (liveSession(sessionOf(id))) {
    if (opts.confirm && !(await opts.confirm(id))) return false // cancelar lo deja tal cual
    sendMsg({ type: 'stop', repo: id })
  }
  dropRepo(id, { unsubscribe: true })
  return true
}

/** Plegar/desplegar la sección de un repo; se recuerda en 'rail-collapsed' (D-F). */
export function toggleCollapsed(repo: string) {
  const cur = get().collapsed
  const next = cur.includes(repo) ? cur.filter((r) => r !== repo) : [...cur, repo]
  set({ collapsed: next })
  writeList('rail-collapsed', next)
}

export function setAgent(agent: string) {
  const r = get().repo
  if (r) ls.set(`agent:${r}`, agent)
  set({ agent })
}

export function startAgent(resume = true, repoId?: string) {
  const repo = repoId ?? get().repo
  if (!repo) return
  if (repo !== get().repo) activateRepo(repo) // D-D: activar primero
  sendMsg({ type: 'start', repo, agent: get().agent, resume })
}
export const stopAgent = (repoId?: string) => {
  const repo = repoId ?? get().repo
  if (!repo) return
  if (repo !== get().repo) activateRepo(repo) // D-D: activar primero
  sendMsg({ type: 'stop', repo })
}
export const cancelTurn = () => {
  const r = get().repo
  if (r) sendMsg({ type: 'cancel', repo: r })
}
export const sendPrompt = (text: string) => {
  const r = get().repo
  if (r && text.trim()) sendMsg({ type: 'prompt', repo: r, text })
}

/** Start the agent if needed and wait until it can take a prompt. */
export function ensureAgent(): Promise<boolean> {
  const s = get().session
  if (s?.status === 'ready') return Promise.resolve(true)
  if (s?.status === 'busy') {
    toast('The agent is still working. Wait for it or press Stop.', 'error')
    return Promise.resolve(false)
  }
  if (!s || s.status === 'exited' || s.status === 'error') startAgent()
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      toast('The agent did not become ready', 'error')
      resolve(false)
    }, 90_000)
    readyWaiters.push(() => {
      clearTimeout(t)
      resolve(true)
    })
  })
}

export async function runAction(
  action: LifecycleAction,
  change?: string,
  text?: string,
  repoId?: string
) {
  const repo = repoId ?? get().repo
  if (!repo) return
  if (repo !== get().repo) activateRepo(repo) // D-D: activar primero
  if (!(await ensureAgent())) return
  await guard(api.action(repo, action, change, text))
}

export async function initRepo() {
  const { repo, agent } = get()
  if (!repo) return
  const r = await guard(api.init(repo, agent))
  if (!r) return
  toast('OpenSpec initialized')
  await loadRepos()
  await loadChanges()
  // a fresh session so the agent picks up the new commands/skills
  if (get().session) startAgent(false)
}

/** Carga la lista de cambios del repo activo (o de `repoId`, activándolo antes, D-D). */
export async function loadChanges(repoId?: string) {
  const repo = repoId ?? get().repo
  if (!repo) return
  if (repo !== get().repo) activateRepo(repo) // D-D: activar primero
  void loadGit()
  await loadChangesInto(repo)
}

/** Carga de fondo (D-D): escribe solo en `views[repo]` y comprueba que siga abierto. */
export async function loadChangesFor(repo: string) {
  await Promise.all([loadChangesInto(repo), loadGitInto(repo)])
}

async function loadChangesInto(repo: string) {
  const r = await guard(api.changes(repo))
  if (!r || !get().openRepos.includes(repo)) return // cerrado o desaparecido mientras cargaba
  if (get().repo === repo) {
    set({
      changes: r.active,
      archived: r.archived,
      specs: r.specs,
      workflows: r.workflows,
      reviewInRepo: r.reviewInRepo,
      changesLoaded: true
    })
    const { browse } = get()
    if (browse?.kind === 'spec' && !r.specs.some((x) => x.name === browse.name))
      set({ browse: null, content: '' })
    if (browse?.kind === 'archived' && !r.archived.includes(browse.name))
      set({ browse: null, content: '' })
    const { change } = get()
    if (change && !r.active.some((c) => c.name === change))
      set({ change: null, file: null, content: '' })
  } else {
    // respuesta tardía (2.4): al estado de su repo, sin tocar la proyección del activo
    setView(repo, (v) => ({
      ...v,
      changes: r.active,
      archived: r.archived,
      specs: r.specs,
      workflows: r.workflows,
      reviewInRepo: r.reviewInRepo,
      changesLoaded: true
    }))
  }
}

/** What the open view would commit: the active change, or the archived one. */
const gitScope = () => {
  const { change, browse } = get()
  return browse?.kind === 'archived' ? { archived: browse.name } : change ? { change } : {}
}

/** La rama del repo y los archivos sin confirmar del cambio abierto (silenciosa:
 *  sin toast si falta git). Con `repoId` de un repo en segundo plano, lo activa (D-D). */
export async function loadGit(repoId?: string) {
  const repo = repoId ?? get().repo
  if (!repo) return
  if (repo !== get().repo) activateRepo(repo) // D-D: activar primero
  const scope = gitScope()
  const g = await api.git(repo, scope).catch(() => null)
  if (!get().openRepos.includes(repo)) return
  if (get().repo === repo) {
    if (JSON.stringify(gitScope()) === JSON.stringify(scope)) set({ git: g })
  } else {
    setView(repo, (v) => ({ ...v, git: g })) // respuesta tardía (2.4)
  }
}

/** Rama de un repo en segundo plano, sin activarlo y sin tocar la proyección. */
async function loadGitInto(repo: string) {
  const g = await api.git(repo, {}).catch(() => null)
  if (get().openRepos.includes(repo)) setView(repo, (v) => ({ ...v, git: g }))
}

/** "Create branch change/<name>": the change's files come along to the new branch. */
export async function createChangeBranch(change: string) {
  const repo = get().repo
  if (!repo) return
  const g = await guard(api.gitBranch(repo, change))
  if (!g) return
  toast(`Switched to the new branch ${g.branch}`)
  await loadGit()
}

/** Repo header: reveal the current repo in the OS file manager (Fase 5.8). */
export async function showRepoInExplorer() {
  const repo = get().repo
  if (repo) await guard(api.showInExplorer(repo))
}

/** Commit the files the user confirmed, for the open change (or archived change). */
export async function commitChange(files: string[], message: string): Promise<boolean> {
  const repo = get().repo
  if (!repo) return false
  const r = await guard(api.gitCommit({ repo, ...gitScope(), files, message }))
  await loadGit()
  if (!r) return false
  toast(`Committed ${r.files} file${r.files === 1 ? '' : 's'} (${r.commit})`)
  return true
}

export async function openChange(name: string, file?: string) {
  const c = get().changes.find((x) => x.name === name)
  set({
    browse: null,
    change: name,
    file: file ?? c?.files[0] ?? null,
    content: '',
    focusComment: null
  })
  await Promise.all([reloadFile(), loadReview(), loadGit()])
}

export async function openFile(file: string) {
  set({ file, focusComment: null })
  await reloadFile()
}

/** Path (relative to <repo>/openspec) of the document shown in the middle pane, if any. */
function docPath(): string | null {
  const { change, file, browse } = get()
  if (browse?.kind === 'spec') return browse.file
  if (browse?.kind === 'archived')
    return browse.file === HISTORY_TAB ? null : `changes/archive/${browse.name}/${browse.file}`
  if (!change || !file || file === '__changes__') return null
  return `changes/${change}/${file}`
}

async function reloadFile() {
  const { repo } = get()
  const path = docPath()
  if (!repo || !path) return
  const r = await api.file(repo, path).catch(() => null)
  if (get().repo === repo && docPath() === path) set({ content: r?.content ?? '' })
}

/** Open an archived change, read-only: its artifacts and its review history. */
export async function openArchived(name: string) {
  const repo = get().repo
  if (!repo) return
  const data = await guard(api.archived(repo, name))
  if (!data || get().repo !== repo) return
  set({
    browse: { kind: 'archived', name, file: data.files[0] ?? HISTORY_TAB, data },
    change: null,
    file: null,
    content: '',
    comments: [],
    rounds: [],
    focusComment: null
  })
  await Promise.all([reloadFile(), loadGit()])
}

/** Switch the tab of an open archived change. */
export async function openArchivedFile(file: string) {
  const { browse } = get()
  if (browse?.kind !== 'archived') return
  set({ browse: { ...browse, file }, content: '' })
  await reloadFile()
}

/** Keep (or stop keeping) this repo's review history in the repo. */
export async function setReviewInRepo(on: boolean) {
  const repo = get().repo
  if (!repo) return
  const r = await guard(api.settings(repo, on))
  if (!r) return
  set({ reviewInRepo: r.reviewInRepo })
  toast(
    r.reviewInRepo
      ? 'Review history is now kept in each change folder (.openspeccontrol-review.json). Commit it to share it.'
      : 'Review history stays in OpenSpecControl only.'
  )
}

/** Open a main spec, read-only. */
export async function openSpec(name: string) {
  set({
    browse: { kind: 'spec', name, file: `specs/${name}/spec.md` },
    change: null,
    file: null,
    content: '',
    comments: [],
    rounds: [],
    focusComment: null
  })
  await reloadFile()
}

export async function loadReview() {
  const { repo, change } = get()
  if (!repo || !change) return
  const r = await guard(api.review(repo, change))
  if (r && get().change === change) set({ comments: r.comments, rounds: r.rounds })
}

export const review = {
  add: (c: Parameters<typeof api.addComment>[0]) =>
    guard(api.addComment(c)).then((x) => {
      if (x) set({ focusComment: x.id })
    }),
  patch: (id: string, p: Parameters<typeof api.patchComment>[1]) => guard(api.patchComment(id, p)),
  remove: (id: string) => guard(api.deleteComment(id)),
  async send() {
    const { repo, change } = get()
    if (!repo || !change || !(await ensureAgent())) return
    const r = await guard(api.sendReview(repo, change))
    if (r) toast('Review sent to the agent')
  },
  async close() {
    const { repo, change } = get()
    if (repo && change) await guard(api.closeRound(repo, change))
  }
}

export function answerPermission(id: string, optionId: string | null, label: string) {
  const r = get().repo
  if (r) sendMsg({ type: 'permission', repo: r, id, optionId, label })
}
export function answerElicitation(
  id: string,
  action: 'accept' | 'decline' | 'cancel',
  content?: Record<string, unknown>
) {
  const r = get().repo
  if (r) sendMsg({ type: 'elicitation', repo: r, id, action, content })
}
export function setConfig(configId: string, value: string | boolean) {
  const r = get().repo
  if (r) sendMsg({ type: 'set_config', repo: r, configId, value })
}

export function setTheme(t: 'light' | 'dark' | 'system') {
  ls.set('theme', t)
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  // Fase 5.6: the title bar and menus follow the same choice
  try {
    void window.osc.setNativeTheme(t)
  } catch {
    /* preload missing */
  }
}
export const initialTheme = () =>
  (ls.get('theme') as 'light' | 'dark' | 'system' | null) ?? 'system'

/** Menu actions (ServerMsg 'menu', Fase 4.6). Cableadas: 'demo-repo' (5.7),
 *  'open-data-folder' (5.8), 'dependency-diagnostics' (6.4) y 'check-updates' (9.4). */
export function menuAction(action: MenuAction) {
  switch (action) {
    case 'add-folder':
      openAddFolder(true)
      break
    case 'rescan-repos':
      loadRepos(true)
      break
    case 'demo-repo':
      openDemoRepo(true) // el diálogo elige el agente; la carpeta la elige main
      break
    case 'open-data-folder':
      void openDataFolder()
      break
    case 'dependency-diagnostics':
      openDiagnostics(true)
      break
    case 'check-updates':
      void checkForUpdates()
      break
    default:
      toast(`Acción de menú «${action}» pendiente de su fase`)
  }
}

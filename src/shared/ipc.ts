// The IPC contract (Fase 3): the channels, the error envelope and OscApi, the
// one-and-only surface the renderer may call. It replaces Studio's REST routes
// and WebSocket (plan, tabla 4.2). Dependency-free: the preload bundles it, the
// renderer imports its types and the main process registers one handler per
// method. `pickFolder()`, `notify()`, `openExternal()` and friends arrived with
// Fase 5 (native integrations); `updateState()`, `checkForUpdates()`, `installUpdate()` and
// the `update_state` event arrived with Fase 9; `browse` is gone for good (Fase 5
// brought the native folder picker).

import type {
  AgentInfo,
  Anchor,
  ArchivedChange,
  ChangeSummary,
  ClientMsg,
  CommentKind,
  GitInfo,
  LifecycleAction,
  OptionalWorkflow,
  ReviewComment,
  ReviewRound,
  ServerMsg,
  SpecSummary,
  UpdateState,
  Workspace
} from './protocol.ts'

// ---- channels -----------------------------------------------------------------

/** One invoke channel per OscApi method: `osc:repos`, `osc:gitBranch`, ... */
export const methodChannel = (method: string) => `osc:${method}`
/** Renderer → main, realtime fan-in (ClientMsg, fire-and-forget). */
export const CLIENT_MSG_CHANNEL = 'osc:client-msg'
/** Main → renderer, realtime fan-out (ServerMsg). */
export const SERVER_MSG_CHANNEL = 'osc:server-msg'

// ---- error envelope --------------------------------------------------------------

// Electron rewrites the message of an exception thrown inside ipcMain.handle
// ("Error invoking remote method…"), so handlers never throw across the bridge:
// they answer this envelope and the preload turns `ok: false` back into a
// thrown Error with the core's own message. The codes replace Studio's
// 400/404/409/413/500 statuses (they mirror OscErrorCode in the core).

export type IpcErrorCode = 'invalid' | 'not_found' | 'conflict' | 'too_large' | 'internal'

export interface IpcError {
  code: IpcErrorCode
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

// ---- the API ---------------------------------------------------------------------

/** One external CLI of the dependency check (Fase 6): node, npx, openspec, git. */
export type ToolId = 'node' | 'npx' | 'openspec' | 'git'

/** How `config().tools` reports each external CLI the app relies on. */
export interface ToolStatus {
  id: ToolId
  found: boolean
  version?: string
  path?: string
  /** how to install it, shown when found is false (e.g. `npm install -g @fission-ai/openspec`) */
  hint?: string
}

/** `GET /api/config` */
export interface OscConfig {
  platform: string
  defaultAgent: string
  agents: AgentInfo[]
  /** external CLIs (node, npx, openspec, git) for the missing-tool warnings and the diagnostics dialog */
  tools: ToolStatus[]
}

/** `GET /api/changes` */
export interface OscChanges {
  active: ChangeSummary[]
  archived: string[]
  specs: SpecSummary[]
  workflows: OptionalWorkflow[]
  reviewInRepo: boolean
  /**
   * tarea 11.5: true while `active` is a local inference (the CLI has not
   * confirmed this content yet). A background refresh is running and the
   * `changes_updated` message tells the renderer to fetch again; the UI marks
   * the list so inferred data is never read as definitive.
   */
  stale?: boolean
  /** why the last refresh of a stale view failed (set together with stale) */
  refreshError?: string | null
}

/** Which change's pending files a git query is about. */
export interface GitScope {
  change?: string
  archived?: string
}

/** `POST /api/git/commit` */
export interface GitCommitBody {
  repo: string
  change?: string
  archived?: string
  files: string[]
  message: string
}

/** `POST /api/comments` */
export interface CommentCreateBody {
  repo: string
  change: string
  file: string | null
  anchor: Anchor | null
  kind: CommentKind
  body: string
}

/** `PATCH /api/comments/:id` */
export type CommentPatchBody = Partial<Pick<ReviewComment, 'body' | 'kind' | 'status'>>

/** `notify({ title, body, kind })`: an OS notification (Fase 5). */
export interface NotifyInput {
  title: string
  body?: string
  /** `attention` also flashes the taskbar entry until the window is focused. */
  kind?: 'info' | 'attention'
}

/** What `nativeTheme.themeSource` accepts (Fase 5). */
export type NativeThemeSetting = 'light' | 'dark' | 'system'

/** `createDemoRepo()`: the demo repo that Ayuda → Crear repositorio de demostración makes. */
export interface DemoRepoOutcome {
  /** The refreshed workspace, already containing the demo repo. */
  workspace: Workspace
  /** Id of the demo repo (its real absolute path): what the UI selects. */
  repo: string
  /** The active change waiting in "In review" (`add-hello-endpoint`). */
  change: string
  openspecOk: boolean
  gitOk: boolean
  /** What degraded (no openspec CLI, no git), for toasts. */
  warnings: string[]
}

/**
 * What `window.osc` exposes: one explicit function per operation plus the
 * realtime pair. The preload implements exactly this; the renderer declares it
 * on `window.osc` (src/preload/index.d.ts). A generic `invoke` is deliberately
 * NOT part of it: a compromised renderer must not reach channels the bridge
 * did not open.
 */
export interface OscApi {
  config(): Promise<OscConfig>
  /**
   * Estado actual de la actualización automática (Fase 9, electron-updater);
   * sus cambios llegan después como el ServerMsg `update_state`.
   */
  updateState(): Promise<UpdateState>
  repos(refresh?: boolean): Promise<Workspace>
  addRoot(path: string): Promise<Workspace>
  removeRoot(path: string): Promise<Workspace>
  init(repo: string, agent: string): Promise<{ ok: boolean; output: string }>
  changes(repo: string): Promise<OscChanges>
  archived(repo: string, name: string): Promise<ArchivedChange>
  settings(repo: string, reviewInRepo: boolean): Promise<{ reviewInRepo: boolean }>
  file(repo: string, path: string): Promise<{ content: string }>
  action(
    repo: string,
    action: LifecycleAction,
    change?: string,
    text?: string
  ): Promise<{ ok: true }>
  review(
    repo: string,
    change: string
  ): Promise<{ comments: ReviewComment[]; rounds: ReviewRound[] }>
  addComment(c: CommentCreateBody): Promise<ReviewComment>
  patchComment(id: string, patch: CommentPatchBody): Promise<ReviewComment>
  deleteComment(id: string): Promise<{ ok: true }>
  sendReview(repo: string, change: string): Promise<ReviewRound>
  closeRound(repo: string, change: string): Promise<{ ok: true }>
  git(repo: string, scope?: GitScope): Promise<GitInfo>
  gitBranch(repo: string, change: string): Promise<GitInfo>
  gitCommit(b: GitCommitBody): Promise<{ commit: string; files: number }>
  // ---- Fase 5: native integrations ------------------------------------------------
  /**
   * Native folder picker (`dialog.showOpenDialog`): adds the chosen folder as a
   * workspace root and answers the refreshed Workspace, or null when the user
   * cancelled. Validation failures (folder gone, whole drive) reject like any
   * other method, so the renderer toasts the core's own message.
   */
  pickFolder(): Promise<Workspace | null>
  /** OS notification, shown by the main only while the window is unfocused. */
  notify(n: NotifyInput): Promise<{ ok: true }>
  /** Open a link in the system browser; only http:, https: and mailto: pass. */
  openExternal(url: string): Promise<{ opened: boolean }>
  /** Mirror the renderer's theme choice on the window title bar and menus. */
  setNativeTheme(t: NativeThemeSetting): Promise<{ ok: true }>
  /** Help → data folder: open `~/.openspeccontrol` in the OS file manager. */
  openDataFolder(): Promise<{ ok: true }>
  /** Repo header → reveal an added repo in the OS file manager. */
  showInExplorer(repo: string): Promise<{ ok: true }>
  /**
   * Help → demo repository: the main shows the native folder picker, creates
   * `<folder>/hello-app` (async; `agent` decides the `openspec init --tools`, null
   * skips it) and adds it to the workspace. null when the picker was cancelled.
   */
  createDemoRepo(agent: string | null): Promise<DemoRepoOutcome | null>
  // ---- Fase 9: actualización automática -----------------------------------------
  /**
   * Ayuda → Buscar actualizaciones: fuerza la comprobación y responde el estado
   * resultante (`idle` = ya tienes la última versión). Si ya hay una en curso, la espera.
   */
  checkForUpdates(): Promise<UpdateState>
  /**
   * "Reiniciar para actualizar": con la actualización descargada y trabajo en curso
   * (agente `busy` o decisiones pendientes) pide la confirmación de cierre seguro y,
   * si se acepta, cierra e instala. `installing: false` = el usuario canceló.
   */
  installUpdate(): Promise<{ installing: boolean }>
  /** Realtime in: one ClientMsg to the core (channel `osc:client-msg`). */
  send(msg: ClientMsg): void
  /** Realtime out: core events (channel `osc:server-msg`); returns the unsubscribe. */
  onMessage(cb: (m: ServerMsg) => void): () => void
}

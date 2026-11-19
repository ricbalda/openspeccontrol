// The core: everything OpenSpec Studio's HTTP/WS handlers did, without a
// transport. OscCore owns the agent hub, the realtime fan-out (Subscriber), the
// per-repo watchers and one method per operation; Fase 3 wires it to IPC and
// Fase 4 calls shutdown() on quit. Nothing here imports electron or a web stack.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import type { z } from 'zod'
import type {
  ArchivedChange,
  ClientMsg,
  GitInfo,
  ReviewComment,
  ReviewRound,
  ServerMsg,
  SessionState,
  Workspace
} from '@shared/protocol.ts'
import { agents, DEFAULT_AGENT, getAgent } from './agents.ts'
import { cliViews, closeDb, comments, events, migrateRepoIds, openDb, rounds } from './db.ts'
import * as drafts from './drafts.ts'
import type { Draft, DraftSummary } from './drafts.ts'
import { Hub } from './acp/hub.ts'
import * as drafts from './drafts.ts'
import * as openspec from './openspec.ts'
import { hasOpenSpec, initDataDir, oscVersion, safeResolve, setVersion } from './repos.ts'
import { MAX_ACTION_TEXT, type Draft, type DraftMode } from '@shared/ipc.ts'
import {
  addRoot,
  findRepos,
  loadWorkspaceConfig,
  removeRoot,
  repoPath,
  reviewInRepo,
  roots,
  seedRoots,
  setReviewInRepo
} from './workspace.ts'
import {
  importRecords,
  LEGACY_REVIEW_FILE,
  REVIEW_FILE,
  readReviewFile,
  writeReviewFile
} from './review/repoFile.ts'
import { commitFiles, createBranch, gitInfo, pendingFiles, scopePaths } from './git.ts'
import {
  closeRound,
  closeStaleRounds,
  createComment,
  onTurnEnd,
  patchComment,
  sendReview
} from './review/service.ts'
import {
  actionBody,
  changeBody,
  clientMsg,
  commentCreate,
  commentPatch,
  describeIssues,
  gitBranchBody,
  gitCommitBody,
  initBody,
  rootBody,
  settingsBody
} from './schemas.ts'
import { OscError } from './errors.ts'
import { importFromStudio } from './legacy-import.ts'

/** Who listens to a repo's realtime messages (Fase 3: one per webContents). */
export interface Subscriber {
  id: string | number
  send: (m: ServerMsg) => void
}

export type RootInput = z.output<typeof rootBody>
export type InitInput = z.output<typeof initBody>
export type ActionInput = z.output<typeof actionBody>
export type ChangeInput = z.output<typeof changeBody>
export type GitBranchInput = z.output<typeof gitBranchBody>
export type GitCommitInput = z.output<typeof gitCommitBody>
export type SettingsInput = z.output<typeof settingsBody>
export type CommentCreateInput = z.output<typeof commentCreate>
export type CommentPatchInput = z.output<typeof commentPatch>

/** Delay before a background CLI refresh starts, so it does not compete with the paint. */
const REFRESH_DEFER_MS = 300

export class OscCore {
  private subscribers = new Map<string, Set<Subscriber>>() // repo -> subscribers
  private watchers = new Map<string, FSWatcher>()
  private debounce = new Map<string, NodeJS.Timeout>()
  private stopping = false
  private hub: Hub

  constructor() {
    this.hub = new Hub({
      onEvent: (repo, entry) => this.broadcast(repo, { type: 'event', repo, entry }),
      onState: (repo, session) => {
        this.broadcast(repo, { type: 'session', repo, session })
        this.notifySessionObservers(repo, session)
        this.syncWatcher(repo)
      }
    })
  }

  // ---- workspace -----------------------------------------------------------

  async config() {
    return {
      defaultAgent: DEFAULT_AGENT,
      platform: process.platform,
      version: oscVersion(),
      agents: agents().map(({ id, label, openspecTool }) => ({ id, label, openspecTool }))
    }
  }

  private async listRepos(refresh = false): Promise<Workspace> {
    const { repos, truncated } = await findRepos(refresh)
    return {
      roots: roots().map((r) => ({ ...r, truncated: truncated.includes(r.path) })),
      repos: repos.map((r) => ({
        ...r,
        openspec: hasOpenSpec(r.id),
        session: this.hub.get(r.id)?.state() ?? null
      }))
    }
  }

  async repos(refresh = false): Promise<Workspace> {
    return this.listRepos(refresh)
  }

  async addRoot(b: RootInput): Promise<Workspace> {
    try {
      addRoot(b.path)
    } catch (e) {
      throw new OscError('invalid', (e as Error).message)
    }
    return this.listRepos(true)
  }

  async removeRoot(b: RootInput): Promise<Workspace> {
    // stop agents in repos that are no longer reachable
    removeRoot(b.path)
    for (const id of this.hub.repos()) if (!repoPath(id)) this.hub.stop(id)
    return this.listRepos()
  }

  async init(b: InitInput): Promise<{ ok: boolean; output: string }> {
    const { repo, abs } = this.repoOf(b.repo)
    const agent = getAgent(b.agent)
    if (!agent?.openspecTool) throw new OscError('invalid', 'agent has no OpenSpec integration')
    if (hasOpenSpec(abs)) throw new OscError('conflict', 'already initialized')
    const r = await openspec.init(abs, agent.openspecTool)
    this.hub.emit(repo, {
      kind: 'notice',
      level: r.ok ? 'info' : 'error',
      text: `openspec init --tools ${agent.openspecTool}\n${r.out.trim()}`
    })
    return { ok: r.ok, output: r.out }
  }

  // ---- openspec ------------------------------------------------------------

  async changes(repo: string) {
    const { repo: r, abs } = this.repoOf(repo)
    const empty = {
      specs: openspec.listSpecs(abs),
      workflows: openspec.installedWorkflows(abs),
      reviewInRepo: reviewInRepo(r)
    }
    if (!fs.existsSync(path.join(abs, 'openspec', 'changes')))
      return { ...empty, active: [], archived: [], stale: false, refreshError: null }
    // tarea 11.5: answer with what is already known — the CLI cache, the
    // persisted snapshot (same signature) or a local inference — and confirm a
    // stale view in the background; changes_updated then tells the renderer to
    // fetch again. Waiting for the CLI here cost ~2 s per cold refresh.
    const cur = openspec.currentView(abs)
    if (cur.stale) this.refreshInBackground(r, abs)
    const [active, archived] = await Promise.all([
      openspec.listChanges(abs, (ch) => comments.list(r, ch), {
        view: cur.view,
        provisional: cur.stale
      }),
      openspec.listArchived(abs)
    ])
    return {
      ...empty,
      active,
      archived,
      stale: cur.stale,
      refreshError: cur.refreshError
    }
  }

  /** One background refresh per repo; subscribers hear changes_updated when it settles. */
  private refreshing = new Set<string>()
  private refreshInBackground(repo: string, abs: string) {
    if (this.stopping || this.refreshing.has(repo)) return
    this.refreshing.add(repo)
    // deferred: the three CLI processes would compete for CPU with the very paint
    // this refresh follows (measured: first paint of 40 changes varied 0.3-1.1 s)
    void new Promise<void>((resolve) => setTimeout(resolve, REFRESH_DEFER_MS))
      .then(() => (this.stopping ? 'backoff' : openspec.refreshView(abs)))
      .then((outcome) => {
        // 'backoff' (same content just failed) changes nothing: stay quiet, or
        // the message → refetch → refresh cycle would spin on a broken CLI
        if (!this.stopping && outcome !== 'backoff')
          this.broadcast(repo, { type: 'changes_updated', repo })
      })
      .finally(() => this.refreshing.delete(repo))
  }

  file(repo: string, file: unknown): { content: string } {
    const { abs } = this.repoOf(repo)
    const base = path.join(abs, 'openspec')
    const resolved = fs.existsSync(base)
      ? safeResolve(base, typeof file === 'string' ? file : '')
      : null
    if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
      throw new OscError('not_found', 'file not found')
    const content = openspec.readDoc(resolved)
    if (content === null)
      throw new OscError('too_large', `file is larger than ${openspec.MAX_DOC_BYTES} bytes`)
    return { content }
  }

  // lifecycle buttons: the core owns the agent-specific command syntax
  async action(b: ActionInput): Promise<{ ok: true }> {
    const { repo, abs } = this.repoOf(b.repo)
    const s = this.hub.get(repo)
    if (!s) throw new OscError('conflict', 'no agent session')
    const { action } = b
    const needsChange = ['update', 'apply', 'verify', 'sync', 'archive'].includes(action)
    if (needsChange && !this.validChange(abs, b.change))
      throw new OscError('invalid', 'unknown change')
    const text = (b.text ?? '').trim()
    const args = [needsChange ? b.change : '', text].filter(Boolean).join(' ')
    if (action === 'propose' && !text) throw new OscError('invalid', 'describe the change')
    const label = `${action[0].toUpperCase()}${action.slice(1)}${needsChange ? ` · ${b.change}` : ''}`
    // a new lifecycle step supersedes a review that is waiting for Continue
    const open = rounds.running(repo)
    if (open && closeRound(repo, abs, open.change)) this.reviewChanged(repo, open.change)
    s.prompt(s.agent.command(action, args), label).catch(() => {})
    return { ok: true }
  }

  // ---- drafts (add-proposal-drafts, design D-5) --------------------------------

  /**
   * Envía un borrador al agente de su repositorio reutilizando action(): exige
   * un borrador sin enviar, el tope de 4000 caracteres y contenido no vacío
   * para propose, y solo lo marca como enviado cuando action() no lanza. Si no
   * hay sesión o el agente está ocupado, el borrador queda tal cual (el
   * renderer conecta el agente antes con ensureAgent, como runAction).
   */
  async sendDraft(id: string, mode: DraftMode): Promise<Draft> {
    const d = await drafts.get(id)
    if (!d) throw new OscError('not_found', 'draft not found')
    const { repo } = this.repoOf(d.repo)
    if (d.status !== 'draft') throw new OscError('conflict', 'draft already sent')
    const body = d.body.trim()
    if (mode === 'propose' && !body) throw new OscError('invalid', 'describe the change')
    if (body.length > MAX_ACTION_TEXT)
      throw new OscError('too_large', `draft is longer than ${MAX_ACTION_TEXT} characters`)
    // action() rechaza solo la falta de sesión: no espera el turno
    // (s.prompt(...).catch(() => {})), así que un agente ocupado habría que
    // comprobarlo aquí o el borrador se marcaría enviado sin llegar al agente.
    const s = this.hub.get(repo)
    if (s?.status !== 'ready')
      throw new OscError('conflict', s ? 'agent is busy' : 'connect an agent first')
    await this.action({ repo, action: mode, text: body })
    return drafts.markSent(id, mode)
  }

  // archived change: its artifacts plus the comments and review rounds kept under its old name
  async archived(repo: string, name: string): Promise<ArchivedChange> {
    const { repo: r, abs } = this.repoOf(repo)
    if (!/^[\w.-]+$/.test(name) || !fs.existsSync(openspec.archivedDir(abs, name)))
      throw new OscError('not_found', 'archived change not found')
    const change = openspec.archivedChangeName(name)
    // the history that moved with the change wins; otherwise look it up by name in our
    // database, unless a new active change took the same name (then it is that change's)
    const fromFile = readReviewFile(openspec.archivedDir(abs, name), r)
    const historyHidden = !fromFile && fs.existsSync(openspec.changeDir(abs, change))
    return {
      name,
      change,
      files: openspec.archivedFiles(abs, name),
      historyHidden,
      comments: fromFile?.comments ?? (historyHidden ? [] : comments.list(r, change)),
      rounds: fromFile?.rounds ?? (historyHidden ? [] : rounds.list(r, change))
    }
  }

  async settings(b: SettingsInput): Promise<{ reviewInRepo: boolean }> {
    const { repo: r, abs } = this.repoOf(b.repo)
    setReviewInRepo(r, b.reviewInRepo)
    // turning it on writes the history that already exists
    if (b.reviewInRepo) {
      const dir = path.join(abs, 'openspec', 'changes')
      for (const ch of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (ch !== 'archive' && this.validChange(abs, ch)) this.exportReview(r, ch)
      }
    }
    return { reviewInRepo: reviewInRepo(r) }
  }

  // ---- drafts (add-proposal-drafts, fase 1) ----------------------------------
  // métodos delgados: comprueban el repo con repoOf() y delegan en drafts.ts;
  // las reglas (conflict, too_large, not_found) las impone el módulo

  async drafts(repo: string, query?: string): Promise<DraftSummary[]> {
    this.repoOf(repo)
    return drafts.list(repo, query)
  }

  async draft(id: string): Promise<Draft> {
    const d = drafts.get(id)
    if (!d) throw new OscError('not_found', 'draft not found')
    return d
  }

  async createDraft(repo: string): Promise<Draft> {
    this.repoOf(repo)
    return drafts.create(repo)
  }

  async saveDraft(id: string, patch: { title?: string; body?: string }): Promise<Draft> {
    return drafts.save(id, patch)
  }

  async duplicateDraft(id: string): Promise<Draft> {
    return drafts.duplicate(id)
  }

  async deleteDraft(id: string): Promise<{ ok: true }> {
    drafts.remove(id)
    return { ok: true }
  }

  // ---- review --------------------------------------------------------------

  async review(
    repo: string,
    change: unknown
  ): Promise<{ comments: ReviewComment[]; rounds: ReviewRound[] }> {
    const { repo: r, abs } = this.repoOf(repo)
    if (!this.validChange(abs, change)) return { comments: [], rounds: [] }
    // a change reviewed elsewhere (e.g. a teammate's branch) brings its history in the repo
    if (!comments.list(r, change).length && !rounds.list(r, change).length) {
      const file = readReviewFile(openspec.changeDir(abs, change), r)
      if (file) {
        const rec = importRecords(
          file,
          change,
          { comment: (id) => !!comments.get(id), round: (id) => !!rounds.get(id) },
          () => randomUUID().slice(0, 8)
        )
        for (const cm of rec.comments) comments.put(cm)
        for (const rd of rec.rounds) rounds.put(rd, {})
      }
    }
    return { comments: comments.list(r, change), rounds: rounds.list(r, change) }
  }

  async addComment(b: CommentCreateInput): Promise<ReviewComment> {
    const { repo, abs } = this.repoOf(b.repo)
    if (!this.validChange(abs, b.change)) throw new OscError('invalid', 'unknown change')
    const cm = createComment(repo, b.change, b)
    this.reviewChanged(repo, b.change)
    return cm
  }

  async patchComment(id: string, b: CommentPatchInput): Promise<ReviewComment> {
    const cm = comments.get(id)
    if (!cm) throw new OscError('not_found', 'not found')
    const next = patchComment(cm, b)
    if (!next) throw new OscError('conflict', 'comment is in a running review')
    this.reviewChanged(cm.repo, cm.change)
    return next
  }

  async deleteComment(id: string): Promise<{ ok: true }> {
    const cm = comments.get(id)
    if (!cm) throw new OscError('not_found', 'not found')
    if (cm.status === 'sent') throw new OscError('conflict', 'comment is in a running review')
    comments.delete(cm.id)
    this.reviewChanged(cm.repo, cm.change)
    return { ok: true }
  }

  async sendReview(b: ChangeInput) {
    const { repo, abs } = this.repoOf(b.repo)
    if (!this.validChange(abs, b.change)) throw new OscError('invalid', 'unknown change')
    const s = this.hub.get(repo)
    if (s?.status !== 'ready')
      throw new OscError('conflict', s ? 'agent is busy' : 'connect an agent first')
    return sendReview(s, repo, abs, b.change, () => this.reviewChanged(repo, b.change))
  }

  async closeRoundOf(b: ChangeInput): Promise<{ ok: true }> {
    const { repo, abs } = this.repoOf(b.repo)
    if (!this.validChange(abs, b.change)) throw new OscError('invalid', 'unknown change')
    if (this.hub.get(repo)?.status === 'busy')
      throw new OscError('conflict', 'agent is still working')
    if (!closeRound(repo, abs, b.change)) throw new OscError('conflict', 'no open review round')
    this.reviewChanged(repo, b.change)
    return { ok: true }
  }

  // ---- git -----------------------------------------------------------------
  // branch and friends; read-only (git actions are separate). With a change or
  // archived name, also the uncommitted files that change's commit would hold.

  private gitScope(
    abs: string,
    q: { change?: string; archived?: string }
  ): { change: string } | { archived: string; change: string } | null {
    if (q.archived) {
      if (!/^[\w.-]+$/.test(q.archived) || !fs.existsSync(openspec.archivedDir(abs, q.archived)))
        return null
      return { archived: q.archived, change: openspec.archivedChangeName(q.archived) }
    }
    return this.validChange(abs, q.change) ? { change: q.change } : null
  }

  async git(repo: string, q: { change?: string; archived?: string } = {}): Promise<GitInfo> {
    const { abs } = this.repoOf(repo)
    const info = await gitInfo(abs)
    const scope = info.repo ? this.gitScope(abs, q) : null
    return {
      ...info,
      pending: scope
        ? (await pendingFiles(abs, scopePaths(scope))).map(({ path: p, status }) => ({
            path: p,
            status
          }))
        : []
    }
  }

  // "Create branch change/<name>": from the current HEAD, the change's files come along
  async gitBranch(b: GitBranchInput): Promise<GitInfo> {
    const { repo, abs } = this.repoOf(b.repo)
    if (!this.validChange(abs, b.change)) throw new OscError('invalid', 'unknown change')
    if (this.agentBusy(repo))
      throw new OscError('conflict', 'The agent is still working. Wait for it to finish first.')
    const name = `change/${b.change}`
    const r = await createBranch(abs, name)
    if (!r.ok) throw new OscError('conflict', r.output)
    this.hub.emit(repo, { kind: 'notice', level: 'info', text: `git switch -c ${name}` })
    return gitInfo(abs)
  }

  // "Commit": exactly the files the user saw, and only files of that change's scope
  async gitCommit(b: GitCommitInput): Promise<{ commit: string; files: number }> {
    const { repo, abs } = this.repoOf(b.repo)
    const scope = this.gitScope(abs, b)
    if (!scope) throw new OscError('invalid', 'unknown change')
    if (this.agentBusy(repo))
      throw new OscError('conflict', 'The agent is still working. Wait for it to finish first.')
    const pending = await pendingFiles(abs, scopePaths(scope))
    const wanted = new Set(b.files)
    const files = pending.filter((f) => wanted.has(f.path))
    if (!files.length)
      throw new OscError('conflict', 'Nothing to commit: those files have no changes any more.')
    const r = await commitFiles(abs, files, b.message)
    if (!r.ok) {
      this.hub.emit(repo, {
        kind: 'notice',
        level: 'error',
        text: `git commit failed\n${r.output}`
      })
      throw new OscError('internal', r.output || 'git commit failed')
    }
    this.hub.emit(repo, {
      kind: 'notice',
      level: 'info',
      text: `git commit ${r.commit}: ${b.message.split('\n')[0]} (${files.length} file${files.length === 1 ? '' : 's'})`
    })
    return { commit: r.commit!, files: files.length }
  }

  // ---- realtime fan-out ------------------------------------------------------

  subscribe(sub: Subscriber, repo: string): void {
    let set = this.subscribers.get(repo)
    if (!set) this.subscribers.set(repo, (set = new Set()))
    set.add(sub)
    this.syncWatcher(repo)
  }

  /** Drop a subscriber everywhere (Fase 3 calls it when its webContents goes away). */
  unsubscribe(sub: Subscriber): void {
    const affected: string[] = []
    for (const [repo, set] of this.subscribers) if (set.delete(sub)) affected.push(repo)
    for (const repo of affected) {
      if (!this.subscribers.get(repo)?.size) this.subscribers.delete(repo)
      this.syncWatcher(repo)
    }
  }

  /**
   * Stop following one repo only (multi-repo rail): the subscriber keeps the
   * others. The repo's watcher closes when nobody listens and no agent runs
   * there.
   */
  unsubscribeRepo(sub: Subscriber, repo: string): void {
    const set = this.subscribers.get(repo)
    if (!set?.delete(sub)) return
    if (!set.size) this.subscribers.delete(repo)
    this.syncWatcher(repo)
  }

  private broadcast(repo: string, m: ServerMsg) {
    this.subscribers.get(repo)?.forEach((s) => s.send(m))
  }

  // ---- session observers (Fase 5: the pending-decisions badge) -----------------

  private sessionObservers = new Set<(repo: string, session: SessionState | null) => void>()

  /**
   * Observe every session state change without subscribing to a repo (the
   * desktop badge sums pendingInteractions across all repos). Returns the off
   * switch.
   */
  onSessionChange(cb: (repo: string, session: SessionState | null) => void): () => void {
    this.sessionObservers.add(cb)
    return () => this.sessionObservers.delete(cb)
  }

  private notifySessionObservers(repo: string, session: SessionState | null): void {
    for (const cb of this.sessionObservers) cb(repo, session)
  }

  // watch <repo>/openspec while anyone looks at the repo or an agent runs there
  private syncWatcher(repo: string) {
    const want = (this.subscribers.get(repo)?.size ?? 0) > 0 || !!this.hub.get(repo)
    const abs = repoPath(repo)
    if (want && abs && !this.watchers.has(repo)) {
      // WSL: inotify is unreliable on Windows drives (/mnt/c), so poll there
      const poll = abs.startsWith('/mnt/')
      const w = chokidar.watch(path.join(abs, 'openspec'), {
        ignoreInitial: true,
        depth: 8,
        awaitWriteFinish: { stabilityThreshold: 150 },
        ignored: (p: string) =>
          path.basename(p) === REVIEW_FILE || path.basename(p) === LEGACY_REVIEW_FILE, // we write those ourselves
        usePolling: poll,
        interval: 700,
        binaryInterval: 2000
      })
      w.on('all', (_ev, file) => {
        clearTimeout(this.debounce.get(repo))
        this.debounce.set(
          repo,
          setTimeout(
            () =>
              this.broadcast(repo, {
                type: 'artifacts_changed',
                repo,
                path: path.relative(abs, file)
              }),
            250
          )
        )
      })
      this.watchers.set(repo, w)
    } else if (!want && this.watchers.has(repo)) {
      this.watchers.get(repo)!.close()
      this.watchers.delete(repo)
    }
  }

  /** Keep the repo's copy of a change's review history current (repos that opted in). */
  private exportReview(repo: string, change: string) {
    const abs = repoPath(repo)
    if (!abs || !reviewInRepo(repo)) return
    try {
      writeReviewFile(
        openspec.changeDir(abs, change),
        change,
        comments.list(repo, change),
        rounds.list(repo, change)
      )
    } catch (e) {
      console.warn(`review export for ${change} failed:`, (e as Error).message)
    }
  }

  private reviewChanged(repo: string, change: string) {
    this.exportReview(repo, change)
    this.broadcast(repo, { type: 'review_changed', repo, change })
  }

  /** One message from a subscribed client (Fase 3: the 'osc:client-msg' channel). */
  async handleClientMsg(sub: Subscriber, m: ClientMsg): Promise<void> {
    const parsed = clientMsg.safeParse(m)
    if (!parsed.success)
      return sub.send({
        type: 'error',
        message: `invalid message: ${describeIssues(parsed.error)}`
      })
    const msg = parsed.data
    const abs = repoPath(msg.repo)
    if (!abs) return sub.send({ type: 'error', message: 'repo not found' })
    const s = this.hub.get(msg.repo)
    try {
      switch (msg.type) {
        case 'subscribe':
          this.subscribe(sub, msg.repo)
          sub.send({ type: 'session', repo: msg.repo, session: s?.state() ?? null })
          sub.send({ type: 'replay', repo: msg.repo, entries: events.list(msg.repo) })
          break
        case 'unsubscribe':
          this.unsubscribeRepo(sub, msg.repo)
          break
        case 'start': {
          const agent = getAgent(msg.agent)
          if (!agent) return sub.send({ type: 'error', message: `unknown agent ${msg.agent}` })
          this.subscribe(sub, msg.repo)
          await this.hub.start(msg.repo, abs, agent, msg.resume !== false)
          sub.send({ type: 'replay', repo: msg.repo, entries: events.list(msg.repo) })
          break
        }
        case 'stop':
          this.hub.stop(msg.repo)
          break
        case 'prompt': {
          // free-form turns (e.g. "Continue") may finish an interrupted review round
          const res = await s?.prompt(msg.text)
          const ch = res && onTurnEnd(msg.repo, abs, res.stopReason, res.reply)
          if (ch) this.reviewChanged(msg.repo, ch)
          break
        }
        case 'cancel':
          s?.cancel()
          break
        case 'permission':
          s?.answerPermission(
            msg.id,
            msg.optionId,
            msg.label ?? (msg.optionId ? 'answered' : 'cancelled')
          )
          break
        case 'elicitation':
          s?.answerElicitation(msg.id, msg.action, msg.content)
          break
        case 'set_config':
          await s?.setConfig(msg.configId, msg.value)
          break
      }
    } catch (e) {
      sub.send({ type: 'error', message: String((e as Error)?.message || e) })
    }
  }

  /** Live sessions, for the safe-close check (Fase 4) and tests. */
  sessionStates(): { repo: string; state: SessionState }[] {
    return this.hub.repos().map((repo) => ({ repo, state: this.hub.get(repo)!.state() }))
  }

  /** Watchers still open (tests assert shutdown() closed them all). */
  get activeWatchers(): number {
    return this.watchers.size
  }

  async shutdown(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.hub.stopAll()
    for (const t of this.debounce.values()) clearTimeout(t)
    this.debounce.clear()
    // chokidar polling (WSL /mnt/*) keeps timers alive until closed
    await Promise.allSettled([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
    openspec.bindViewStore(null) // a late CLI answer must not write to the closed db
    closeDb() // checkpoints the WAL
  }

  // ---- shared helpers ---------------------------------------------------------

  private repoOf(repo: string): { repo: string; abs: string } {
    const abs = repoPath(repo)
    if (!abs) throw new OscError('not_found', 'repo not found')
    return { repo, abs }
  }

  private validChange(abs: string, change: unknown): change is string {
    return (
      typeof change === 'string' &&
      /^[\w.-]+$/.test(change) &&
      fs.existsSync(openspec.changeDir(abs, change))
    )
  }

  private agentBusy(repo: string) {
    return this.hub.get(repo)?.status === 'busy'
  }
}

// ---- explicit startup ---------------------------------------------------------

/**
 * Rewrite relative repo ids (Studio < 0.3 legacy data) to absolute paths and
 * keep their folders listed. Only runs when REPOS_ROOT is set.
 */
export function migrateLegacy(reposRoot: string | null): void {
  if (!reposRoot) return
  seedRoots(
    migrateRepoIds(path.resolve(reposRoot), {
      exists: (p) => {
        try {
          return fs.statSync(p).isDirectory()
        } catch {
          return false
        }
      },
      real: (p) => {
        try {
          return fs.realpathSync.native(p)
        } catch {
          return p
        }
      },
      join: (a, b) => path.join(a, b)
    })
  )
}

export interface OscCoreOptions {
  /** data dir (default: OSC_DATA or ~/.openspeccontrol) */
  dataDir?: string
  /** app version sent to agents (the app passes app.getVersion(); default: package.json) */
  version?: string
  /** env overrides for the vars read at startup (OSC_DB, REPOS_ROOT); default: process.env */
  env?: Record<string, string | undefined>
  /** Studio data dir to import from (default: ~/.openspec-studio); tests point it at a fixture */
  fromStudio?: string
}

/**
 * Run the explicit startup sequence and return the core: create the data dir,
 * import Studio's data (once, before the db exists), open the db, load the
 * workspace config, migrate legacy repo ids and close rounds a crash left open.
 * Importing any module above does none of this.
 */
export function createOscCore(opts: OscCoreOptions = {}): OscCore {
  const env = { ...process.env, ...opts.env }
  const dir = path.resolve(
    opts.dataDir ?? env.OSC_DATA ?? path.join(os.homedir(), '.openspeccontrol')
  )
  initDataDir(dir)
  if (opts.version) setVersion(opts.version)
  const imported = importFromStudio({
    from: opts.fromStudio ?? path.join(os.homedir(), '.openspec-studio'),
    to: dir
  })
  if (!imported.imported && imported.reason && imported.reason !== 'source not found')
    console.warn(imported.reason) // start with empty data; retry by deleting the data dir
  openDb(env.OSC_DB || path.join(dir, 'openspeccontrol.db'))
  // tarea 11.5: the CLI's confirmed views survive restarts in the app's db
  openspec.bindViewStore(cliViews)
  loadWorkspaceConfig(env.REPOS_ROOT ?? null)
  migrateLegacy(env.REPOS_ROOT ?? null)
  closeStaleRounds(repoPath, rounds.repos())
  return new OscCore()
}

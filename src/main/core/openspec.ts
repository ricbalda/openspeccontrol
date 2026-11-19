import fs from 'node:fs'
import path from 'node:path'
import { runCmd } from './proc.ts'
import { LEGACY_REVIEW_FILE, REVIEW_FILE } from './review/repoFile.ts'
import type {
  ArtifactStatus,
  OptionalWorkflow,
  ChangeStage,
  ChangeSummary,
  ChangeValidation,
  ReviewComment,
  SpecSummary,
  StaleArtifact
} from '@shared/protocol.ts'

const OPENSPEC = process.env.OPENSPEC_BIN || 'openspec'
// eslint-disable-next-line no-control-regex -- stripping ANSI escape sequences is the point
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// FORCE_COLOR (set by some shells / npm) overrides NO_COLOR and makes node print a
// warning on stderr; drop it so output stays plain. Telemetry is off by default for
// these calls: the app runs the CLI on every refresh, and behind a proxy each call
// waits ~10s for the telemetry request to time out. An explicit setting wins.
const cliEnv = () => {
  const { FORCE_COLOR: _f, ...env } = process.env
  return { ...env, NO_COLOR: '1', OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY ?? '0' }
}

export function run(
  args: string[],
  cwd: string,
  timeout = 60_000
): Promise<{ ok: boolean; out: string; stdout: string; stderr: string }> {
  return runCmd(OPENSPEC, args, { cwd, timeout, env: cliEnv() }).then((r) => {
    const stdout = stripAnsi(r.stdout),
      stderr = stripAnsi(r.stderr)
    return { ok: r.ok, out: stdout + stderr, stdout, stderr }
  })
}

async function runJson<T>(args: string[], cwd: string): Promise<T | null> {
  const { stdout, stderr } = await run([...args, '--json'], cwd)
  // openspec may exit non-zero with valid JSON (e.g. root: null). Parse stdout only:
  // stderr can carry unrelated warnings that would corrupt the JSON.
  const start = stdout.search(/[[{]/)
  if (start >= 0) {
    try {
      return JSON.parse(stdout.slice(start)) as T
    } catch {
      /* fall through */
    }
  }
  console.warn(
    `openspec ${args.join(' ')} --json: unparseable output`,
    (stdout + stderr).slice(0, 500)
  )
  return null
}

export function init(repoAbs: string, tool: string) {
  return run(['init', '--tools', tool, '--no-animation', repoAbs], repoAbs, 120_000)
}

const walkMd = (dir: string, base = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return walkMd(full, base)
    return e.name.endsWith('.md') ? [path.relative(base, full).split(path.sep).join('/')] : []
  })

const ORDER = ['proposal.md', 'design.md', 'tasks.md']
const fileOrder = (f: string) => {
  const i = ORDER.indexOf(f)
  return i < 0 ? (f.startsWith('specs/') ? 1.5 : 9) : i
}

/** Spec documents are small; refuse to load anything bigger into memory / the db / the browser. */
export const MAX_DOC_BYTES = Number(process.env.MAX_DOC_BYTES || 2 * 1024 * 1024)

/** Read a document, or null when it is larger than MAX_DOC_BYTES. */
export function readDoc(file: string): string | null {
  return fs.statSync(file).size > MAX_DOC_BYTES ? null : fs.readFileSync(file, 'utf8')
}

export const changeDir = (repoAbs: string, change: string) =>
  path.join(repoAbs, 'openspec', 'changes', change)

export function changeFiles(repoAbs: string, change: string): string[] {
  const dir = changeDir(repoAbs, change)
  if (!fs.existsSync(dir)) return []
  return walkMd(dir).sort((a, b) => fileOrder(a) - fileOrder(b) || a.localeCompare(b))
}

/**
 * Stage is our own notion, mapped to the next button the UI offers:
 *  draft    → planning artifacts still missing (agent is proposing)
 *  review   → planning complete, or user comments still open
 *  ready    → reviewed (no open comments), nothing implemented yet
 *  applying → some tasks done
 *  done     → all tasks done → sync / archive
 */
function stageOf(
  c: { isPlanningComplete: boolean; completedTasks: number; totalTasks: number },
  open: number,
  reviewed: boolean,
  provisional = false
): ChangeStage {
  if (c.totalTasks > 0 && c.completedTasks >= c.totalTasks) return 'done'
  if (c.completedTasks > 0) return 'applying'
  if (!c.isPlanningComplete) return 'draft'
  if (open > 0 || !reviewed) return 'review'
  // an inferred view carries no validation: "ready" waits for the CLI to confirm
  return provisional ? 'review' : 'ready'
}

interface ListJson {
  changes?: {
    name: string
    completedTasks: number
    totalTasks: number
    lastModified: string
    status: string
  }[]
}
interface StatusJson {
  changeName: string
  artifacts: ArtifactStatus[]
  isPlanningComplete: boolean
  isComplete: boolean
}

/**
 * Fingerprint of everything under <repo>/openspec (path, size, mtime of every
 * entry). Cheap next to running the CLI, which takes seconds on some setups.
 */
export function openspecSignature(repoAbs: string): string {
  const parts: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // our own review files: the CLI's answer doesn't depend on them (the legacy
      // one belongs to Studio and we never rewrite it, but it must not count either)
      if (e.name === REVIEW_FILE || e.name === LEGACY_REVIEW_FILE) continue
      const full = path.join(dir, e.name)
      try {
        const st = fs.statSync(full)
        // a folder's own mtime changes whenever any file is added to it (including ours);
        // its entries are listed anyway, so record folders by name only
        if (st.isDirectory()) {
          parts.push(`${full}/`)
          walk(full)
        } else parts.push(`${full}|${st.size}|${st.mtimeMs}`)
      } catch {
        /* vanished meanwhile */
      }
    }
  }
  walk(path.join(repoAbs, 'openspec'))
  return parts.join('\n')
}

// The CLI's view of a repo only changes when files under openspec/ do. Review
// comments are not files, so resolving one (which refreshes the change list)
// must not wait for two CLI runs again.
interface ValidateJson {
  items?: { id: string; type: string; valid: boolean; issues?: ChangeValidation['issues'] }[]
}

/** The CLI's whole answer about a repo's changes: `list` + `status --all` + `validate`. */
export interface CliView {
  list: ListJson
  status: { changes?: StatusJson[] }
  validate: ValidateJson | null
}

/** Last confirmed view per repo (the app's db; never the user's repo). */
export interface ViewStore {
  get(repo: string): { sig: string; view: CliView } | null
  put(repo: string, sig: string, view: CliView): void
}

let viewStore: ViewStore | null = null

/** Wire the persistent store (createOscCore after openDb; shutdown unplugs it). */
export function bindViewStore(store: ViewStore | null): void {
  viewStore = store
}

const cliCache = new Map<string, { sig: string; view: CliView }>()
const inflight = new Map<string, Promise<RefreshOutcome>>()
const failedRefresh = new Map<string, { sig: string; message: string; at: number }>()

/** Backoff before re-attempting a run that failed for exactly the same content. */
export let refreshRetryMs = 15_000
/** Tests shrink it; the default keeps a broken CLI from being respawned in a loop. */
export function setRefreshRetryMs(ms: number): void {
  refreshRetryMs = ms
}

/** The three CLI calls in parallel; null when they gave no usable answer. */
async function fetchCliView(repoAbs: string): Promise<CliView | null> {
  const [list, status, validate] = await Promise.all([
    runJson<ListJson>(['list'], repoAbs),
    runJson<{ changes?: StatusJson[] }>(['status', '--all'], repoAbs),
    // exits non-zero when something is invalid; runJson still parses the report
    runJson<ValidateJson>(['validate', '--changes', '--no-interactive'], repoAbs)
  ])
  return list && status ? { list, status, validate } : null
}

/**
 * Run the CLI and confirm the view for the signature taken *before* the run
 * (the files may change while it runs; the next changes() revalidates).
 * Concurrent callers share one run per repo. The outcome: `fresh` (the
 * confirmed view replaced what was there), `failed` (the CLI gave no usable
 * answer; the inferred view stays and currentView() reports why) or `backoff`
 * (a run for exactly this content just failed — not re-attempted, so a broken
 * CLI cannot spin changes_updated → refetch → refresh forever).
 */
export type RefreshOutcome = 'fresh' | 'failed' | 'backoff'

export function refreshView(repoAbs: string): Promise<RefreshOutcome> {
  const running = inflight.get(repoAbs)
  if (running) return running
  const sig = openspecSignature(repoAbs)
  const failed = failedRefresh.get(repoAbs)
  if (failed?.sig === sig && Date.now() - failed.at < refreshRetryMs)
    return Promise.resolve('backoff')
  const p = (async () => {
    try {
      const view = await fetchCliView(repoAbs)
      if (!view) {
        failedRefresh.set(repoAbs, {
          sig,
          message: 'the openspec CLI gave no answer (not installed, or it failed)',
          at: Date.now()
        })
        return 'failed'
      }
      cliCache.set(repoAbs, { sig, view })
      failedRefresh.delete(repoAbs)
      try {
        viewStore?.put(repoAbs, sig, view)
      } catch (e) {
        // the db may already be closed (shutdown raced the CLI); next run re-saves
        console.warn('cli view persist failed:', (e as Error).message)
      }
      return 'fresh'
    } finally {
      inflight.delete(repoAbs)
    }
  })()
  inflight.set(repoAbs, p)
  return p
}

export interface CurrentView {
  view: CliView
  /** true: the view is a local inference; a CLI refresh is due */
  stale: boolean
  /** the failure of the last refresh attempted for exactly this content */
  refreshError: string | null
}

/**
 * The repo's view right now, without waiting for the CLI (tarea 11.5): the
 * in-memory cache, the persisted snapshot (a signature match means the CLI
 * already answered for exactly these files, even across restarts) or a local
 * inference that refreshView() replaces. `stale` marks the last case.
 */
export function currentView(repoAbs: string): CurrentView {
  const sig = openspecSignature(repoAbs)
  const hit = cliCache.get(repoAbs)
  if (hit?.sig === sig) return { view: hit.view, stale: false, refreshError: null }
  let saved: { sig: string; view: CliView } | null = null
  try {
    saved = viewStore?.get(repoAbs) ?? null
  } catch {
    saved = null // db already closed
  }
  if (saved?.sig === sig) {
    cliCache.set(repoAbs, { sig, view: saved.view })
    return { view: saved.view, stale: false, refreshError: null }
  }
  const failed = failedRefresh.get(repoAbs)
  return {
    view: inferView(repoAbs),
    stale: true,
    refreshError: failed?.sig === sig ? failed.message : null
  }
}

// --- local inference: the provisional view until the CLI confirms ---------------
//
// Everything `openspec list` and `openspec status` compute for the default
// spec-driven schema is a pure function of the files on disk: task progress is
// checkbox counting in tasks.md, artifact status is file existence over the
// fixed proposal → specs/design → tasks graph, and lastModified is the newest
// mtime under the change folder. Deriving all that locally lets the rail paint
// at once. `validate` is the one part only the CLI can do, so an inferred view
// carries none — currentView()/listChanges() mark it stale and the UI shows a
// "calculating" state instead of presenting unvalidated changes as ready.

/** openspec's own task-line pattern (dist/utils/task-progress.js, 2.0.0): a
 *  checkbox under any CommonMark list marker; only `x`/`X` means done. Copied
 *  verbatim so the inferred counts match the CLI's. */
const TASK_LINE_PATTERN =
  /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/

function taskProgress(tasksMd: string): { total: number; completed: number } {
  let total = 0,
    completed = 0
  for (const line of tasksMd.split('\n')) {
    const m = line.match(TASK_LINE_PATTERN)
    if (!m) continue
    total++
    if ((m[1] ?? '').toLowerCase() === 'x') completed++
  }
  return { total, completed }
}
export { taskProgress }

/** The spec-driven graph openspec ships as the default schema (schema.yaml 2.0.0). */
const SPEC_DRIVEN: ArtifactStatus[] = [
  { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] },
  { id: 'specs', outputPath: 'specs/**/*.md', status: 'done', requires: ['proposal'] },
  { id: 'design', outputPath: 'design.md', status: 'done', requires: ['proposal'] },
  { id: 'tasks', outputPath: 'tasks.md', status: 'done', requires: ['specs', 'design'] }
]

const outputExists = (files: string[], outputPath: string) =>
  outputPath.includes('*')
    ? files.some((f) => f.startsWith(outputPath.slice(0, outputPath.indexOf('*'))))
    : files.includes(outputPath)

/** Artifact states from file existence over the default graph (done/ready/blocked). */
export function inferArtifacts(files: string[], skipSpecs: boolean): ArtifactStatus[] {
  const done = new Map(SPEC_DRIVEN.map((a) => [a.id, outputExists(files, a.outputPath)]))
  return SPEC_DRIVEN.map((a) => {
    if (done.get(a.id)) return { ...a, status: 'done' }
    if (skipSpecs && a.id === 'specs') return { ...a, status: 'skipped' }
    const ready = a.requires.every((r) => done.get(r) || (skipSpecs && r === 'specs'))
    return { ...a, status: ready ? 'ready' : 'blocked' }
  })
}

/** Newest mtime of any file under `dir`, or the directory's own (openspec list's rule). */
function newestMtime(dir: string): number {
  let newest = 0
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      try {
        if (e.isDirectory()) walk(full)
        else newest = Math.max(newest, fs.statSync(full).mtimeMs)
      } catch {
        /* vanished meanwhile */
      }
    }
  }
  walk(dir)
  if (newest) return newest
  try {
    return fs.statSync(dir).mtimeMs
  } catch {
    return Date.now()
  }
}

/** A YAML `schema:` key that names something other than the default spec-driven graph. */
function namesCustomSchema(yaml: string): boolean {
  const m = yaml.match(/^schema:[ \t]*["']?([^\s"'#]+)/m)
  return m !== null && m[1] !== 'spec-driven'
}

/**
 * The locally inferred view. Never throws: an unreadable repo yields the empty
 * view. Custom schemas (a project-local openspec/schemas/ folder, or a change
 * whose .openspec.yaml names one) can change the artifact graph, so those
 * changes get no guessed artifacts — the CLI fills them in.
 */
function inferView(repoAbs: string): CliView {
  const changes: ListJson['changes'] = []
  const statuses: StatusJson[] = []
  const changesDir = path.join(repoAbs, 'openspec', 'changes')
  // a project-local schema can redefine the graph: don't guess then
  // (a project default naming another schema, in openspec/config.yaml, does the same)
  let customSchema = fs.existsSync(path.join(repoAbs, 'openspec', 'schemas'))
  try {
    customSchema ||= namesCustomSchema(
      fs.readFileSync(path.join(repoAbs, 'openspec', 'config.yaml'), 'utf8')
    )
  } catch {
    /* no project config */
  }
  let dirs: fs.Dirent[]
  try {
    dirs = fs.readdirSync(changesDir, { withFileTypes: true })
  } catch {
    return { list: { changes: [] }, status: { changes: [] }, validate: null }
  }
  for (const e of dirs) {
    if (!e.isDirectory() || e.name === 'archive') continue
    const dir = path.join(changesDir, e.name)
    const files = changeFiles(repoAbs, e.name)
    const { total, completed } = files.includes('tasks.md')
      ? taskProgress(readDoc(path.join(dir, 'tasks.md')) ?? '')
      : { total: 0, completed: 0 }
    changes.push({
      name: e.name,
      completedTasks: completed,
      totalTasks: total,
      lastModified: new Date(newestMtime(dir)).toISOString(),
      status: total === 0 ? 'no-tasks' : completed === total ? 'complete' : 'in-progress'
    })
    let skipSpecs = false,
      ownSchema = false
    try {
      const meta = fs.readFileSync(path.join(dir, '.openspec.yaml'), 'utf8')
      skipSpecs = /^\s*skip_specs:\s*true\b/m.test(meta)
      // `openspec new change` writes `schema: spec-driven`: that is the default graph
      ownSchema = namesCustomSchema(meta)
    } catch {
      /* no metadata file */
    }
    const artifacts = customSchema || ownSchema ? [] : inferArtifacts(files, skipSpecs)
    const complete =
      artifacts.length > 0 && artifacts.every((a) => a.status === 'done' || a.status === 'skipped')
    statuses.push({
      changeName: e.name,
      artifacts,
      isPlanningComplete: complete,
      isComplete: complete
    })
  }
  return { list: { changes }, status: { changes: statuses }, validate: null }
}

// A checkout or copy writes files in a burst; edits within this window count as one generation.
const SAME_GENERATION_MS = 1000

/**
 * Artifacts that may be out of date, from OpenSpec's own dependency graph
 * (`requires` in `openspec status`): one is stale when something it requires
 * was modified after it, or is itself stale. `because` names the direct causes.
 */
export function computeStaleness(
  artifacts: Pick<ArtifactStatus, 'id' | 'requires'>[],
  mtimeOf: (id: string) => number | null
): StaleArtifact[] {
  const byId = new Map(artifacts.map((a) => [a.id, a]))
  const memo = new Map<string, string[] | null>()
  const causes = (id: string, seen = new Set<string>()): string[] | null => {
    if (memo.has(id)) return memo.get(id)!
    const a = byId.get(id)
    const own = mtimeOf(id)
    if (!a || own === null || seen.has(id)) return null
    seen.add(id)
    const out = a.requires.filter((r) => {
      const up = mtimeOf(r)
      return (up !== null && up - own > SAME_GENERATION_MS) || causes(r, seen) !== null
    })
    const res = out.length ? out : null
    memo.set(id, res)
    return res
  }
  return artifacts.flatMap((a) => {
    const because = causes(a.id)
    return because ? [{ id: a.id, because }] : []
  })
}

/** Newest mtime of the files an artifact's outputPath covers (e.g. "specs/**\/*.md"), or null when none exist. */
function artifactMtime(
  repoAbs: string,
  change: string,
  files: string[],
  outputPath: string
): number | null {
  const star = outputPath.indexOf('*')
  const matching =
    star < 0
      ? files.filter((f) => f === outputPath)
      : files.filter((f) => f.startsWith(outputPath.slice(0, star)))
  let newest: number | null = null
  for (const f of matching) {
    try {
      newest = Math.max(newest ?? 0, fs.statSync(path.join(changeDir(repoAbs, change), f)).mtimeMs)
    } catch {
      /* vanished */
    }
  }
  return newest
}

/** First unchecked "- [ ] …" item in tasks.md, without its markdown. */
export function nextTask(tasksMd: string): string | null {
  const m = tasksMd.match(/^\s*[-*]\s+\[ \]\s+(.+)$/m)
  return m ? m[1].replace(/`/g, '').replace(/\*\*/g, '').trim().slice(0, 200) : null
}

/**
 * The old blocking behavior: wait for the CLI to confirm, then hand back the
 * current view — fresh, or the local inference when the CLI gave no answer
 * (which is then honestly marked provisional).
 */
async function blockingView(repoAbs: string): Promise<{ view: CliView; provisional: boolean }> {
  const cur = currentView(repoAbs)
  if (!cur.stale) return { view: cur.view, provisional: false } // cache/persisted hit
  await refreshView(repoAbs)
  const next = currentView(repoAbs)
  return { view: next.view, provisional: next.stale }
}

export async function listChanges(
  repoAbs: string,
  commentsFor: (change: string) => ReviewComment[],
  opts: { view?: CliView; provisional?: boolean } = {}
): Promise<ChangeSummary[]> {
  if (!fs.existsSync(path.join(repoAbs, 'openspec', 'changes'))) return []
  let { view, provisional = false } = opts
  if (!view) {
    // no view handed in: this caller wants the CLI's confirmed answer (tests,
    // WSL probe). The core passes the current view and refreshes in background.
    const blocked = await blockingView(repoAbs)
    view = blocked.view
    provisional = blocked.provisional
  }
  const { list, status, validate } = view
  const validation = new Map(
    (validate?.items ?? [])
      .filter((v) => v.type === 'change')
      .map((v) => [v.id, { valid: v.valid, issues: v.issues ?? [] }])
  )
  const byName = new Map((status?.changes ?? []).map((s) => [s.changeName, s]))
  return (list?.changes ?? []).map((c) => {
    const st = byName.get(c.name)
    const cs = commentsFor(c.name)
    const open = cs.filter((x) => x.status !== 'resolved').length
    const reviewed = cs.length > 0 && open === 0
    const base = {
      ...c,
      artifacts: st?.artifacts ?? [],
      isPlanningComplete: st?.isPlanningComplete ?? false,
      isComplete: st?.isComplete ?? false
    }
    const files = changeFiles(repoAbs, c.name)
    const done = base.artifacts.filter((a) => a.status === 'done')
    const out = new Map(done.map((a) => [a.id, a.outputPath]))
    const stale = computeStaleness(done, (id) =>
      out.has(id) ? artifactMtime(repoAbs, c.name, files, out.get(id)!) : null
    )
    const tasksFile = path.join(changeDir(repoAbs, c.name), 'tasks.md')
    const next = files.includes('tasks.md') ? nextTask(readDoc(tasksFile) ?? '') : null
    return {
      ...base,
      files,
      openComments: open,
      stage: stageOf(base, open, reviewed, provisional),
      validation: validation.get(c.name) ?? null,
      stale,
      nextTask: next
    }
  })
}

/** Main specs (openspec/specs/<capability>/spec.md), with their requirement count. */
export function listSpecs(repoAbs: string): SpecSummary[] {
  const dir = path.join(repoAbs, 'openspec', 'specs')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'spec.md')))
    .map((e) => {
      const text = readDoc(path.join(dir, e.name, 'spec.md')) ?? ''
      return {
        name: e.name,
        file: `specs/${e.name}/spec.md`,
        requirements: (text.match(/^#{3,4}\s+Requirement:/gm) ?? []).length
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const archivedDir = (repoAbs: string, name: string) =>
  path.join(repoAbs, 'openspec', 'changes', 'archive', name)

/** `openspec archive` prefixes the folder with the date: 2026-11-06-add-notes → add-notes. */
export const archivedChangeName = (name: string) => name.replace(/^\d{4}-\d{2}-\d{2}-/, '')

export function archivedFiles(repoAbs: string, name: string): string[] {
  const dir = archivedDir(repoAbs, name)
  if (!fs.existsSync(dir)) return []
  return walkMd(dir).sort((a, b) => fileOrder(a) - fileOrder(b) || a.localeCompare(b))
}

// What `openspec init/update` writes for an optional workflow, per tool: a command
// (e.g. .claude/commands/opsx/verify.md) and/or a skill folder (…/skills/openspec-verify-change/).
const OPTIONAL: Record<OptionalWorkflow, { command: string; skill: string }> = {
  verify: { command: 'verify.md', skill: 'openspec-verify-change' }
}

/**
 * Optional workflows installed in the repo for any tool. They are enabled
 * globally with `openspec config profile`, then written by `openspec update`.
 */
export function installedWorkflows(repoAbs: string): OptionalWorkflow[] {
  const found = new Set<OptionalWorkflow>()
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      for (const [id, w] of Object.entries(OPTIONAL) as [
        OptionalWorkflow,
        (typeof OPTIONAL)[OptionalWorkflow]
      ][]) {
        // opencode puts its commands flat as opsx-<name>.md; the others in an opsx/ folder
        const cmd =
          e.isFile() &&
          ((e.name === w.command && path.basename(dir) === 'opsx') ||
            e.name === `opsx-${w.command}`)
        if ((e.isDirectory() && e.name === w.skill) || cmd) found.add(id)
      }
      if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name), depth + 1)
    }
  }
  // tool folders live at the repo root and start with a dot (.claude, .codex, .codebuddy, .agents, …)
  let top: fs.Dirent[] = []
  try {
    top = fs.readdirSync(repoAbs, { withFileTypes: true })
  } catch {
    /* unreadable */
  }
  for (const e of top)
    if (e.isDirectory() && e.name.startsWith('.') && e.name !== '.git')
      walk(path.join(repoAbs, e.name), 1)
  return [...found]
}

export async function listArchived(repoAbs: string): Promise<string[]> {
  const dir = path.join(repoAbs, 'openspec', 'changes', 'archive')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
}

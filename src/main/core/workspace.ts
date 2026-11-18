// Which folders the app may work in. The user picks them in the UI; they are
// stored in <data>/config.json. REPOS_ROOT, when set, is always included.
//
// A repo's id is its absolute real path: stable when folders are added or
// removed, and unique across folders (two roots can both hold an "api" repo).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dataDir, safeResolve, within } from './repos.ts'

// The config is loaded explicitly with loadWorkspaceConfig() (createOscCore does
// it after the data dir exists); before that, roots() is simply empty.

const configFile = () => path.join(dataDir(), 'config.json')

let moduleEnvRoot: string | null = null

interface Config {
  roots: string[]
  /** repos (ids) that keep their review history in the repo */ reviewInRepo?: string[]
}

/**
 * Read <data>/config.json and fix the REPOS_ROOT (if any). `envRoot` overrides
 * process.env.REPOS_ROOT; pass null to ignore it.
 */
export function loadWorkspaceConfig(envRoot?: string | null): void {
  moduleEnvRoot =
    envRoot === undefined
      ? process.env.REPOS_ROOT
        ? path.resolve(process.env.REPOS_ROOT)
        : null
      : envRoot
        ? path.resolve(envRoot)
        : null
  config = readConfig() ?? { roots: [] }
}

const real = (p: string) => {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return null
  }
}
const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readConfig(): Config | null {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((r: unknown): r is string => typeof r === 'string') : []
    return { roots: strings(c.roots), reviewInRepo: strings(c.reviewInRepo) }
  } catch {
    return null
  }
}
function writeConfig(c: Config) {
  const tmp = `${configFile()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2))
  fs.renameSync(tmp, configFile())
}

let config: Config = { roots: [] }

/** First run with data from the old single-root setup: keep those folders so nothing disappears. */
export function seedRoots(folders: string[]) {
  const existing = readConfig()
  const add = folders.filter((f) => isDir(f) && (!moduleEnvRoot || real(f) !== real(moduleEnvRoot)))
  if (existing && !add.length) return
  const all = [...(existing?.roots ?? [])]
  for (const f of add) if (!all.some((r) => real(r) === real(f))) all.push(f)
  config = { ...existing, roots: all }
  writeConfig(config)
  invalidate()
}

export interface Root {
  path: string
  fromEnv: boolean
}

export function roots(): Root[] {
  const out: Root[] = []
  const seen = new Set<string>()
  for (const [p, fromEnv] of [
    ...(moduleEnvRoot ? [[moduleEnvRoot, true] as const] : []),
    ...config.roots.map((r) => [r, false] as const)
  ]) {
    const r = real(p) ?? p
    if (!seen.has(r)) {
      seen.add(r)
      out.push({ path: r, fromEnv })
    }
  }
  return out
}

/** Validate and add a folder. Throws a user-facing message. */
export function addRoot(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a folder path')
  const raw = input.trim().replace(/^~(?=$|[\\/])/, os.homedir())
  if (!path.isAbsolute(raw))
    throw new Error(
      'Use a full path, e.g. ' +
        (process.platform === 'win32' ? 'C:\\Users\\you\\repos' : '~/repos')
    )
  const p = real(raw)
  if (!p || !isDir(p)) throw new Error(`Folder not found: ${raw}`)
  if (path.dirname(p) === p) throw new Error('Pick a more specific folder than the whole drive')
  if (!roots().some((r) => r.path === p)) {
    config = { ...config, roots: [...config.roots, p] }
    writeConfig(config)
  }
  invalidate()
  return p
}

export function removeRoot(p: unknown) {
  if (typeof p !== 'string') return
  config = { ...config, roots: config.roots.filter((r) => r !== p && real(r) !== p) }
  writeConfig(config)
  invalidate()
}

/** Does this repo keep its review history in the repo (opt-in)? */
export const reviewInRepo = (repo: string) => (config.reviewInRepo ?? []).includes(repo)

export function setReviewInRepo(repo: string, on: boolean) {
  const set = new Set(config.reviewInRepo ?? [])
  if (on) set.add(repo)
  else set.delete(repo)
  config = { ...config, reviewInRepo: [...set] }
  writeConfig(config)
}

// ---- repo discovery ------------------------------------------------------------
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  '.cache',
  'venv',
  '.venv',
  '__pycache__',
  'Library',
  'AppData',
  'Program Files',
  'Program Files (x86)',
  'Windows'
])
const MAX_DEPTH = Number(process.env.REPO_SCAN_DEPTH || 4)
const SCAN_BUDGET_MS = 20_000 // per folder; a huge folder must not scan forever
const CONCURRENCY = 24 // parallel readdirs: network-ish disks (/mnt/c, shares) are latency-bound
const FRESH_MS = 5 * 60_000 // after this a request triggers a background rescan

export interface RepoEntry {
  id: string
  name: string
  root: string
  rel: string
}

const isRepoDir = (entries: fs.Dirent[]) =>
  entries.some((e) => e.isDirectory() && (e.name === '.git' || e.name === 'openspec'))

/** Breadth-first, so shallow repos are found first when the time budget runs out. */
async function scan(root: string): Promise<{ repos: RepoEntry[]; truncated: boolean }> {
  const out: RepoEntry[] = []
  const deadline = Date.now() + SCAN_BUDGET_MS
  let truncated = false
  let level = [root]
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: string[] = []
    let i = 0
    const worker = async () => {
      while (i < level.length) {
        if (Date.now() > deadline) {
          truncated = true
          return
        }
        const dir = level[i++]
        let entries: fs.Dirent[]
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        if (isRepoDir(entries)) {
          out.push({
            id: dir,
            name: path.basename(dir),
            root,
            rel: path.relative(root, dir).split(path.sep).join('/')
          })
          continue // nested repos are not scanned
        }
        if (depth < MAX_DEPTH)
          for (const e of entries)
            if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
              next.push(path.join(dir, e.name))
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, level.length) }, worker))
    if (truncated) break
    level = next
  }
  return { repos: out, truncated }
}

interface Found {
  at: number
  repos: RepoEntry[]
  truncated: string[]
}
let cache: Found | null = null
let running: Promise<Found> | null = null
let generation = 0
const invalidate = () => {
  generation++
  cache = null
  running = null
}

async function scanAll(): Promise<Found> {
  const gen = generation
  const seen = new Set<string>()
  const repos: RepoEntry[] = []
  const truncated: string[] = []
  const results = await Promise.all(roots().map(async (r) => ({ r, s: await scan(r.path) })))
  for (const { r, s } of results) {
    if (s.truncated) truncated.push(r.path)
    for (const e of s.repos)
      if (!seen.has(e.id)) {
        seen.add(e.id)
        repos.push(e)
      }
  }
  repos.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const found = { at: Date.now(), repos, truncated }
  if (gen === generation) {
    cache = found
    running = null
  }
  return found
}

/**
 * Repos in all folders. Answers from cache when possible; a stale cache is
 * returned at once and refreshed in the background. `force` waits for a rescan.
 */
export async function findRepos(force = false): Promise<Found> {
  if (force) {
    invalidate()
  }
  if (cache && !force) {
    if (Date.now() - cache.at > FRESH_MS && !running) running = scanAll()
    return cache
  }
  running ??= scanAll()
  return running
}

/** Map a client-supplied repo id (absolute path) to a directory inside one of our folders, or null. */
export function repoPath(id: unknown): string | null {
  if (typeof id !== 'string' || !id || !path.isAbsolute(id)) return null
  for (const r of roots()) {
    if (!within(r.path, path.resolve(id))) continue
    const p = safeResolve(r.path, path.relative(r.path, id))
    if (p && isDir(p)) return p
  }
  return null
}

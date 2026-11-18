// Fase 6 (tarea 6.1): the PATH a desktop app inherits on macOS/Linux comes
// from launchd or the session, not from the user's dotfiles, so nvm, volta and
// homebrew are missing when the app is opened from the dock/launcher. Before
// the core spawns any child (agents, openspec, git) we ask the login shell for
// its environment and merge what the process is missing. Windows inherits the
// user's PATH already, so there is nothing to do there.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCmd } from '../core/proc.ts'

/** How long the login shell may take before we give up on it (~5 s, plan 6.1). */
export const SHELL_ENV_TIMEOUT_MS = 5000

/** Marker lines around the env dump, so rc-file banners cannot poison the parse. */
export const ENV_BEGIN = '__OSC_ENV_BEGIN__'
export const ENV_END = '__OSC_ENV_END__'

/** Known install locations used when the login shell cannot be read (plan 6.1). */
export const KNOWN_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '~/.volta/bin', '~/.local/bin']

/** Proxy variables the login shell may contribute. */
const isProxyVar = (k: string) =>
  ['http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].includes(k)

/** The app's own configuration variables (OSC_ and OPENSPEC_ prefixes plus the two plain ones). */
const isConfigVar = (k: string) =>
  k.startsWith('OSC_') || k.startsWith('OPENSPEC_') || k === 'REPOS_ROOT' || k === 'DEFAULT_AGENT'

/** Parse the env dump between the markers; null when they are missing (unparseable output). */
export function parseEnvDump(out: string): Record<string, string> | null {
  const b = out.indexOf(ENV_BEGIN)
  const e = out.lastIndexOf(ENV_END)
  if (b < 0 || e < b) return null
  const env: Record<string, string> = {}
  for (const line of out.slice(b + ENV_BEGIN.length, e).split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue // banners, PS1 noise, ...
    const k = line.slice(0, eq)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue
    env[k] = line.slice(eq + 1) // values may hold more '='; only the first splits
  }
  return env
}

/** Union of two PATH strings: `from`'s entries first, then `base`'s unseen ones. */
export function unionPath(from: string, base: string | undefined): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const p of [...from.split(path.delimiter), ...(base ?? '').split(path.delimiter)]) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    parts.push(p)
  }
  return parts.join(path.delimiter)
}

/**
 * Merge the login shell's env into `current`: PATH becomes a union with the
 * shell's entries first (its node/nvm must win over the minimal launchd PATH),
 * while every other variable is only taken when the process does not have it.
 * Only PATH, proxy and the app's own config variables are considered.
 */
export function mergeShellEnv(
  current: Record<string, string | undefined>,
  shell: Record<string, string>
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...current }
  if (shell.PATH) out.PATH = unionPath(shell.PATH, current.PATH)
  for (const [k, v] of Object.entries(shell)) {
    if (k === 'PATH' || out[k] !== undefined) continue
    if (isProxyVar(k) || isConfigVar(k)) out[k] = v
  }
  return out
}

/** The known locations that exist (the fallback's candidates). */
export function fallbackPaths(home: string, exists: (p: string) => boolean): string[] {
  return KNOWN_PATHS.map((p) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p)).filter(
    exists
  )
}

export interface ShellEnvOutcome {
  /** true on Windows: nothing to do, the process inherits the user's PATH */
  skipped: boolean
  /** where the merged variables came from */
  source: 'login-shell' | 'fallback' | 'none'
  /** variables the process gained (PATH included) */
  added: string[]
}

/**
 * Apply the login shell's env (or the fallback) to `env` in place. `shell` null
 * means the login shell could not be read (missing, failed or timed out): the
 * known install locations are prepended to PATH instead.
 */
export function applyShellEnv(
  env: Record<string, string | undefined>,
  shell: Record<string, string> | null,
  opts: { home?: string; exists?: (p: string) => boolean } = {}
): ShellEnvOutcome {
  const added: string[] = []
  if (shell) {
    const merged = mergeShellEnv(env, shell)
    if (merged.PATH && merged.PATH !== env.PATH) {
      env.PATH = merged.PATH
      added.push('PATH')
    }
    for (const [k, v] of Object.entries(merged))
      if (k !== 'PATH' && env[k] === undefined && v !== undefined) {
        env[k] = v
        added.push(k)
      }
    return { skipped: false, source: 'login-shell', added }
  }
  const dirs = fallbackPaths(opts.home ?? os.homedir(), opts.exists ?? ((p) => fs.existsSync(p)))
  if (dirs.length) {
    env.PATH = unionPath(dirs.join(path.delimiter), env.PATH)
    added.push('PATH')
  }
  return { skipped: false, source: 'fallback', added }
}

/** The slice of a command runner readLoginShellEnv needs (tests fake this). */
export type ShellRun = (
  shell: string,
  args: string[],
  timeoutMs: number
) => Promise<{ ok: boolean; stdout: string; stderr: string }>

const defaultRun: ShellRun = (shell, args, timeoutMs) =>
  runCmd(shell, args, { cwd: os.homedir(), timeout: timeoutMs })

/**
 * Run `$SHELL -ilc` and parse its environment. Null when the shell fails or
 * does not answer within `timeoutMs` (rc files that wait for a tty, fish not
 * accepting the grouped flags, ...): the caller then uses the known paths.
 */
export async function readLoginShellEnv(
  opts: { shell?: string; timeoutMs?: number; run?: ShellRun } = {}
): Promise<Record<string, string> | null> {
  const run = opts.run ?? defaultRun
  const timeoutMs = opts.timeoutMs ?? SHELL_ENV_TIMEOUT_MS
  const shell = opts.shell ?? process.env.SHELL ?? '/bin/bash'
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  const r = await Promise.race([
    run(shell, ['-ilc', `echo ${ENV_BEGIN}; env; echo ${ENV_END}`], timeoutMs),
    expired
  ]).finally(() => clearTimeout(timer))
  if (!r || !r.ok) return null
  return parseEnvDump(r.stdout)
}

/**
 * Fase 6 startup hook: on macOS/Linux merge the login shell's environment into
 * process.env (before createOscCore, so every child sees it); on Windows it is
 * a no-op. Call once from main/index.ts.
 */
export async function ensureShellEnv(): Promise<ShellEnvOutcome> {
  if (process.platform === 'win32') return { skipped: true, source: 'none', added: [] }
  const shell = await readLoginShellEnv()
  const outcome = applyShellEnv(process.env, shell)
  if (outcome.source === 'fallback')
    console.warn('openspeccontrol: login shell env unavailable, using known PATH locations instead')
  return outcome
}

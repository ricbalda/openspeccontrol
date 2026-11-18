import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import pkg from '../../../package.json' with { type: 'json' }

// Importing this module (or any core module) has no side effects: the data dir
// is created and the version fixed by createOscCore() calling the setters below.

/** The app's version (sent to agents as clientInfo); createOscCore sets it from app.getVersion(). */
let version: string = pkg.version ?? '0.0.0'

let dir: string | null = null

const defaultDir = () =>
  path.resolve(process.env.OSC_DATA || path.join(os.homedir(), '.openspeccontrol'))

/** Create the data dir explicitly (createOscCore calls this first). */
export function initDataDir(dataDir: string): string {
  dir = path.resolve(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** The data dir: the one initDataDir() set, or the default (OSC_DATA / ~/.openspeccontrol) without creating it. */
export function dataDir(): string {
  return dir ?? defaultDir()
}

/** True once initDataDir() ran (tests use it to assert the explicit startup order). */
export const dataDirReady = (): boolean => dir !== null

export function setVersion(v: string): void {
  version = v
}

/** The app version in use (replaces Studio's OSC_VERSION module constant). */
export const oscVersion = (): string => version

/** true if `target` is `base` or inside it (lexically). */
export function within(base: string, target: string): boolean {
  const rel = path.relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Resolve `target` inside `base`, following symlinks of the existing part of the
 * path, so `base/link -> /etc` cannot be used to escape. Returns null on escape.
 */
export function safeResolve(base: string, target: string): string | null {
  const realBase = fs.realpathSync(base)
  const abs = path.resolve(base, target)
  if (!within(path.resolve(base), abs)) return null
  // walk up to the deepest existing ancestor and realpath it
  let probe = abs
  const rest: string[] = []
  while (!fs.existsSync(probe)) {
    rest.unshift(path.basename(probe))
    const parent = path.dirname(probe)
    if (parent === probe) return null
    probe = parent
  }
  const real = path.join(fs.realpathSync(probe), ...rest)
  return within(realBase, real) ? real : null
}

export const hasOpenSpec = (abs: string) => fs.existsSync(path.join(abs, 'openspec'))

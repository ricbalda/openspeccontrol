// "A newer version is out": the version published on the registry, checked at
// most once a day. The request carries nothing but the package name; the answer
// is cached in the data folder. OSC_NO_UPDATE_CHECK=1 turns it off (offline,
// air-gapped).
//
// This is the check OpenSpec Studio did against the npm registry, adapted to the
// OSC identity; the desktop app updates itself, so the Fase 9 rewrite replaces
// this module with electron-updater (GitHub Releases) and a new UpdateState.

import fs from 'node:fs'
import path from 'node:path'
import type { UpdateInfo } from '@shared/protocol.ts'
import { dataDir, oscVersion } from '../core/repos.ts'

const REGISTRY = 'https://registry.npmjs.org/openspeccontrol/latest'
const cacheFile = () => path.join(dataDir(), 'update-check.json')
const DAY = 24 * 60 * 60 * 1000

export const updateCheckDisabled = () =>
  /^(1|true|yes)$/i.test(process.env.OSC_NO_UPDATE_CHECK ?? '')

/** How this copy was installed; a desktop install is never updated from npm. */
export const INSTALL: UpdateInfo['install'] = 'clone'

/** a > b for plain x.y.z versions; a pre-release (x.y.z-…) never counts as newer. */
export function isNewer(a: string, b: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(a)) return false
  const pa = a.split('.').map(Number),
    pb = b
      .split(/[.-]/)
      .slice(0, 3)
      .map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i]
  return false
}

interface Cache {
  checkedAt: number
  latest: string | null
}
const readCache = (): Cache | null => {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
  } catch {
    return null
  }
}

let inflight: Promise<string | null> | null = null

/** The latest published version, from the cache when it is less than a day old. */
export async function latestVersion(
  now = Date.now(),
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  const c = readCache()
  if (c && now - c.checkedAt < DAY && now >= c.checkedAt) return c.latest
  inflight ??= (async () => {
    let latest: string | null = c?.latest ?? null
    try {
      const r = await fetcher(REGISTRY, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      })
      if (r.ok) {
        const v = ((await r.json()) as { version?: unknown }).version
        if (typeof v === 'string') latest = v
      }
    } catch {
      /* offline or blocked: try again tomorrow */
    }
    try {
      fs.writeFileSync(cacheFile(), JSON.stringify({ checkedAt: now, latest } satisfies Cache))
    } catch {
      /* read-only data dir */
    }
    return latest
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export async function updateInfo(): Promise<UpdateInfo> {
  const base = { current: oscVersion(), install: INSTALL, command: updateCommand(INSTALL) }
  if (updateCheckDisabled()) return { ...base, latest: null, newer: false, disabled: true }
  const latest = await latestVersion()
  return { ...base, latest, newer: !!latest && isNewer(latest, oscVersion()), disabled: false }
}

/** The command that updates this install. */
export const updateCommand = (install: UpdateInfo['install']) =>
  install === 'npm'
    ? 'npm install -g openspeccontrol@latest'
    : 'git pull && npm install && npm run build'

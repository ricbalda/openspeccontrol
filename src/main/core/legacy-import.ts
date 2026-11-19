// One-time import from OpenSpec Studio's data dir (~/.openspec-studio): the
// database, config.json and agents.json are copied into our data dir without
// touching the origin. Runs before openDb(), so the copied db (with all the
// folders, comments and review rounds) becomes ours. A marker file records
// what happened; deleting our data dir makes the import run again.

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface StudioImportResult {
  imported: boolean
  /** why nothing was imported (absent source, already imported, failure) */
  reason?: string
  /** files copied, relative to the data dir */
  files: string[]
}

const DB_NAME = 'openspeccontrol.db'
const SOURCE_DB = 'studio.db'
const COPIED = ['config.json', 'agents.json'] as const // update-check.json is never copied
const MARKER = 'imported-from-studio.json'

const q = (f: string) => `'${f.replace(/'/g, "''")}'` // SQL string literal

/**
 * A read-only SQLite connection to a WAL database cannot clean up on close, so
 * importing leaves a `-shm` (and a 0-byte `-wal`) next to Studio's studio.db.
 * Remove what we created — never a `-wal` that was already there (it may hold
 * Studio's uncommitted commits) or that grew (a 0-byte one is empty by design).
 */
function removeOurSidecars(sourceDb: string, existedBefore: Set<string>): void {
  for (const suffix of ['-wal', '-shm']) {
    const file = `${sourceDb}${suffix}`
    if (existedBefore.has(file)) continue
    try {
      if (suffix === '-wal' && fs.statSync(file).size > 0) continue
      fs.rmSync(file, { force: true })
    } catch {
      /* best effort: the db content itself is never touched */
    }
  }
}

/**
 * Copy Studio's data into `to`. Consistent even while Studio is open: the source
 * db is opened read-only and copied with VACUUM INTO. When it cannot be done
 * (origin absent or damaged, target already imported) nothing is written and the
 * reason comes back, so the app starts with empty data.
 */
export function importFromStudio(opts: { from: string; to: string }): StudioImportResult {
  const targetDb = path.join(opts.to, DB_NAME)
  if (fs.existsSync(targetDb)) return { imported: false, reason: 'already imported', files: [] }
  const sourceDb = path.join(opts.from, SOURCE_DB)
  if (!fs.existsSync(sourceDb)) return { imported: false, reason: 'source not found', files: [] }

  fs.mkdirSync(opts.to, { recursive: true })
  const files: string[] = []
  // VACUUM INTO refuses to overwrite: build the copy under a temp name, then move it in
  const tmp = path.join(opts.to, `${DB_NAME}.import-${process.pid}.tmp`)
  try {
    const sidecars = new Set([`${sourceDb}-wal`, `${sourceDb}-shm`].filter((f) => fs.existsSync(f)))
    const src = new DatabaseSync(sourceDb, { readOnly: true })
    try {
      src.exec(`VACUUM INTO ${q(tmp)}`)
    } finally {
      src.close()
      removeOurSidecars(sourceDb, sidecars)
    }
    fs.renameSync(tmp, targetDb)
    files.push(DB_NAME)
    for (const name of COPIED) {
      const from = path.join(opts.from, name)
      if (fs.existsSync(from)) {
        fs.copyFileSync(from, path.join(opts.to, name))
        files.push(name)
      }
    }
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
      fs.rmSync(targetDb, { force: true }) // a partial copy must not block the next attempt
    } catch {
      /* best effort */
    }
    return { imported: false, reason: `studio import failed: ${(e as Error).message}`, files: [] }
  }

  fs.writeFileSync(
    path.join(opts.to, MARKER),
    `${JSON.stringify({ from: path.resolve(opts.from), at: new Date().toISOString(), files }, null, 2)}\n`
  )
  return { imported: true, files }
}

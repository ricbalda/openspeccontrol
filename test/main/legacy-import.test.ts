import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { importFromStudio } from '../../src/main/core/legacy-import.ts'

// A tree's content fingerprint, to prove the origin is never touched
const fingerprint = (dir: string): string => {
  const parts: string[] = []
  const walk = (d: string) => {
    for (const e of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        parts.push(`${e.name}/`)
        walk(full)
      } else parts.push(`${e.name}|${fs.readFileSync(full).toString('base64').slice(0, 64)}`)
    }
  }
  walk(dir)
  return parts.join('\n')
}

const mkStudio = () => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-src-'))
  const db = new DatabaseSync(path.join(from, 'studio.db'))
  db.exec(
    "CREATE TABLE comments (id TEXT PRIMARY KEY, repo TEXT); INSERT INTO comments VALUES ('c1', '/repos/app')"
  )
  db.close()
  fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ roots: ['/repos'] }))
  fs.writeFileSync(path.join(from, 'agents.json'), JSON.stringify([{ id: 'gemini' }]))
  fs.writeFileSync(path.join(from, 'update-check.json'), '{"latest":"0.3.1"}')
  return from
}

describe('importFromStudio', () => {
  it('imports once: db via VACUUM INTO, config and agents, never update-check', () => {
    const from = mkStudio()
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-dst-'))
    const before = fingerprint(from)

    const r = importFromStudio({ from, to })
    expect(r.imported).toBe(true)
    expect(r.files.sort()).toEqual(['agents.json', 'config.json', 'openspeccontrol.db'])

    const db = new DatabaseSync(path.join(to, 'openspeccontrol.db'), { readOnly: true })
    expect((db.prepare('SELECT repo FROM comments').get() as any).repo).toBe('/repos/app')
    db.close()
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toContain('/repos')
    expect(fs.existsSync(path.join(to, 'update-check.json'))).toBe(false)
    expect(fs.existsSync(path.join(to, 'imported-from-studio.json'))).toBe(true)
    const marker = JSON.parse(fs.readFileSync(path.join(to, 'imported-from-studio.json'), 'utf8'))
    expect(marker.from).toBe(fs.realpathSync(from))
    expect(marker.at).toBeTruthy()
    expect(marker.files).toContain('openspeccontrol.db')

    // the origin is byte-for-byte the same
    expect(fingerprint(from)).toBe(before)
  })

  it('does not import again, and data added afterwards survives', () => {
    const from = mkStudio()
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-dst-'))
    importFromStudio({ from, to })
    const db = new DatabaseSync(path.join(to, 'openspeccontrol.db'))
    db.exec("INSERT INTO comments VALUES ('c2', '/repos/app')")
    db.close()

    const again = importFromStudio({ from, to })
    expect(again.imported).toBe(false)
    const check = new DatabaseSync(path.join(to, 'openspeccontrol.db'), { readOnly: true })
    expect(check.prepare('SELECT COUNT(*) AS n FROM comments').get()).toMatchObject({ n: 2 })
    check.close()
  })

  it('tolerates a missing source: nothing imported, nothing created', () => {
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-dst-'))
    const r = importFromStudio({ from: path.join(to, 'no-studio'), to })
    expect(r.imported).toBe(false)
    expect(fs.existsSync(path.join(to, 'openspeccontrol.db'))).toBe(false)
    expect(fs.existsSync(path.join(to, 'imported-from-studio.json'))).toBe(false)
  })

  it('tolerates a corrupt source: reason recorded, no db, retry stays possible', () => {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-src-'))
    fs.writeFileSync(path.join(from, 'studio.db'), 'this is not a sqlite database at all')
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-dst-'))

    const r = importFromStudio({ from, to })
    expect(r.imported).toBe(false)
    expect(r.reason).toMatch(/failed/i)
    expect(fs.existsSync(path.join(to, 'openspeccontrol.db'))).toBe(false)
    expect(fs.existsSync(path.join(to, 'imported-from-studio.json'))).toBe(false)

    // fixing the origin and retrying works (no leftover state blocks it)
    fs.rmSync(path.join(from, 'studio.db'))
    const db = new DatabaseSync(path.join(from, 'studio.db'))
    db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)')
    db.close()
    expect(importFromStudio({ from, to }).imported).toBe(true)
  })

  it('opens the source read-only: a WAL database Studio left behind imports too', () => {
    const from = mkStudio()
    const db = new DatabaseSync(path.join(from, 'studio.db'))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec("INSERT INTO comments VALUES ('c3', '/repos/app')")
    db.close() // leaves studio.db in WAL mode (the -wal is checkpointed away on close)
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-imp-dst-'))
    expect(importFromStudio({ from, to }).imported).toBe(true)
    const copy = new DatabaseSync(path.join(to, 'openspeccontrol.db'), { readOnly: true })
    expect(copy.prepare('SELECT COUNT(*) AS n FROM comments').get()).toMatchObject({ n: 2 })
    copy.close()
  })
})

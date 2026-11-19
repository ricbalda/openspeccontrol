import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, openDb } from '../../src/main/core/db.ts'

// Esquema de borradores en openDb() (tarea 1.1, design D-1): una base nueva y
// una con el esquema previo (sin borradores) quedan ambas con la tabla, el
// índice, el FTS y los triggers, sin perder datos existentes.

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-drafts-db-'))
const file = (name: string) => path.join(TMP, name)

// closeDb tras cada test: cada bloque abre su propio archivo
afterEach(() => closeDb())

const schemaTypes = (): Record<string, string> => {
  const rows = getDb().prepare('SELECT name, type FROM sqlite_master').all() as {
    name: string
    type: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.name, r.type]))
}

/** Consulta el FTS como lo hace el módulo: frase escapada + join por rowid. */
const ftsIds = (q: string): string[] =>
  (
    getDb()
      .prepare(
        `SELECT d.id FROM drafts_fts f JOIN drafts d ON d.rowid = f.rowid
         WHERE drafts_fts MATCH ?`
      )
      .all(`"${q.replace(/"/g, '""')}"`) as { id: string }[]
  )
    .map((r) => r.id)
    .sort()

const insert = (id: string, title: string, body: string) =>
  getDb()
    .prepare(
      `INSERT INTO drafts (id, repo, title, body, status, created_at, updated_at)
       VALUES (?, '/repo/a', ?, ?, 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    )
    .run(id, title, body)

describe('openDb crea el esquema de borradores (tarea 1.1, D-1)', () => {
  it('una base nueva queda con la tabla, el índice, el FTS y los tres triggers', () => {
    openDb(file('nueva.db'))
    const s = schemaTypes()
    expect(s['drafts']).toBe('table')
    expect(s['drafts_by_repo']).toBe('index')
    expect(s['drafts_fts']).toBe('table') // tabla virtual: en sqlite_master es type table
    expect(s['drafts_ai']).toBe('trigger')
    expect(s['drafts_ad']).toBe('trigger')
    expect(s['drafts_au']).toBe('trigger')
    // el tokenizador es trigram con remove_diacritics: «busqueda» encuentra «Búsqueda»
    insert('a', 'Búsqueda', '')
    expect(ftsIds('busqueda')).toEqual(['a'])
  })

  it('una base con el esquema previo recibe las tablas nuevas sin perder datos', () => {
    const prev = file('previa.db')
    const old = new DatabaseSync(prev)
    old.exec(`
      CREATE TABLE sessions (
        repo TEXT NOT NULL, agent TEXT NOT NULL, acp_session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY (repo, agent)
      );
      CREATE TABLE comments (
        id TEXT PRIMARY KEY, repo TEXT NOT NULL, change TEXT NOT NULL, json TEXT NOT NULL
      );
      INSERT INTO comments VALUES ('c1', '/repo/a', 'add-x', '{"id":"c1"}');
      INSERT INTO sessions VALUES ('/repo/a', 'claude', 's1', '2026-01-01T00:00:00.000Z');
    `)
    old.close()

    openDb(prev)
    const s = schemaTypes()
    expect(s['drafts']).toBe('table')
    expect(s['drafts_by_repo']).toBe('index')
    expect(s['drafts_fts']).toBe('table')
    expect(s['drafts_ai']).toBe('trigger')
    expect(s['drafts_ad']).toBe('trigger')
    expect(s['drafts_au']).toBe('trigger')
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM comments').get() as { n: number }).n).toBe(1)
    expect(getDb().prepare('SELECT acp_session_id FROM sessions').get()).toMatchObject({
      acp_session_id: 's1'
    })
  })

  it('reabrir la base es idempotente y conserva borradores e índice', () => {
    const f = file('reabrir.db')
    openDb(f)
    insert('d1', 't', 'cuerpo persistido')
    closeDb()

    openDb(f) // CREATE ... IF NOT EXISTS otra vez
    expect(getDb().prepare('SELECT title, body FROM drafts WHERE id = ?').get('d1')).toMatchObject({
      title: 't',
      body: 'cuerpo persistido'
    })
    expect(ftsIds('persistido')).toEqual(['d1'])
  })
})

describe('los triggers mantienen drafts_fts (D-1)', () => {
  let seq = 0
  beforeEach(() => openDb(file(`triggers-${seq++}.db`)))

  it('insertar indexa; editar reindexa lo nuevo y olvida lo viejo; borrar desindexa', () => {
    insert('1', 'Informe', 'Añadir búsqueda por cliente')
    insert('2', 'Exportación', 'contenido csv')

    expect(ftsIds('busqueda')).toEqual(['1'])
    expect(ftsIds('export')).toEqual(['2'])

    // UPDATE de título y contenido pasa por drafts_au
    getDb()
      .prepare('UPDATE drafts SET title = ?, body = ? WHERE id = ?')
      .run('Renombrado', 'nuevo texto kubernetes', '1')
    expect(ftsIds('busqueda')).toEqual([]) // lo viejo ya no está indexado
    expect(ftsIds('renombrado')).toEqual(['1']) // lo nuevo sí
    expect(ftsIds('kubernetes')).toEqual(['1'])

    // un UPDATE que no toca título ni contenido (estado, fechas) no altera el índice
    getDb()
      .prepare('UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?')
      .run('sent', '2026-01-02T00:00:00.000Z', '1')
    expect(ftsIds('renombrado')).toEqual(['1'])

    // DELETE pasa por drafts_ad
    getDb().prepare('DELETE FROM drafts WHERE id = ?').run('1')
    expect(ftsIds('renombrado')).toEqual([])
    expect(ftsIds('export')).toEqual(['2']) // el resto sigue indexado
  })

  it('el índice y la tabla quedan sincronizados tras insertar, editar y borrar', () => {
    insert('3', 'uno', 'cuerpo uno')
    insert('4', 'dos', 'cuerpo dos')
    getDb()
      .prepare('UPDATE drafts SET title = ?, body = ? WHERE id = ?')
      .run('uno editado', 'cuerpo editado', '3')
    getDb().prepare('DELETE FROM drafts WHERE id = ?').run('4')
    const n = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n
    expect(n('SELECT COUNT(*) AS n FROM drafts')).toBe(1)
    expect(n('SELECT COUNT(*) AS n FROM drafts_fts WHERE drafts_fts MATCH \'"editado"\'')).toBe(1)
    expect(n('SELECT COUNT(*) AS n FROM drafts_fts WHERE drafts_fts MATCH \'"dos"\'')).toBe(0)
  })
})

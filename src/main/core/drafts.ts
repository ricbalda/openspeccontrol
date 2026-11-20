// Borradores de proposal por repositorio (add-proposal-drafts, D-2 y D-3).
// Persisten solo en la base de la app (nunca en el repo del usuario) y este
// módulo no importa nada de electron, como el resto del núcleo. Los tipos son
// el contrato de D-4: la fase 2 los declara también en @shared/ipc.ts.

import { randomUUID } from 'node:crypto'
import { getDb } from './db.ts'
import { OscError } from './errors.ts'

export type DraftMode = 'explore' | 'propose'

export interface DraftSummary {
  id: string
  repo: string
  title: string
  status: 'draft' | 'sent'
  sentMode: DraftMode | null
  createdAt: string
  updatedAt: string
  sentAt: string | null
  /** caracteres del contenido: alimenta el contador n / 4000 del editor */
  length: number
}

export interface Draft extends DraftSummary {
  body: string
}

// topes de almacenamiento (el límite de 4000 para enviar es aparte, D-4)
export const MAX_DRAFT_TITLE = 200
export const MAX_DRAFT_BODY = 100_000

const COLUMNS = 'id, repo, title, body, status, sent_mode, created_at, updated_at, sent_at'

interface DraftRow {
  id: string
  repo: string
  title: string
  body: string
  status: string
  sent_mode: string | null
  created_at: string
  updated_at: string
  sent_at: string | null
}

const rowById = (id: string): DraftRow | undefined =>
  getDb().prepare(`SELECT ${COLUMNS} FROM drafts WHERE id = ?`).get(id) as DraftRow | undefined

const toDraft = (r: DraftRow): Draft => ({
  id: r.id,
  repo: r.repo,
  title: r.title,
  body: r.body,
  status: r.status === 'sent' ? 'sent' : 'draft',
  sentMode: r.status === 'sent' ? ((r.sent_mode as DraftMode) ?? null) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  sentAt: r.sent_at ?? null,
  length: r.body.length
})

const toSummary = (r: DraftRow): DraftSummary => {
  const { body: _body, ...summary } = toDraft(r)
  return summary
}

const rowsByRepo = (repo: string): DraftRow[] =>
  getDb()
    .prepare(`SELECT ${COLUMNS} FROM drafts WHERE repo = ? ORDER BY updated_at DESC`)
    .all(repo) as unknown as DraftRow[]

/** NFD sin marcas diacríticas y en minúsculas: compara sin acentos ni caja. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Historial de un repo, ordenado por fecha de modificación descendente. Con
 * `query` (D-2): frase FTS escapada para 3 o más caracteres y subcadena sobre
 * texto normalizado para 1–2, que el tokenizador trigram no indexa.
 */
export function list(repo: string, query?: string): DraftSummary[] {
  const q = (query ?? '').trim()
  if (!q) return rowsByRepo(repo).map(toSummary)
  if (q.length >= 3) {
    // frase entre comillas con las internas dobladas: el texto del usuario
    // nunca se interpreta como sintaxis FTS (OR, NEAR, *, -)
    const phrase = `"${q.replace(/"/g, '""')}"`
    try {
      return (
        getDb()
          .prepare(
            `SELECT d.id, d.repo, d.title, d.body, d.status, d.sent_mode,
                    d.created_at, d.updated_at, d.sent_at
              FROM drafts_fts f JOIN drafts d ON d.rowid = f.rowid
              WHERE drafts_fts MATCH ? AND d.repo = ?
              ORDER BY d.updated_at DESC`
          )
          .all(phrase, repo) as unknown as DraftRow[]
      ).map(toSummary)
    } catch {
      // una frase que el tokenizador no admite: cae al filtro normalizado
    }
  }
  // 1–2 caracteres: subcadena en JavaScript sobre título y cuerpo plegados.
  // Equivale a un LIKE con % y _ escapados, pero además ignora acentos.
  const needle = fold(q)
  return rowsByRepo(repo)
    .filter((r) => fold(r.title).includes(needle) || fold(r.body).includes(needle))
    .map(toSummary)
}

/** Un borrador por id, o null si no existe. */
export function get(id: string): Draft | null {
  const r = rowById(id)
  return r ? toDraft(r) : null
}

/** Borrador vacío asociado a un repo, con creación y modificación iguales. */
export function create(repo: string): Draft {
  const id = randomUUID()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO drafts (id, repo, title, body, status, sent_mode, created_at, updated_at, sent_at)
       VALUES (?, ?, '', '', 'draft', NULL, ?, ?, NULL)`
    )
    .run(id, repo, now, now)
  return toDraft(rowById(id)!)
}

/**
 * Guarda título y contenido y actualiza `updated_at`. Sobre un borrador
 * enviado es `conflict`; los topes de título y contenido son `too_large` sin
 * recortar (recortar en silencio perdería texto del usuario).
 */
export function save(id: string, patch: { title?: string; body?: string }): Draft {
  const cur = rowById(id)
  if (!cur) throw new OscError('not_found', 'draft not found')
  if (cur.status === 'sent') throw new OscError('conflict', 'draft already sent')
  for (const [field, value] of Object.entries(patch)) {
    if (typeof value !== 'string') throw new OscError('invalid', `draft ${field} must be a string`)
  }
  const title = patch.title ?? cur.title
  const body = patch.body ?? cur.body
  if (title.length > MAX_DRAFT_TITLE)
    throw new OscError('too_large', `draft title is longer than ${MAX_DRAFT_TITLE} characters`)
  if (body.length > MAX_DRAFT_BODY)
    throw new OscError('too_large', `draft body is longer than ${MAX_DRAFT_BODY} characters`)
  getDb()
    .prepare('UPDATE drafts SET title = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(title, body, new Date().toISOString(), id)
  return toDraft(rowById(id)!)
}

const COPY_SUFFIX = ' (copy)'

/**
 * Copia editable en el mismo repo: mismo contenido, título original seguido de
 * « (copy)» y fechas nuevas. Un título vacío se mantiene vacío (la lista ya lo
 * muestra como «Untitled draft»).
 */
export function duplicate(id: string): Draft {
  const cur = rowById(id)
  if (!cur) throw new OscError('not_found', 'draft not found')
  // el sufijo no puede romper el tope: se recorta el título original
  let title = cur.title ? cur.title + COPY_SUFFIX : ''
  if (title.length > MAX_DRAFT_TITLE)
    title = cur.title.slice(0, MAX_DRAFT_TITLE - COPY_SUFFIX.length) + COPY_SUFFIX
  const nid = randomUUID()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO drafts (id, repo, title, body, status, sent_mode, created_at, updated_at, sent_at)
       VALUES (?, ?, ?, ?, 'draft', NULL, ?, ?, NULL)`
    )
    .run(nid, cur.repo, title, cur.body, now, now)
  return toDraft(rowById(nid)!)
}

/** Elimina el borrador (y su entrada del índice, vía trigger). */
export function remove(id: string): void {
  if (!rowById(id)) throw new OscError('not_found', 'draft not found')
  getDb().prepare('DELETE FROM drafts WHERE id = ?').run(id)
}

/** Marca un borrador como enviado con su modo y su fecha (fase 3 lo usa). */
export function markSent(id: string, mode: DraftMode): Draft {
  if (!rowById(id)) throw new OscError('not_found', 'draft not found')
  const now = new Date().toISOString()
  getDb()
    .prepare(
      'UPDATE drafts SET status = ?, sent_mode = ?, sent_at = ?, updated_at = ? WHERE id = ?'
    )
    .run('sent', mode, now, now, id)
  return toDraft(rowById(id)!)
}

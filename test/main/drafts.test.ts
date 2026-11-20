import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, openDb } from '../../src/main/core/db.ts'
import * as drafts from '../../src/main/core/drafts.ts'
import { MAX_DRAFT_BODY, MAX_DRAFT_TITLE } from '../../src/main/core/drafts.ts'
import { createOscCore, type OscCore } from '../../src/main/core/osc-core.ts'

// El módulo drafts.ts (tareas 1.2–1.4, design D-2 y D-3): CRUD, búsqueda y
// reglas del núcleo, sobre una base temporal propia. El reloj es falso para
// que created_at/updated_at sean deterministas.

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-drafts-'))
const DBF = path.join(TMP, 'drafts.db')

let n = 0
/** repo único por test: las aserciones de list() no se contaminan entre tests */
const freshRepo = (prefix: string) => `/${prefix}/${n++}`

beforeAll(() => openDb(DBF))
afterAll(() => closeDb())

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

const at = (iso: string) => vi.setSystemTime(new Date(iso))

describe('crear, guardar, duplicar y borrar (tarea 1.2, D-3)', () => {
  it('create: borrador vacío con fechas ISO iguales y length 0', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    expect(d).toMatchObject({
      repo,
      title: '',
      body: '',
      status: 'draft',
      sentMode: null,
      sentAt: null,
      length: 0
    })
    expect(d.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/)
    expect(d.createdAt).toBe('2026-01-01T00:00:00.000Z') // ISO 8601
    expect(d.updatedAt).toBe(d.createdAt)
  })

  it('get devuelve el borrador con body, o null si no existe', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    expect(drafts.get(d.id)).toMatchObject({ id: d.id, body: '' })
    expect(drafts.get('00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('save actualiza título, contenido y updated_at; createdAt no cambia', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    at('2026-01-02T00:00:00.000Z')
    const body = 'Añadir búsqueda por cliente'
    const saved = drafts.save(d.id, { title: 'Informe', body })
    expect(saved.title).toBe('Informe')
    expect(saved.body).toBe(body)
    expect(saved.length).toBe(body.length)
    expect(saved.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(saved.updatedAt > d.updatedAt).toBe(true)
    expect(saved.createdAt).toBe(d.createdAt)
  })

  it('save acepta parches parciales (solo título o solo contenido)', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    at('2026-01-02T00:00:00.000Z')
    expect(drafts.save(d.id, { title: 'Solo título' }).body).toBe('')
    at('2026-01-03T00:00:00.000Z')
    expect(drafts.save(d.id, { body: 'Solo cuerpo' })).toMatchObject({
      title: 'Solo título',
      body: 'Solo cuerpo'
    })
  })

  it('list ordena por updated_at descendente y guardar reubica al principio', () => {
    const repo = freshRepo('crud')
    const x = drafts.create(repo)
    at('2026-01-02T00:00:00.000Z')
    const y = drafts.create(repo)
    expect(drafts.list(repo).map((s) => s.id)).toEqual([y.id, x.id])
    at('2026-01-03T00:00:00.000Z')
    drafts.save(x.id, { title: 'X editado' })
    expect(drafts.list(repo).map((s) => s.id)).toEqual([x.id, y.id])
  })

  it('duplicate: « (copy)», mismo contenido, fechas nuevas; el original no cambia', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    drafts.save(d.id, { title: 'Exportación CSV', body: 'cuerpo original' })
    at('2026-01-05T00:00:00.000Z')
    const c = drafts.duplicate(d.id)
    expect(c.id).not.toBe(d.id)
    expect(c.repo).toBe(repo)
    expect(c.title).toBe('Exportación CSV (copy)')
    expect(c.body).toBe('cuerpo original')
    expect(c.status).toBe('draft')
    expect(c.createdAt).toBe('2026-01-05T00:00:00.000Z') // fechas nuevas
    expect(c.createdAt > drafts.get(d.id)!.updatedAt).toBe(true)
    expect(drafts.get(d.id)).toMatchObject({ title: 'Exportación CSV', status: 'draft' })
  })

  it('duplicate de un enviado crea una copia editable', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    drafts.save(d.id, { title: 'Enviado', body: 'b' })
    drafts.markSent(d.id, 'propose')
    const c = drafts.duplicate(d.id)
    expect(c).toMatchObject({
      status: 'draft',
      sentMode: null,
      sentAt: null,
      title: 'Enviado (copy)'
    })
    expect(drafts.get(d.id)).toMatchObject({ status: 'sent' })
  })

  it('duplicate no rompe el tope cuando el título original está en el máximo', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    drafts.save(d.id, { title: 'x'.repeat(MAX_DRAFT_TITLE) })
    const c = drafts.duplicate(d.id)
    expect(c.title.length).toBe(MAX_DRAFT_TITLE)
    expect(c.title.endsWith(' (copy)')).toBe(true)
  })

  it('duplicate de un borrador sin título lo deja vacío (la lista muestra «Untitled draft»)', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    const c = drafts.duplicate(d.id)
    expect(c.title).toBe('')
  })

  it('remove borra; borrar otra vez es not_found', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    drafts.remove(d.id)
    expect(drafts.get(d.id)).toBeNull()
    expect(drafts.list(repo)).toEqual([])
    expect(() => drafts.remove(d.id)).toThrowError(expect.objectContaining({ code: 'not_found' }))
  })

  it('markSent fija modo y fecha de envío (lo usa la fase 3)', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    at('2026-01-06T00:00:00.000Z')
    const s = drafts.markSent(d.id, 'explore')
    expect(s).toMatchObject({
      status: 'sent',
      sentMode: 'explore',
      sentAt: '2026-01-06T00:00:00.000Z',
      updatedAt: '2026-01-06T00:00:00.000Z'
    })
  })

  it('ids inexistentes son not_found en save, duplicate, markSent y remove', () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    for (const fn of [
      () => drafts.save(missing, { title: 't' }),
      () => drafts.duplicate(missing),
      () => drafts.markSent(missing, 'explore'),
      () => drafts.remove(missing)
    ])
      expect(fn).toThrowError(expect.objectContaining({ code: 'not_found' }))
  })

  it('un parche con un valor que no es cadena es invalid', () => {
    const repo = freshRepo('crud')
    const d = drafts.create(repo)
    expect(() => drafts.save(d.id, { title: 3 as unknown as string })).toThrowError(
      expect.objectContaining({ code: 'invalid' })
    )
  })
})

describe('reglas del núcleo (tarea 1.4, D-3)', () => {
  it('guardar un borrador enviado es conflict y el contenido queda como estaba', () => {
    const repo = freshRepo('rules')
    const d = drafts.create(repo)
    drafts.save(d.id, { title: 'T', body: 'B' })
    drafts.markSent(d.id, 'propose')
    expect(() => drafts.save(d.id, { body: 'otra cosa' })).toThrowError(
      expect.objectContaining({ code: 'conflict' })
    )
    expect(drafts.get(d.id)).toMatchObject({ title: 'T', body: 'B', status: 'sent' })
  })

  it('un título de 201 caracteres es too_large y no se recorta', () => {
    const repo = freshRepo('rules')
    const d = drafts.create(repo)
    expect(() => drafts.save(d.id, { title: 'x'.repeat(MAX_DRAFT_TITLE + 1) })).toThrowError(
      expect.objectContaining({ code: 'too_large' })
    )
    expect(drafts.get(d.id)!.title).toBe('')
  })

  it(`un contenido de ${MAX_DRAFT_BODY + 1} caracteres es too_large y no se recorta`, () => {
    const repo = freshRepo('rules')
    const d = drafts.create(repo)
    expect(() => drafts.save(d.id, { body: 'x'.repeat(MAX_DRAFT_BODY + 1) })).toThrowError(
      expect.objectContaining({ code: 'too_large' })
    )
    expect(drafts.get(d.id)!.body).toBe('')
  })

  it('los topes exactos (200 y 100 000) se aceptan', () => {
    const repo = freshRepo('rules')
    const d = drafts.create(repo)
    const saved = drafts.save(d.id, {
      title: 't'.repeat(MAX_DRAFT_TITLE),
      body: 'b'.repeat(MAX_DRAFT_BODY)
    })
    expect(saved.title.length).toBe(MAX_DRAFT_TITLE)
    expect(saved.body.length).toBe(MAX_DRAFT_BODY)
    expect(saved.length).toBe(MAX_DRAFT_BODY)
  })
})

describe('búsqueda en el historial (tarea 1.3, D-2)', () => {
  let repo: string

  beforeEach(() => {
    repo = freshRepo('search')
    const mk = (title: string, body: string, iso: string) => {
      at(iso)
      drafts.save(drafts.create(repo).id, { title, body })
    }
    mk('Informe', 'Añadir búsqueda por cliente', '2026-01-01T00:00:00.000Z')
    mk('Exportación CSV', 'otro contenido', '2026-01-01T00:01:00.000Z')
    mk('UI de pagos', 'cuerpo', '2026-01-01T00:02:00.000Z')
  })

  it('«busqueda» encuentra «Búsqueda» en el contenido, sin acentos', () => {
    expect(drafts.list(repo, 'busqueda').map((s) => s.title)).toEqual(['Informe'])
  })

  it('«BÚSQ» también encuentra (mayúsculas y parcial de palabra, por FTS)', () => {
    expect(drafts.list(repo, 'BÚSQ').map((s) => s.title)).toEqual(['Informe'])
  })

  it('«export» encuentra «Exportación» por título parcial', () => {
    expect(drafts.list(repo, 'export').map((s) => s.title)).toEqual(['Exportación CSV'])
  })

  it('«ui» (dos caracteres) encuentra «UI de pagos»', () => {
    expect(drafts.list(repo, 'ui').map((s) => s.title)).toEqual(['UI de pagos'])
  })

  it('«UI» en mayúsculas también encuentra; un carácter, con acento, igual', () => {
    expect(drafts.list(repo, 'UI').map((s) => s.title)).toEqual(['UI de pagos'])
    const other = freshRepo('search')
    drafts.save(drafts.create(other).id, { title: 'Ördenes', body: 'zz' })
    expect(drafts.list(other, 'ö').map((s) => s.title)).toEqual(['Ördenes'])
  })

  it('sin resultados devuelve una lista vacía', () => {
    expect(drafts.list(repo, 'kubernetes')).toEqual([])
  })

  it('sintaxis FTS en la consulta no erroriza: comillas, OR, asterisco…', () => {
    for (const q of ['"', 'OR', '*', 'a"b OR *', 'OR*', '"x y"', '***', 'NEAR(', '-x', '%', '_']) {
      let r: unknown
      expect(() => (r = drafts.list(repo, q)), `query ${JSON.stringify(q)}`).not.toThrow()
      expect(Array.isArray(r)).toBe(true)
    }
  })

  it('la búsqueda no cruza repositorios', () => {
    const other = freshRepo('search')
    drafts.save(drafts.create(other).id, { title: 'Facturación', body: 'texto' })
    expect(drafts.list(repo, 'facturación')).toEqual([])
    expect(drafts.list(other, 'facturación').map((s) => s.title)).toEqual(['Facturación'])
    expect(drafts.list(other, 'facturacion').map((s) => s.title)).toEqual(['Facturación'])
  })

  it('la consulta vacía o de espacios lista todo el historial', () => {
    expect(drafts.list(repo).map((s) => s.title)).toEqual([
      'UI de pagos',
      'Exportación CSV',
      'Informe'
    ])
    expect(drafts.list(repo, '   ').map((s) => s.title)).toEqual([
      'UI de pagos',
      'Exportación CSV',
      'Informe'
    ])
  })

  it('los resultados de la búsqueda van por updated_at descendente', () => {
    const other = freshRepo('search')
    const a = drafts.create(other)
    drafts.save(a.id, { title: 'uno', body: 'menciona kubernetes dos veces' })
    at('2026-02-01T00:00:00.000Z')
    const b = drafts.create(other)
    drafts.save(b.id, { title: 'dos', body: 'kubernetes otra vez' })
    expect(drafts.list(other, 'kubernetes').map((s) => s.id)).toEqual([b.id, a.id])
  })

  it('los resultados son resúmenes: incluyen length y no el contenido', () => {
    const r = drafts.list(repo, 'export')
    expect(r).toHaveLength(1)
    expect(r[0].length).toBe('otro contenido'.length)
    expect('body' in r[0]).toBe(false)
  })

  it('borrar saca el borrador también de la búsqueda', () => {
    const id = drafts.list(repo, 'export')[0].id
    drafts.remove(id)
    expect(drafts.list(repo, 'export')).toEqual([])
  })
})

describe('persistencia al reabrir la base (tarea 1.5)', () => {
  it('los borradores y la búsqueda sobreviven a cerrar y reabrir', () => {
    const repo = freshRepo('persist')
    at('2026-01-01T00:00:00.000Z')
    const d = drafts.create(repo)
    drafts.save(d.id, { title: 'Persistente', body: 'cuerpo que sobrevive' })
    at('2026-01-02T00:00:00.000Z')
    const d2 = drafts.create(repo)
    drafts.save(d2.id, { title: 'Segundo', body: 'otro más' })
    drafts.markSent(d2.id, 'explore')

    closeDb()
    openDb(DBF)

    const after = drafts.list(repo)
    expect(after.map((s) => s.title)).toEqual(['Segundo', 'Persistente'])
    expect(after[0]).toMatchObject({ status: 'sent', sentMode: 'explore' })
    expect(after[0].sentAt).toBe('2026-01-02T00:00:00.000Z')
    expect(drafts.get(d.id)).toMatchObject({ title: 'Persistente', body: 'cuerpo que sobrevive' })
    expect(drafts.list(repo, 'sobrevive').map((s) => s.id)).toEqual([d.id])
    expect(drafts.list(repo, 'sobr').map((s) => s.id)).toEqual([d.id]) // FTS por subcadena
    expect(drafts.list(repo, 'ui')).toEqual([]) // el camino corto sigue vivo tras reabrir
  })
})

describe('OscCore delega en drafts.ts con métodos delgados', () => {
  let core: OscCore
  let APP: string

  beforeAll(async () => {
    vi.useRealTimers()
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-drafts-core-')))
    const work = path.join(base, 'work')
    APP = path.join(work, 'app')
    fs.mkdirSync(path.join(APP, 'openspec'), { recursive: true })
    const data = path.join(base, 'data')
    core = createOscCore({
      dataDir: data,
      fromStudio: path.join(base, 'no-studio'),
      env: { OSC_DB: path.join(data, 'openspeccontrol.db'), REPOS_ROOT: undefined }
    })
    await core.addRoot({ path: work })
  })

  afterAll(async () => {
    vi.useRealTimers()
    await core.shutdown()
  })

  it('un repo fuera de las carpetas del espacio de trabajo es not_found', async () => {
    const outside = path.join(os.tmpdir(), 'osc-drafts-fuera')
    await expect(core.drafts(outside)).rejects.toMatchObject({ code: 'not_found' })
    await expect(core.createDraft(outside)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('crear, leer, guardar, buscar, duplicar y borrar pasan por el core', async () => {
    const d = await core.createDraft(APP)
    expect(d).toMatchObject({ repo: APP, title: '', body: '', status: 'draft' })
    const saved = await core.saveDraft(d.id, { title: 'Informe', body: 'cuerpo' })
    expect(saved.title).toBe('Informe')
    await expect(core.draft(d.id)).resolves.toMatchObject({ id: d.id, body: 'cuerpo' })
    expect((await core.drafts(APP, 'cuerpo')).map((s) => s.id)).toEqual([d.id])
    expect((await core.drafts(APP)).map((s) => s.id)).toContain(d.id)
    const copy = await core.duplicateDraft(d.id)
    expect(copy.title).toBe('Informe (copy)')
    expect(await core.deleteDraft(d.id)).toEqual({ ok: true })
    await expect(core.draft(d.id)).rejects.toMatchObject({ code: 'not_found' })
    await core.deleteDraft(copy.id)
  })

  it('las reglas del módulo llegan por el core: conflict y too_large', async () => {
    const d = await core.createDraft(APP)
    await core.saveDraft(d.id, { body: 'b' })
    drafts.markSent(d.id, 'propose')
    await expect(core.saveDraft(d.id, { body: 'x' })).rejects.toMatchObject({ code: 'conflict' })
    const other = await core.createDraft(APP)
    await expect(
      core.saveDraft(other.id, { title: 'x'.repeat(MAX_DRAFT_TITLE + 1) })
    ).rejects.toMatchObject({ code: 'too_large' })
    await core.deleteDraft(other.id)
  })
})

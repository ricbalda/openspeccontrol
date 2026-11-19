// The draft channels of the IPC bridge (add-proposal-drafts, tarea 2.2): the
// seven osc:<method> handlers validate their arguments, reject untrusted
// senders, never cut over-limit text (too_large, design D-4) and answer the
// core's own error codes inside the IpcResult envelope. Electron is mocked;
// the core is a fake that records every call (phases 1 and 3 implement it).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type FrameRef, type WebContentsRef } from '../../src/main/ipc.ts'
import { OscError } from '../../src/main/core/errors.ts'
import type { OscCore } from '../../src/main/core/osc-core.ts'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      void handlers.set(ch, fn),
    on: () => {}
  }
}))

const DEV = 'http://localhost:5173'
const frame: FrameRef = { url: `${DEV}/` }
const win = {
  webContents: {
    id: 3,
    mainFrame: frame,
    isDestroyed: () => false,
    send: () => {},
    on: () => {}
  } as WebContentsRef
}

// the fake core: one entry per call, and an optional failure every method throws
const calls: [string, unknown[]][] = []
let failWith: unknown = null
const summary = {
  id: 'd1',
  repo: '/r',
  title: 'Informe',
  status: 'draft' as const,
  sentMode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  sentAt: null,
  length: 1
}
const full = { ...summary, body: 'Añadir búsqueda por cliente' }
const record =
  (name: string, answer: () => unknown) =>
  async (...a: unknown[]) => {
    calls.push([name, a])
    if (failWith) throw failWith
    return answer()
  }
const fakeCore = {
  drafts: record('drafts', () => [summary]),
  draft: record('draft', () => full),
  createDraft: record('createDraft', () => full),
  saveDraft: record('saveDraft', () => full),
  duplicateDraft: record('duplicateDraft', () => full),
  deleteDraft: record('deleteDraft', () => ({ ok: true })),
  sendDraft: record('sendDraft', () => ({ ...full, status: 'sent', sentMode: 'propose' }))
} as unknown as OscCore

const call = (method: string, ...args: unknown[]) =>
  handlers.get(`osc:${method}`)!({ senderFrame: frame }, ...args)

describe('draft channels (add-proposal-drafts, tarea 2.2)', () => {
  beforeAll(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV)
    registerIpc({ core: fakeCore, window: () => win })
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })
  beforeEach(() => {
    calls.length = 0
    failWith = null
  })

  it('forwards the seven calls to the core and wraps the result as { ok: true, data }', async () => {
    expect(await call('drafts', '/r', 'export')).toEqual({ ok: true, data: [summary] })
    expect(calls.at(-1)).toEqual(['drafts', ['/r', 'export']])
    expect(await call('drafts', '/r')).toEqual({ ok: true, data: [summary] })
    expect(calls.at(-1)).toEqual(['drafts', ['/r', undefined]])

    expect(await call('draft', 'd1')).toEqual({ ok: true, data: full })
    expect(calls.at(-1)).toEqual(['draft', ['d1']])

    expect(await call('createDraft', '/r')).toEqual({ ok: true, data: full })
    expect(calls.at(-1)).toEqual(['createDraft', ['/r']])

    const patch = { title: 'Exportación CSV' }
    expect(await call('saveDraft', 'd1', patch)).toEqual({ ok: true, data: full })
    expect(calls.at(-1)).toEqual(['saveDraft', ['d1', patch]])

    expect(await call('duplicateDraft', 'd1')).toEqual({ ok: true, data: full })
    expect(calls.at(-1)).toEqual(['duplicateDraft', ['d1']])

    expect(await call('deleteDraft', 'd1')).toEqual({ ok: true, data: { ok: true } })
    expect(calls.at(-1)).toEqual(['deleteDraft', ['d1']])

    const sent = { ...full, status: 'sent', sentMode: 'propose' }
    expect(await call('sendDraft', 'd1', 'propose')).toEqual({ ok: true, data: sent })
    expect(calls.at(-1)).toEqual(['sendDraft', ['d1', 'propose']])
  })

  it.each([
    ['drafts', ['']],
    ['drafts', ['/r', 42]],
    ['draft', ['']],
    ['draft', [null]],
    ['createDraft', ['']],
    ['saveDraft', ['']],
    ['saveDraft', ['d1', 'nope']],
    ['duplicateDraft', [[]]],
    ['deleteDraft', [{}]],
    ['sendDraft', ['d1', 'send']],
    ['sendDraft', ['d1']]
  ])('rejects invalid arguments to %s without touching the core', async (m, a) => {
    const r = (await call(m, ...a)) as { ok: boolean; error: { code: string; message: string } }
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('invalid')
    expect(calls).toEqual([])
  })

  it.each([
    ['drafts', ['/r', 'q'.repeat(201)]],
    ['saveDraft', ['d1', { title: 't'.repeat(201) }]],
    ['saveDraft', ['d1', { body: 'b'.repeat(100001) }]]
  ])(
    '%s rejects over-limit text with too_large, without cutting or calling the core',
    async (m, a) => {
      const r = (await call(m, ...a)) as { ok: boolean; error: { code: string; message: string } }
      expect(r.ok).toBe(false)
      expect(r.error.code).toBe('too_large')
      expect(r.error.message).toContain('too long')
      expect(calls).toEqual([])
    }
  )

  it('lets the boundary lengths through to the core', async () => {
    await call('drafts', '/r', 'q'.repeat(200))
    await call('saveDraft', 'd1', { title: 't'.repeat(200) })
    await call('saveDraft', 'd1', { body: 'b'.repeat(100000) })
    expect(calls.map(([m]) => m)).toEqual(['drafts', 'saveDraft', 'saveDraft'])
  })

  it('rejects an untrusted sender without running the core', async () => {
    const other: FrameRef = { url: `${DEV}/` } // misma URL, otro frame
    const r = (await handlers.get('osc:createDraft')!({ senderFrame: other }, '/r')) as {
      ok: boolean
      error: { code: string; message: string }
    }
    expect(r).toEqual({ ok: false, error: { code: 'invalid', message: 'untrusted sender' } })
    expect(calls).toEqual([])
  })

  it.each([
    ['not_found', 'draft not found'],
    ['conflict', 'draft already sent'],
    ['too_large', 'draft is longer than 4000 characters']
  ] as const)('maps a core OscError to its code in the envelope (%s)', async (code, message) => {
    failWith = new OscError(code, message)
    const r = (await call('sendDraft', 'd1', 'propose')) as {
      ok: boolean
      error: { code: string; message: string }
    }
    expect(r).toEqual({ ok: false, error: { code, message } })
  })

  it('maps anything else the core throws to internal', async () => {
    failWith = new Error('boom')
    const r = (await call('draft', 'd1')) as { ok: boolean; error: { code: string } }
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('internal')
  })
})

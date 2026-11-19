// The IPC bridge (Fase 3): sender validation (only the main window's main
// frame, on the origin we loaded), the { ok, data } / { ok: false, error }
// envelope, and the renderer lifecycle that drops subscriptions when its
// webContents goes away. Electron is mocked; the lifecycle cases run against a
// real OscCore so the watcher actually stops.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from '@shared/protocol.ts'
import {
  makeTrustedSender,
  packagedIndexUrl,
  registerIpc,
  type FrameRef,
  type WebContentsRef
} from '../../src/main/ipc.ts'
import { OscError } from '../../src/main/core/errors.ts'
import { createOscCore, type OscCore } from '../../src/main/core/osc-core.ts'

const { handlers, listeners } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  listeners: new Map<
    string,
    (event: { senderFrame?: unknown; sender?: unknown }, msg?: unknown) => void
  >()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      void handlers.set(ch, fn),
    on: (
      ch: string,
      fn: (event: { senderFrame?: unknown; sender?: unknown }, msg?: unknown) => void
    ) => void listeners.set(ch, fn)
  }
}))

const DEV = 'http://localhost:5173'
const fakeContents = (frame: FrameRef): WebContentsRef => ({
  id: 1,
  mainFrame: frame,
  isDestroyed: () => false,
  send: () => {},
  on: () => {}
})

describe('isTrustedSender (tarea 3.10)', () => {
  beforeAll(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('accepts the main window main frame on the dev origin', () => {
    const frame: FrameRef = { url: `${DEV}/` }
    const check = makeTrustedSender(() => ({ webContents: fakeContents(frame) }))
    expect(check(frame)).toBe(true)
  })

  it('accepts the packaged index.html origin when there is no dev server', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
    const frame: FrameRef = { url: packagedIndexUrl() }
    const check = makeTrustedSender(() => ({ webContents: fakeContents(frame) }))
    expect(check(frame)).toBe(true)
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV)
  })

  it('rejects an iframe: another frame, even with our URL', () => {
    const frame: FrameRef = { url: `${DEV}/` }
    const check = makeTrustedSender(() => ({ webContents: fakeContents(frame) }))
    expect(check({ url: `${DEV}/` })).toBe(false)
  })

  it('rejects the main frame of another webContents', () => {
    const check = makeTrustedSender(() => ({ webContents: fakeContents({ url: `${DEV}/` }) }))
    expect(check({ url: `${DEV}/` })).toBe(false)
  })

  it('rejects our frame on another URL (it navigated away)', () => {
    const frame: FrameRef = { url: 'https://evil.example' }
    const check = makeTrustedSender(() => ({ webContents: fakeContents(frame) }))
    expect(check(frame)).toBe(false)
  })

  it('rejects everything when the window does not exist yet', () => {
    const check = makeTrustedSender(() => null)
    expect(check({ url: `${DEV}/` })).toBe(false)
    expect(check(null)).toBe(false)
  })
})

describe('invoke envelope (tarea 3.2)', () => {
  const frame: FrameRef = { url: `${DEV}/` }
  const win = { webContents: fakeContents(frame) }
  const touched: string[] = []
  const fakeCore = {
    repos: async (refresh: boolean) => {
      touched.push('repos')
      return { refresh, roots: [], repos: [] }
    },
    addRoot: async () => {
      touched.push('addRoot')
      throw new OscError('invalid', 'Folder not found: /nope')
    },
    changes: async () => {
      touched.push('changes')
      throw new Error('boom')
    }
  } as unknown as OscCore

  beforeAll(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV)
    registerIpc({ core: fakeCore, window: () => win })
  })

  it('wraps a success as { ok: true, data }', async () => {
    const r = (await handlers.get('osc:repos')!({ senderFrame: frame }, true)) as any
    expect(r).toEqual({ ok: true, data: { refresh: true, roots: [], repos: [] } })
  })

  it('maps an OscError to its code and message, without throwing', async () => {
    const r = (await handlers.get('osc:addRoot')!({ senderFrame: frame }, '/nope')) as any
    expect(r).toEqual({ ok: false, error: { code: 'invalid', message: 'Folder not found: /nope' } })
  })

  it('maps anything else to internal', async () => {
    const r = (await handlers.get('osc:changes')!({ senderFrame: frame }, '/r')) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatchObject({ code: 'internal', message: 'boom' })
  })

  it('rejects an untrusted sender without running the core', async () => {
    touched.length = 0
    const r = (await handlers.get('osc:repos')!({ senderFrame: { url: `${DEV}/` } }, true)) as any
    expect(r).toEqual({ ok: false, error: { code: 'invalid', message: 'untrusted sender' } })
    expect(touched).toEqual([])
  })

  it('rejects arguments that fail their zod schema with code invalid', async () => {
    touched.length = 0
    const r = (await handlers.get('osc:repos')!({ senderFrame: frame }, 'nope')) as any
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('invalid')
    expect(r.error.message).toContain('invalid arguments')
    expect(touched).toEqual([])
  })
})

describe('client messages and renderer lifecycle (tareas 3.3 y 3.4)', () => {
  let core: OscCore
  let APP: string
  const sent: [string, ServerMsg][] = []
  const wcEvents = new Map<string, () => void>()
  let destroyed = false
  const frame: FrameRef = { url: `${DEV}/` }
  const wc: WebContentsRef = {
    id: 7,
    mainFrame: frame,
    isDestroyed: () => destroyed,
    send: (ch, m) => sent.push([ch, m as ServerMsg]),
    on: (ev, fn) => wcEvents.set(ev, fn)
  }
  const win = { webContents: wc }
  const client = (frameRef: unknown, msg: unknown) =>
    listeners.get('osc:client-msg')!({ senderFrame: frameRef, sender: wc }, msg)
  const settle = () => new Promise((r) => setTimeout(r, 50))

  beforeAll(async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV)
    const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-bridge-data-'))
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-bridge-')))
    delete process.env.REPOS_ROOT
    const WORK = path.join(base, 'work')
    APP = path.join(WORK, 'app')
    fs.mkdirSync(path.join(APP, 'openspec', 'changes', 'add-x'), { recursive: true })
    fs.writeFileSync(path.join(APP, 'openspec', 'changes', 'add-x', 'proposal.md'), '# Proposal\n')
    core = createOscCore({ dataDir: DATA, fromStudio: path.join(base, 'no-studio') })
    await core.addRoot({ path: WORK })
    registerIpc({ core, window: () => win }).attachWindow(win)
  })

  afterAll(async () => {
    await core.shutdown()
  })

  beforeEach(() => {
    sent.length = 0
  })

  it('delivers a trusted subscribe to the core, which answers over osc:server-msg', async () => {
    client(frame, { type: 'subscribe', repo: APP })
    await settle()
    expect(sent.map(([ch]) => ch)).toEqual(['osc:server-msg', 'osc:server-msg'])
    expect(sent[0][1]).toMatchObject({ type: 'session', repo: APP, session: null })
    expect(sent[1][1]).toMatchObject({ type: 'replay', repo: APP, entries: [] })
    expect(core.activeWatchers).toBe(1) // a subscriber keeps the repo watcher alive
  })

  it('rejects a client message from another frame without touching the core', async () => {
    client({ url: 'https://evil.example' }, { type: 'subscribe', repo: APP })
    await settle()
    expect(sent).toEqual([])
    expect(core.activeWatchers).toBe(1) // unchanged: the old subscription stays
  })

  it('answers an invalid client message with a server error, not a throw', async () => {
    client(frame, { type: 'nonsense' })
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toMatchObject({ type: 'error', message: expect.stringContaining('invalid') })
  })

  it.each(['did-start-navigation', 'destroyed', 'render-process-gone'] as const)(
    'a %s drops the subscriptions and stops the repo watcher',
    async (ev) => {
      expect(core.activeWatchers).toBe(1)
      wcEvents.get(ev)!()
      expect(core.activeWatchers).toBe(0)
      // the reloaded page subscribes again...
      client(frame, { type: 'subscribe', repo: APP })
      await settle()
      expect(core.activeWatchers).toBe(1)
    }
  )

  it('never sends to a destroyed webContents', async () => {
    destroyed = true
    client(frame, { type: 'subscribe', repo: APP })
    await settle()
    expect(core.activeWatchers).toBe(1) // subscribed core-side...
    expect(sent).toEqual([]) // ...but nothing goes out to the dead contents
    wcEvents.get('destroyed')!() // and the lifecycle cleans it up
    expect(core.activeWatchers).toBe(0)
    destroyed = false
  })

  it('lets an unsubscribe through osc:client-msg and stops the repo watcher (multi-repo-rail, tarea 1.3)', async () => {
    client(frame, { type: 'subscribe', repo: APP })
    await settle()
    expect(core.activeWatchers).toBe(1) // followed through the bridge

    client(frame, { type: 'unsubscribe', repo: APP })
    await settle()
    expect(core.activeWatchers).toBe(0) // ...and dropped through the bridge
  })
})

// Fase 5: the native-integration IPC channels — same envelope and trusted
// sender rule as the Fase 3 bridge (they share makeTrustedSender), one check
// per method: the folder picker round trip, notifications, the link scheme
// filter, the theme mirror, and the two file-manager actions.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createOscCore, type OscCore } from '../../src/main/core/osc-core.ts'
import { registerNativeIpc } from '../../src/main/desktop/ipc-native.ts'
import type { FrameRef } from '../../src/main/ipc.ts'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  dialogResult: null as null | { canceled: boolean; filePaths: string[] },
  dialogCalls: [] as unknown[],
  opened: [] as string[],
  shownPaths: [] as string[],
  openedPaths: [] as string[],
  themeSource: '',
  supported: true,
  shown: 0
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, ...a: unknown[]) => Promise<unknown>) =>
      void state.handlers.set(ch, fn)
  },
  dialog: {
    showOpenDialog: async (parent: unknown, opts: unknown) => {
      state.dialogCalls.push({ parent, opts })
      return state.dialogResult
    }
  },
  shell: {
    openExternal: async (url: string) => void state.opened.push(url),
    openPath: async (p: string) => {
      state.openedPaths.push(p)
      return ''
    },
    showItemInFolder: (p: string) => void state.shownPaths.push(p)
  },
  nativeTheme: {
    get themeSource() {
      return state.themeSource
    },
    set themeSource(v: string) {
      state.themeSource = v
    }
  },
  Notification: class {
    static isSupported() {
      return state.supported
    }
    clicks: (() => void)[] = []
    on(_ev: string, fn: () => void) {
      this.clicks.push(fn)
    }
    show() {
      state.shown++
    }
  }
}))

const DEV = 'http://localhost:5173'

describe('native integration channels (Fase 5)', () => {
  let core: OscCore
  let DATA: string
  let WORK: string
  let APP: string
  const flashLog: string[] = []
  const frame: FrameRef = { url: `${DEV}/` }
  const fakeWin = {
    webContents: {
      id: 3,
      mainFrame: frame,
      isDestroyed: () => false,
      send: () => {},
      on: () => {}
    },
    isFocused: () => false,
    isDestroyed: () => false,
    show: () => {},
    focus: () => {},
    flashFrame: (f: boolean) => flashLog.push(`flash:${f}`),
    once: () => {}
  }

  beforeAll(async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV)
    DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc5-data-'))
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ipc5-')))
    WORK = path.join(base, 'work')
    APP = path.join(WORK, 'app')
    fs.mkdirSync(path.join(APP, 'openspec', 'changes', 'add-x'), { recursive: true })
    fs.writeFileSync(path.join(APP, 'openspec', 'changes', 'add-x', 'proposal.md'), '# P\n')
    core = createOscCore({ dataDir: DATA, fromStudio: path.join(base, 'no-studio') })
    registerNativeIpc({ core, win: () => fakeWin as never })
  })
  afterAll(async () => {
    vi.unstubAllEnvs()
    await core.shutdown()
  })

  const call = (method: string, senderFrame: unknown, ...args: unknown[]) =>
    state.handlers.get(`osc:${method}`)!({ senderFrame }, ...args) as Promise<any>

  it('rejects an untrusted sender like the Fase 3 bridge does', async () => {
    const r = await call('notify', { url: 'https://evil.example' }, { title: 'x' })
    expect(r).toEqual({ ok: false, error: { code: 'invalid', message: 'untrusted sender' } })
    expect(state.shown).toBe(0)
  })

  it('pickFolder answers null on cancel and passes the window to the dialog', async () => {
    state.dialogResult = { canceled: true, filePaths: [] }
    const r = await call('pickFolder', frame)
    expect(r).toEqual({ ok: true, data: null })
    expect(state.dialogCalls[0]).toMatchObject({ parent: fakeWin })
  })

  it('pickFolder adds the chosen folder to the workspace', async () => {
    state.dialogResult = { canceled: false, filePaths: [WORK] }
    const r = await call('pickFolder', frame)
    expect(r.ok).toBe(true)
    expect(r.data.roots.some((x: { path: string }) => x.path === WORK)).toBe(true)
  })

  it('notify shows an OS notification for the unfocused window', async () => {
    const r = await call('notify', frame, { title: 'Done', body: 'build', kind: 'attention' })
    expect(r).toEqual({ ok: true, data: { ok: true } })
    expect(state.shown).toBe(1)
    expect(flashLog).toContain('flash:true')
  })

  it('notify validates its body', async () => {
    const r = await call('notify', frame, { title: '' })
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('invalid')
  })

  it('openExternal passes http(s)/mailto to the OS and refuses everything else', async () => {
    await expect(
      call('openExternal', frame, 'https://github.com/ricbalda/openspeccontrol')
    ).resolves.toMatchObject({ ok: true, data: { opened: true } })
    const refused = await call('openExternal', frame, 'file:///C:/Windows/notepad.exe')
    expect(refused).toMatchObject({ ok: true, data: { opened: false } })
    expect(state.opened).toEqual(['https://github.com/ricbalda/openspeccontrol'])
  })

  it('setNativeTheme mirrors the choice and rejects unknown values', async () => {
    await expect(call('setNativeTheme', frame, 'dark')).resolves.toMatchObject({
      ok: true,
      data: { ok: true }
    })
    expect(state.themeSource).toBe('dark')
    const bad = await call('setNativeTheme', frame, 'blue')
    expect(bad.error.code).toBe('invalid')
  })

  it('showInExplorer reveals only known repos', async () => {
    const bad = await call('showInExplorer', frame, path.join(os.tmpdir(), 'never-added'))
    expect(bad).toEqual({ ok: false, error: { code: 'not_found', message: 'repo not found' } })
    await expect(call('showInExplorer', frame, APP)).resolves.toMatchObject({ ok: true })
    expect(state.shownPaths).toEqual([APP])
  })

  it('openDataFolder opens the core data dir', async () => {
    await expect(call('openDataFolder', frame)).resolves.toMatchObject({ ok: true })
    expect(state.openedPaths).toEqual([DATA])
  })

  it('createDemoRepo: remitente no fiable, agente inválido o desconocido y cancelación', async () => {
    state.dialogCalls.length = 0
    const evil = await call('createDemoRepo', { url: 'https://evil.example' }, null)
    expect(evil).toEqual({ ok: false, error: { code: 'invalid', message: 'untrusted sender' } })
    const notString = await call('createDemoRepo', frame, 42)
    expect(notString.error.code).toBe('invalid')
    const unknown = await call('createDemoRepo', frame, 'no-such-agent')
    expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(state.dialogCalls).toHaveLength(0) // ni siquiera se abrió el selector
    state.dialogResult = { canceled: true, filePaths: [] }
    await expect(call('createDemoRepo', frame, 'claude')).resolves.toEqual({ ok: true, data: null })
    expect(state.dialogCalls[0]).toMatchObject({ parent: fakeWin })
  })
})

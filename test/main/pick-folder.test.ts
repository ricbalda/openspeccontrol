// Fase 5.1: pickFolder() against a real OscCore and a mocked dialog — choose,
// cancel, and a rejected choice (the drive root) that must surface the core's
// own validation error instead of adding anything.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createOscCore, type OscCore } from '../../src/main/core/osc-core.ts'
import { pickFolder } from '../../src/main/desktop/pick-folder.ts'

const dialogState = vi.hoisted(() => ({
  result: null as null | { canceled: boolean; filePaths: string[] },
  calls: [] as unknown[]
}))
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: async (parent: unknown, opts: unknown) => {
      dialogState.calls.push({ parent, opts })
      return dialogState.result
    }
  }
}))

const fakeWin = { id: 1, isFocused: () => false } // just a parent handle for the dialog

describe('pickFolder (tarea 5.1)', () => {
  let core: OscCore
  let base: string
  let picked: string

  beforeAll(async () => {
    const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-folder-data-'))
    base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pick-folder-')))
    picked = path.join(base, 'repos')
    fs.mkdirSync(picked, { recursive: true })
    fs.mkdirSync(path.join(picked, 'app', 'openspec', 'changes', 'add-x'), { recursive: true })
    core = createOscCore({ dataDir: DATA, fromStudio: path.join(base, 'no-studio') })
  })
  afterAll(async () => {
    await core.shutdown()
  })

  it('opens the directory picker on the app window', async () => {
    dialogState.result = { canceled: true, filePaths: [] }
    await pickFolder(core, fakeWin as never)
    expect(dialogState.calls.length).toBeGreaterThan(0)
    expect(dialogState.calls[0]).toMatchObject({
      parent: fakeWin,
      opts: { properties: ['openDirectory', 'createDirectory'] }
    })
  })

  it('adds the chosen folder and answers the refreshed workspace', async () => {
    dialogState.result = { canceled: false, filePaths: [picked] }
    const w = await pickFolder(core, fakeWin as never)
    expect(w).not.toBeNull()
    expect(w!.roots.some((r) => r.path === picked && !r.fromEnv)).toBe(true)
    expect(w!.repos.some((r) => r.name === 'app')).toBe(true)
  })

  it('answers null when the user cancels, adding nothing', async () => {
    const before = (await core.repos()).roots.length
    dialogState.result = { canceled: true, filePaths: [] }
    const w = await pickFolder(core, fakeWin as never)
    expect(w).toBeNull()
    expect((await core.repos()).roots.length).toBe(before)
  })

  it('propagates the core validation for a whole-drive pick', async () => {
    const drive = path.parse(base).root // 'C:\' (or '/' on posix): dirname(root) === root
    dialogState.result = { canceled: false, filePaths: [drive] }
    await expect(pickFolder(core, fakeWin as never)).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringMatching(/more specific folder/)
    })
  })
})

// Fase 5.7: el flujo nativo de Ayuda → Crear repositorio de demostración:
// selector de carpeta (main), agente validado, hello-app creada de forma
// asíncrona y añadida al workspace. git y openspec se sustituyen por stubs.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOscCore, type OscCore } from '../../src/main/core/osc-core.ts'
import { pickAndCreateDemoRepo } from '../../src/main/desktop/demo-repo-flow.ts'
import { DEMO_CHANGE, DEMO_REPO_NAME } from '../../scripts/demo-repo-files.mjs'

const state = vi.hoisted(() => ({
  result: null as null | { canceled: boolean; filePaths: string[] },
  calls: [] as { parent: unknown; opts: unknown }[]
}))
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: async (...a: unknown[]) => {
      const [parent, opts] = a.length === 2 ? a : [null, a[0]]
      state.calls.push({ parent, opts })
      return state.result
    }
  }
}))

const inits: { repo: string; tool: string }[] = []
const runners = {
  git: async () => ({ ok: true, stderr: '' }),
  openspecInit: async (repo: string, tool: string) => {
    inits.push({ repo, tool })
    return { ok: true, out: 'ok' }
  }
}
const fakeWin = { id: 'win' } as never

describe('pickAndCreateDemoRepo (tarea 5.7)', () => {
  let core: OscCore
  let base: string

  beforeAll(() => {
    base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-flow-')))
    core = createOscCore({
      dataDir: path.join(base, 'data'),
      fromStudio: path.join(base, 'no-studio')
    })
  })
  afterAll(async () => {
    await core.shutdown()
  })
  beforeEach(() => {
    state.result = null
    state.calls.length = 0
    inits.length = 0
  })

  it('devuelve null al cancelar el selector y no crea nada', async () => {
    state.result = { canceled: true, filePaths: [] }
    const r = await pickAndCreateDemoRepo(core, fakeWin, null, runners)
    expect(r).toBeNull()
    expect(state.calls[0]).toMatchObject({ parent: fakeWin })
    expect((await core.repos(true)).roots).toEqual([])
  })

  it('un agente desconocido falla antes de abrir el diálogo', async () => {
    await expect(
      pickAndCreateDemoRepo(core, fakeWin, 'no-such-agent', runners)
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(state.calls).toHaveLength(0)
  })

  it('crea hello-app, la añade al workspace y devuelve el cambio a seleccionar', async () => {
    const folder = path.join(base, 'pick-a')
    fs.mkdirSync(folder)
    state.result = { canceled: false, filePaths: [folder] }
    const r = await pickAndCreateDemoRepo(core, fakeWin, 'claude', runners)
    const repo = path.join(folder, DEMO_REPO_NAME)
    expect(r).not.toBeNull()
    expect(r!.repo).toBe(fs.realpathSync.native(repo))
    expect(r!.change).toBe(DEMO_CHANGE)
    expect(r!.warnings).toEqual([])
    expect(fs.existsSync(path.join(repo, 'openspec', 'changes', DEMO_CHANGE, 'proposal.md'))).toBe(
      true
    )
    expect(inits).toEqual([{ repo, tool: 'claude' }]) // el openspecTool del agente
    expect(r!.workspace.repos.map((x) => x.id)).toContain(r!.repo)
    expect(r!.workspace.roots.map((x) => x.path)).toContain(fs.realpathSync.native(repo))
  })

  it('sin agente no ejecuta openspec init', async () => {
    const folder = path.join(base, 'pick-b')
    fs.mkdirSync(folder)
    state.result = { canceled: false, filePaths: [folder] }
    const r = await pickAndCreateDemoRepo(core, null, null, runners)
    expect(r!.openspecOk).toBe(true)
    expect(inits).toEqual([])
    expect(state.calls[0]).toMatchObject({ parent: null }) // sin ventana sigue funcionando
  })

  it('si la carpeta elegida ya es una raíz no añade otra raíz', async () => {
    const folder = path.join(base, 'pick-c')
    fs.mkdirSync(folder)
    await core.addRoot({ path: folder })
    const before = (await core.repos(true)).roots.length
    state.result = { canceled: false, filePaths: [folder] }
    const r = await pickAndCreateDemoRepo(core, fakeWin, null, runners)
    expect(r!.workspace.repos.map((x) => x.id)).toContain(r!.repo)
    expect(r!.workspace.roots).toHaveLength(before)
  })

  it('un fallo de openspec/git degrada a avisos sin fallar la acción', async () => {
    const folder = path.join(base, 'pick-d')
    fs.mkdirSync(folder)
    state.result = { canceled: false, filePaths: [folder] }
    const r = await pickAndCreateDemoRepo(core, fakeWin, 'codex', {
      git: async () => ({ ok: false, stderr: 'git: not found' }),
      openspecInit: async () => ({ ok: false, out: 'command not found' })
    })
    expect(r!.openspecOk).toBe(false)
    expect(r!.gitOk).toBe(false)
    expect(r!.warnings).toHaveLength(2)
  })
})

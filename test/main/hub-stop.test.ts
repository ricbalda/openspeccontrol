import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerMsg } from '@shared/protocol.ts'
import { createOscCore, type OscCore, type Subscriber } from '../../src/main/core/osc-core.ts'

// Fase 11 (hallazgo de la tarea 11.5): parar un agente a propósito (botón Stop,
// reconectar, cambiar de agente, cerrar la app) no es un fallo del agente. En
// Windows el árbol se mata con `taskkill /F` y el proceso sale con código 1: el
// hub lo contaba como caída y dejaba «<agente> exited (code 1)» en el log y en la
// transcripción — y, al cerrar, ese aviso tardío llegaba ya con la db cerrada
// («database not opened», excepción sin capturar en el proceso principal).

const FAKE_AGENT = path.resolve(import.meta.dirname, '..', 'e2e', 'fake-acp-agent.mjs')
delete process.env.REPOS_ROOT

let tmp: string
let core: OscCore
let repoId: string

beforeAll(async () => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-hub-stop-')))
  const data = path.join(tmp, 'data')
  fs.mkdirSync(data)
  const work = path.join(tmp, 'work')
  const repo = path.join(work, 'app')
  fs.mkdirSync(path.join(repo, 'openspec', 'changes'), { recursive: true })
  repoId = fs.realpathSync.native(repo)
  fs.writeFileSync(
    path.join(data, 'agents.json'),
    JSON.stringify([{ id: 'fake', label: 'Fake', cmd: process.execPath, args: [FAKE_AGENT] }])
  )
  core = createOscCore({ dataDir: data, fromStudio: path.join(tmp, 'no-studio') })
  await core.addRoot({ path: work })
})

afterAll(async () => {
  await core.shutdown()
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('parar el agente a propósito (hub)', () => {
  it('no deja un aviso de error «exited» en el log', async () => {
    const got: ServerMsg[] = []
    const sub = { id: 1, send: (m: ServerMsg) => got.push(m) } as Subscriber
    await core.handleClientMsg(sub, { type: 'subscribe', repo: repoId })
    await core.handleClientMsg(sub, { type: 'start', repo: repoId, agent: 'fake' })
    const t0 = Date.now()
    while (!got.some((m) => m.type === 'session' && m.session?.status === 'ready')) {
      if (Date.now() - t0 > 30_000) throw new Error('el agente falso no llegó a ready')
      await new Promise((r) => setTimeout(r, 20))
    }

    await core.handleClientMsg(sub, { type: 'stop', repo: repoId })
    await new Promise((r) => setTimeout(r, 1500)) // da tiempo a que llegue el exit del proceso

    const errors = got.flatMap((m) =>
      m.type === 'event' && m.entry.event.kind === 'notice' && m.entry.event.level === 'error'
        ? [m.entry.event.text]
        : []
    )
    expect(errors).toEqual([])
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerMsg } from '@shared/protocol.ts'
import { createOscCore, type OscCore, type Subscriber } from '../../src/main/core/osc-core.ts'

// Fase 11 (tarea 11.5): benchmark del núcleo, sin Electron. Un agente ACP falso
// (test/e2e/fake-acp-agent.mjs) emite una sesión de 2500 eventos por el camino
// real: hub → log de eventos en SQLite → entrega a los suscriptores. El bucle de
// eventos de Node es el del proceso principal de la app: si se bloquea, la
// ventana deja de recibir mensajes y de responder al IPC. Los umbrales son
// holgados (la CI es lenta y compartida); las mediciones de la app real están en
// test/INFORME-FASE11.md y se regeneran con `node test/e2e/perf.mjs`.

const FAKE_AGENT = path.resolve(import.meta.dirname, '..', 'e2e', 'fake-acp-agent.mjs')
const EVENTS = 2500

/** nunca el ~/.openspec-studio real del desarrollador, ni el REPOS_ROOT del entorno */
delete process.env.REPOS_ROOT

let tmp: string
let core: OscCore
let repoId: string

beforeAll(async () => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-perf-core-')))
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

const waitUntil = async (what: string, cond: () => boolean, timeoutMs: number): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`tiempo agotado esperando: ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('sesión de más de 2000 eventos (tarea 11.5)', () => {
  it(`registra y entrega ${EVENTS} eventos sin bloquear el bucle del proceso principal`, async () => {
    const got: ServerMsg[] = []
    const sub = { id: 1, send: (m: ServerMsg) => got.push(m) } as Subscriber
    await core.handleClientMsg(sub, { type: 'subscribe', repo: repoId })
    await core.handleClientMsg(sub, { type: 'start', repo: repoId, agent: 'fake' })
    await waitUntil(
      'sesión lista',
      () => got.some((m) => m.type === 'session' && m.session?.status === 'ready'),
      30_000
    )

    const delay = monitorEventLoopDelay({ resolution: 1 })
    delay.enable()
    const t0 = performance.now()
    await core.handleClientMsg(sub, {
      type: 'prompt',
      repo: repoId,
      text: `carga events=${EVENTS}`
    })
    const isTurnEnd = (m: ServerMsg) => m.type === 'event' && m.entry.event.kind === 'turn_end'
    await waitUntil('fin del turno', () => got.some(isTurnEnd), 60_000)
    const totalMs = performance.now() - t0
    delay.disable()

    const delivered = got.filter((m) => m.type === 'event')
    const maxLagMs = delay.max / 1e6
    console.log(
      `[perf-core] ${delivered.length} eventos en ${Math.round(totalMs)} ms ` +
        `(${(totalMs / delivered.length).toFixed(2)} ms/evento); retardo máximo del bucle ${maxLagMs.toFixed(0)} ms, p99 ${(delay.percentile(99) / 1e6).toFixed(0)} ms`
    )

    expect(delivered.length).toBeGreaterThanOrEqual(EVENTS)
    // el bucle nunca se queda parado más de 1 s (en un portátil real salen decenas de ms)
    expect(maxLagMs).toBeLessThan(1000)
    expect(totalMs).toBeLessThan(30_000)
    // y todo quedó en el log: el replay recibe los últimos 2000
    const replay: ServerMsg[] = []
    await core.handleClientMsg({ id: 2, send: (m: ServerMsg) => replay.push(m) } as Subscriber, {
      type: 'subscribe',
      repo: repoId
    })
    const r = replay.find((m) => m.type === 'replay')
    expect(r && r.type === 'replay' ? r.entries.length : 0).toBe(2000)
  })
})

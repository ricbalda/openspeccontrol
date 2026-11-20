// Tarea 3.1 (add-proposal-drafts): OscCore.sendDraft sobre el camino real de
// action(), con un agente ACP falso que completa el apretón de manos y apunta
// cada prompt que recibe. Cubre el envío correcto (el agente recibe
// «/opsx:propose <contenido>», recortado), la falta de sesión, el agente
// ocupado, el too_large sin llamar al agente, el propose vacío y el reenvío.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerMsg } from '@shared/protocol.ts'
import { createOscCore, type OscCore, type Subscriber } from '../../src/main/core/osc-core.ts'
import * as drafts from '../../src/main/core/drafts.ts'

// directorio de datos aislado; fromStudio apunta a una carpeta que no existe
// para no importar nunca el ~/.openspec-studio real del desarrollador
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-drafts-data-'))
delete process.env.REPOS_ROOT

let core: OscCore
let APP: string
let LOG: string

// el agente ACP falso: initialize, session/new y session/prompt. Cada prompt se
// apunta en LOG (la prueba del envío correcto lee ahí); si el texto contiene
// «STALL» no contesta nunca, dejando la sesión ocupada como un agente trabajando
const fakeAgent = (log: string) => `
import fs from 'node:fs'
import readline from 'node:readline'
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.method === 'initialize')
    send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } })
  else if (msg.method === 'session/new') send({ id: msg.id, result: { sessionId: 'fake-1' } })
  else if (msg.method === 'session/prompt') {
    const text = (msg.params?.prompt ?? []).map((p) => p.text ?? '').join(' ')
    fs.appendFileSync(${JSON.stringify(log)}, text + '\\n')
    if (!text.includes('STALL')) send({ id: msg.id, result: { stopReason: 'end_turn' } })
  } else if (msg.id !== undefined)
    send({ id: msg.id, error: { code: -32601, message: 'no soportado' } })
})
`

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-drafts-')))
  const work = path.join(base, 'work')
  APP = path.join(work, 'app')
  fs.mkdirSync(path.join(APP, 'openspec', 'changes'), { recursive: true })
  LOG = path.join(DATA, 'fake-agent.log')
  fs.writeFileSync(path.join(DATA, 'fake-agent.mjs'), fakeAgent(LOG))
  fs.writeFileSync(
    path.join(DATA, 'agents.json'),
    JSON.stringify([
      // sin «style»: slash, o sea /opsx:<acción> <texto> como Claude/CodeBuddy
      {
        id: 'fake',
        label: 'Fake',
        cmd: process.execPath,
        args: [path.join(DATA, 'fake-agent.mjs')]
      }
    ])
  )
  core = createOscCore({ dataDir: DATA, fromStudio: path.join(base, 'no-studio') })
  await core.addRoot({ path: work })
})

afterAll(async () => {
  await core.shutdown()
})

/** Espera (con tope) a que la condición se cumpla: el agente es un proceso. */
const until = async (cond: () => boolean, ms = 15000): Promise<void> => {
  for (const end = Date.now() + ms; !cond();) {
    if (Date.now() > end) throw new Error('timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 25))
  }
}

const sink = (): Subscriber => {
  const got: ServerMsg[] = []
  return { id: got.length, send: (m) => void got.push(m) }
}

const startAgent = async (): Promise<void> => {
  const sub = sink()
  core.handleClientMsg(sub, { type: 'start', repo: APP, agent: 'fake' }).catch(() => {})
  await until(() => core.sessionStates().some((x) => x.repo === APP && x.state.status === 'ready'))
  core.unsubscribe(sub)
}

const stopAgent = async (): Promise<void> => {
  const sub = sink()
  await core.handleClientMsg(sub, { type: 'stop', repo: APP })
  core.unsubscribe(sub)
}

const logText = (): string => {
  try {
    return fs.readFileSync(LOG, 'utf8')
  } catch {
    return ''
  }
}

/** Un borrador nuevo del repo con ese contenido. */
const draftWith = async (body: string): Promise<string> => {
  const d = await drafts.create(APP)
  await drafts.save(d.id, { body })
  return d.id
}

describe('OscCore.sendDraft (tarea 3.1, design D-5)', () => {
  it('un propose vacío se rechaza y el borrador sigue sin enviar', async () => {
    const id = await draftWith('   ')
    await expect(core.sendDraft(id, 'propose')).rejects.toMatchObject({ code: 'invalid' })
    expect((await drafts.get(id))?.status).toBe('draft')
  })

  it('más de 4000 caracteres es too_large sin llamar al agente', async () => {
    await startAgent()
    const id = await draftWith('x'.repeat(4001))
    const before = logText()
    await expect(core.sendDraft(id, 'explore')).rejects.toMatchObject({ code: 'too_large' })
    expect((await drafts.get(id))?.status).toBe('draft')
    expect(logText()).toBe(before) // conectado y listo, pero no recibió nada
  })

  it('sin sesión de agente es conflict y el borrador queda intacto', async () => {
    await stopAgent()
    const id = await draftWith('Añadir exportación a CSV')
    await expect(core.sendDraft(id, 'explore')).rejects.toMatchObject({ code: 'conflict' })
    expect((await drafts.get(id))?.status).toBe('draft')
  })

  it('un envío correcto entrega /opsx:propose con el contenido (recortado)', async () => {
    await startAgent()
    const id = await draftWith('  Añadir exportación a CSV del informe mensual  ')
    const sent = await core.sendDraft(id, 'propose')
    expect(sent).toMatchObject({ id, status: 'sent', sentMode: 'propose' })
    expect(sent.sentAt).toBeTruthy()
    expect((await drafts.get(id))?.status).toBe('sent')
    await until(() => logText().includes('/opsx:propose Añadir exportación a CSV del informe'))
    expect(logText()).not.toMatch(/^[^\n]*[ \t]+$/m) // sin el recorte vería los espacios
  })

  it('con el agente ocupado es conflict y el borrador sigue sin enviar', async () => {
    // la sesión quedó lista en la prueba anterior; un turno que no termina la deja busy
    const sub = sink()
    core
      .handleClientMsg(sub, { type: 'prompt', repo: APP, text: 'STALL: no contestes' })
      .catch(() => {})
    await until(() => core.sessionStates().some((x) => x.repo === APP && x.state.status === 'busy'))
    const id = await draftWith('Añadir búsqueda por cliente')
    await expect(core.sendDraft(id, 'explore')).rejects.toMatchObject({ code: 'conflict' })
    expect((await drafts.get(id))?.status).toBe('draft')
    expect(logText()).not.toContain('/opsx:explore')
    core.unsubscribe(sub)
  })

  it('reenviar un borrador ya enviado es conflict', async () => {
    await startAgent() // arranca una sesión nueva: la anterior quedó ocupada
    const id = await draftWith('Añadir búsqueda por cliente')
    await expect(core.sendDraft(id, 'explore')).resolves.toMatchObject({ status: 'sent' })
    await expect(core.sendDraft(id, 'explore')).rejects.toMatchObject({ code: 'conflict' })
    const d = await drafts.get(id)
    expect(d?.sentAt).toBeTruthy()
  })
})

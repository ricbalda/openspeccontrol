// Agente ACP falso para las pruebas de rendimiento (Fase 11, tarea 11.5) y del
// E2E multi-repo (multi-repo-rail, tarea 5.2).
//
// Habla ACP (JSON-RPC 2.0 por stdin/stdout, un mensaje por línea) lo justo para
// que el hub de la app lo trate como un agente real: initialize, session/new y
// session/prompt. Al recibir un prompt emite una ráfaga de notificaciones
// `session/update` (texto en trozos, llamadas a herramienta y su resultado) y
// responde con `end_turn`. Así la app recorre su camino real de punta a punta:
// hub → log de eventos en SQLite → IPC → store → transcripción del renderer.
//
// Cuántos eventos emite: `FAKE_ACP_EVENTS` (por defecto 2500) o, si el texto del
// prompt contiene `events=<n>`, ese número; `kind=text|tools|mixed` elige el tipo. No toca el disco ni la red.
//
// multi-repo-rail (5.2): si el texto del prompt contiene `permission`, antes de
// terminar el turno manda una petición `session/request_permission` real y no
// contesta el prompt hasta que llega su respuesta (o su error). Así el hub la
// aparca como decisión pendiente (`pendingInteractions`) igual que un agente
// de verdad, y el renderer puede avisar de ella con el nombre del repo.

import readline from 'node:readline'

const DEFAULT_EVENTS = Number(process.env.FAKE_ACP_EVENTS) || 2500

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
const reply = (id, result) => send({ id, result })

/**
 * Una ráfaga de n actualizaciones. kind=mixed (por defecto): texto y, cada 10, una
 * llamada a herramienta con su resultado; kind=text: solo trozos de la respuesta;
 * kind=tools: solo llamadas a herramienta.
 */
function burst(sessionId, n, kind = 'mixed') {
  let sent = 0
  const push = (update) => {
    send({ method: 'session/update', params: { sessionId, update } })
    sent++
  }
  const tool = (i) => {
    const toolCallId = `tool-${i}`
    push({
      sessionUpdate: 'tool_call',
      toolCallId,
      title: `Read src/file-${i}.ts`,
      kind: 'read',
      status: 'in_progress'
    })
    if (sent < n) {
      push({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: `contenido ${i}` } }]
      })
    }
  }
  const text = (i) =>
    push({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `Fragmento ${i} de la respuesta de prueba. ` }
    })
  for (let i = 0; sent < n; i++) {
    if (kind === 'tools' || (kind === 'mixed' && i % 10 === 5)) tool(i)
    else text(i)
  }
  return sent
}

const rl = readline.createInterface({ input: process.stdin })

/** Respuestas pendientes de nuestras peticiones (permission): id → continuación. */
const awaiting = new Map()
let nextReqId = 1

/**
 * Pide un permiso como un agente real (multi-repo-rail 5.2): `session/request_permission`
 * con una llamada de herramienta de edición y las opciones allow/reject. La respuesta
 * (o el error) del cliente despierta la continuación del turno.
 */
function askPermission(sessionId, onAnswered) {
  const id = `perm-${nextReqId++}`
  awaiting.set(id, onAnswered)
  send({
    id,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: {
        toolCallId: `tool-${id}`,
        title: 'Edit openspec/changes/proposal.md',
        kind: 'edit',
        status: 'in_progress',
        locations: [{ path: 'openspec/changes/proposal.md', line: 1 }]
      },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' }
      ]
    }
  })
}

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  // respuesta (o error) a una petición nuestra: despierta el turno que esperaba
  if (msg.method === undefined && msg.id !== undefined && awaiting.has(msg.id)) {
    const done = awaiting.get(msg.id)
    awaiting.delete(msg.id)
    done(msg.error ? `error: ${msg.error.message}` : 'answered')
    return
  }
  switch (msg.method) {
    case 'initialize':
      reply(msg.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
      break
    case 'session/new':
      reply(msg.id, { sessionId: 'fake-session-1' })
      break
    case 'session/prompt': {
      const text = (msg.params?.prompt ?? []).map((p) => p.text ?? '').join(' ')
      const n = Number(/events=(\d+)/.exec(text)?.[1]) || DEFAULT_EVENTS
      const finish = () => {
        burst(msg.params.sessionId, n, /kind=(w+)/.exec(text)?.[1])
        reply(msg.id, { stopReason: 'end_turn' })
      }
      if (/\bpermission\b/i.test(text)) askPermission(msg.params.sessionId, finish)
      else finish()
      break
    }
    default:
      // notificaciones (session/cancel…) no se contestan; peticiones desconocidas, error estándar
      if (msg.id !== undefined)
        send({ id: msg.id, error: { code: -32601, message: 'no soportado' } })
  }
})
rl.on('close', () => process.exit(0))

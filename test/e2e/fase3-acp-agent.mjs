// Agente ACP falso para la verificación de la Fase 3 (tareas 3.11 y 1.11 del
// cambio migrate-to-electron-desktop): igual que fake-acp-agent.mjs habla ACP
// por stdin/stdout, pero además hace trabajo REAL en el repo (su cwd):
//
//   /opsx:propose <texto>  → crea openspec/changes/add-hello-endpoint/ con
//                            proposal.md, design.md, tasks.md, specs/greeting/spec.md
//                            y .openspec.yaml (formato que `openspec validate` aprueba)
//   /opsx:update <cambio>  → ronda de revisión: edita proposal.md (añade una
//                            sección) y responde con el bloque ```review-result
//                            que parsea el core (veredictos por id de comentario)
//   /opsx:apply <cambio>   → «construye»: escribe src/routes/hello.js y
//                            test/hello.test.js, registra la ruta en src/app.js
//                            y marca todas las tareas de tasks.md como [x]
//   /opsx:archive <cambio> → ejecuta el CLI real `openspec archive <cambio> -y
//                            --json` en el repo
//
// Así el recorrido del Walkthrough deja artefactos, diffs, ramas y commits de
// verdad, sin depender de un agente con modelo. No abre puertos ni toca la red.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawnSync } from 'node:child_process'

const CHANGE = 'add-hello-endpoint'
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
const reply = (id, result) => send({ id, result })

/** Notificación session/update */
const update = (sessionId, u) =>
  send({ method: 'session/update', params: { sessionId, update: u } })
const say = (sessionId, text) =>
  update(sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text }
  })
/** Tarjeta de herramienta en curso + completada (como las envía un agente real) */
function tool(sessionId, toolCallId, title, resultText) {
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId,
    title,
    kind: title.startsWith('openspec') ? 'execute' : 'edit',
    status: 'in_progress'
  })
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: resultText } }]
  })
}

// ---- artefactos del cambio (mismo formato que scripts/demo-repo-files.mjs) ----

const artifacts = (today) => ({
  '.openspec.yaml': `schema: spec-driven\ncreated: ${today}\n`,
  'proposal.md': `# Proposal: Add hello endpoint

## Why
Clients need a cheap greeting call that also proves routing works end to end.

## What Changes
- Add \`GET /api/v1/helloworld\` returning a JSON greeting.
- Log every call at debug level.

## Capabilities
### New Capabilities
- \`greeting\`: a hello endpoint for clients.

## Impact
- New file \`src/routes/hello.js\`, one new entry in the route table in \`src/app.js\`, a new test.
`,
  'design.md': `# Design

## Context
The app is a zero-dependency Node HTTP server. \`src/app.js\` holds a route table that maps
\`"METHOD /path"\` to a handler returning \`{ status, body }\`; tests use \`node:test\` and \`fetch\`.

## Decisions
- One handler module per route, like \`src/routes/health.js\`.
- Return \`{ "message": "Hello" }\` with status 200.
- Log each call with \`console.debug\`, so normal runs stay quiet.
`,
  'specs/greeting/spec.md': `## ADDED Requirements
### Requirement: Hello endpoint
The service SHALL expose \`GET /api/v1/helloworld\`, answering with status 200 and \`{ "message": "Hello" }\`.

#### Scenario: call the endpoint
- **WHEN** a client calls \`GET /api/v1/helloworld\`
- **THEN** it receives status 200 and \`{ "message": "Hello" }\`
`,
  'tasks.md': `## 1. Implementation
- [ ] 1.1 Add the handler in \`src/routes/hello.js\` (returns the greeting, logs the call with \`console.debug\`)
- [ ] 1.2 Register \`GET /api/v1/helloworld\` in the route table in \`src/app.js\`
- [ ] 1.3 Add \`test/hello.test.js\` checking the status and body; \`npm test\` passes
`
})

// ---- acciones ----------------------------------------------------------------

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function propose(sessionId, text) {
  const dir = path.join('openspec', 'changes', CHANGE)
  say(sessionId, `Drafting the OpenSpec change from: "${text}".\n`)
  let n = 0
  for (const [rel, content] of Object.entries(artifacts(new Date().toISOString().slice(0, 10)))) {
    write(path.join(dir, rel), content)
    tool(sessionId, `w${n++}`, `Write openspec/changes/${CHANGE}/${rel}`, `${content.length} bytes`)
  }
  say(
    sessionId,
    `Change ${CHANGE} is ready for review: proposal, design, tasks and the greeting spec delta.\n`
  )
  return { stopReason: 'end_turn' }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function revise(sessionId, prompt) {
  // los ids de los comentarios vienen en líneas "- id: <id>"
  const ids = [...prompt.matchAll(/^- id: (\S+)$/gm)].map((m) => m[1])
  const file = path.join('openspec', 'changes', CHANGE, 'proposal.md')
  const before = fs.readFileSync(file, 'utf8')
  const after =
    before.trimEnd() +
    `

## Alternatives considered

- Serving the greeting from the health handler: rejected, the capabilities stay separate.
- A text/plain body: rejected, clients expect JSON everywhere else.
`
  write(file, after)
  tool(sessionId, 'r0', `Edit openspec/changes/${CHANGE}/proposal.md`, '1 section added')
  say(sessionId, `Revised ${CHANGE}: every feedback item was applied to the proposal.\n`)
  if (ids.length)
    say(
      sessionId,
      `\n\`\`\`review-result\n${JSON.stringify(
        ids.map((id) => ({
          id,
          status: 'addressed',
          note: 'Applied to proposal.md (section "Alternatives considered").'
        }))
      )}\n\`\`\`\n`
    )
  return { stopReason: 'end_turn' }
}

function apply(sessionId) {
  const root = process.cwd()
  write(
    path.join(root, 'src/routes/hello.js'),
    `export function hello() {
  console.debug('GET /api/v1/helloworld');
  return { status: 200, body: { message: 'Hello' } };
}
`
  )
  tool(sessionId, 'b0', 'Write src/routes/hello.js', 'handler written')
  const appFile = path.join(root, 'src', 'app.js')
  const app = fs.readFileSync(appFile, 'utf8')
  write(
    appFile,
    app
      .replace(
        "import { health } from './routes/health.js';",
        "import { health } from './routes/health.js';\nimport { hello } from './routes/hello.js';"
      )
      .replace(
        "'GET /api/health': health,",
        "'GET /api/health': health,\n  'GET /api/v1/helloworld': hello,"
      )
  )
  tool(sessionId, 'b1', 'Edit src/app.js', 'route registered')
  write(
    path.join(root, 'test/hello.test.js'),
    `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET /api/v1/helloworld greets', async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(\`http://localhost:\${port}/api/v1/helloworld\`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { message: 'Hello' });
  server.close();
});
`
  )
  tool(sessionId, 'b2', 'Write test/hello.test.js', 'test written')
  const tasks = path.join(root, 'openspec', 'changes', CHANGE, 'tasks.md')
  write(tasks, fs.readFileSync(tasks, 'utf8').replaceAll('- [ ]', '- [x]'))
  tool(sessionId, 'b3', `Edit openspec/changes/${CHANGE}/tasks.md`, '3/3 tasks done')
  say(sessionId, `Built ${CHANGE}: handler, route, test; every task in tasks.md is checked.\n`)
  return { stopReason: 'end_turn' }
}

function archive(sessionId) {
  // el CLI real: mueve el cambio a changes/archive/ y fusiona los specs
  // en Windows `openspec` es un shim .cmd: sin shell, spawnSync no lo encuentra
  const r = spawnSync('openspec', ['archive', CHANGE, '-y', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 60_000,
    shell: process.platform === 'win32'
  })
  const out = (r.stdout || r.stderr || r.error?.message || '').trim()
  tool(sessionId, 'a0', `openspec archive ${CHANGE} -y`, out.slice(0, 400) || '(sin salida)')
  say(
    sessionId,
    r.status === 0
      ? `Archived ${CHANGE} with the real \`openspec archive\` CLI.\n`
      : `openspec archive exited with ${r.status}: ${out.slice(0, 200)}\n`
  )
  return { stopReason: 'end_turn' }
}

// ---- bucle JSON-RPC ------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  switch (msg.method) {
    case 'initialize':
      reply(msg.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
      break
    case 'session/new':
      reply(msg.id, { sessionId: 'fase3-session-1' })
      break
    case 'session/load':
      reply(msg.id, { sessionId: msg.params?.sessionId ?? 'fase3-session-1' })
      break
    case 'session/prompt': {
      const text = (msg.params?.prompt ?? []).map((p) => p.text ?? '').join(' ')
      const sid = msg.params.sessionId
      // el turno dura lo suficiente para que la UI lo vea busy (la prueba de
      // puertos saca la foto del árbol justo en ese momento)
      sleep(1500)
      let r
      if (/^\/opsx:propose\b/.test(text)) r = propose(sid, text.replace(/^\/opsx:propose\s*/, ''))
      else if (/^\/opsx:update\b/.test(text)) r = revise(sid, text)
      else if (/^\/opsx:apply\b/.test(text)) r = apply(sid)
      else if (/^\/opsx:archive\b/.test(text)) r = archive(sid)
      else {
        say(sid, `(agente falso) prompt sin acción reconocida: ${text.slice(0, 80)}\n`)
        r = { stopReason: 'end_turn' }
      }
      reply(msg.id, r)
      break
    }
    default:
      if (msg.id !== undefined)
        send({ id: msg.id, error: { code: -32601, message: 'no soportado' } })
  }
})
rl.on('close', () => process.exit(0))

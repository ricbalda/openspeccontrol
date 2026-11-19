// fase4-ui.mjs (tarea 4.9): la parte de UI web de 4.7 (caída del renderer) con el
// CLI agent-browser, sesión `fase4v`, conectado al CDP 9302 de la app real:
//
//   npx electron-vite build
//   node test/e2e/fase4-ui.mjs
//
// Flujo: un turno completo (~80 eventos de transcript) + un turno que espera un
// permiso (busy) → se abre la sesión en la UI y se captura → Page.crash → el
// diálogo nativo «Recargar» se acepta con UIA → agent-browser comprueba que la UI
// recargada vuelve a mostrar el transcript y la decisión pendiente (replay).
// Capturas en test/e2e/captures/fase4-ui-*.png; evidencia en fase4-ui-evidencia.json.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  EVIDENCE,
  PORT,
  ROOT,
  busyAgent,
  cleanSandbox,
  createDemoRepo,
  makeEvidence,
  makeSandbox,
  sleep,
  startApp,
  uia,
  waitFor,
  win
} from './fase4-lib.mjs'

const SESSION = 'fase4v'
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/** Ejecuta `agent-browser --session fase4v <args>` y devuelve stdout (error si falla). */
function ab(...args) {
  const r = spawnSync('agent-browser', ['--session', SESSION, ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 60_000
  })
  if (r.status !== 0)
    throw new Error(`agent-browser ${args.join(' ')} falló: ${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

/** Ref @eN de la línea del snapshot que casa con el patrón. */
function refOf(snapshot, re) {
  const line = snapshot.split('\n').find((l) => re.test(l))
  const m = line && /\[ref=(e\d+)\]/.exec(line)
  if (!m) throw new Error(`sin elemento ${re} en el snapshot`)
  return `@${m[1]}`
}

async function main() {
  assert(
    fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js')),
    'falta out/: electron-vite build'
  )
  const sb = makeSandbox('osc-fase4u-')
  createDemoRepo(sb)
  fs.writeFileSync(
    path.join(sb.data, 'agents.json'),
    JSON.stringify([
      {
        id: 'fake',
        label: 'Agente falso',
        cmd: process.execPath,
        args: [path.join(ROOT, 'test', 'e2e', 'fake-acp-agent.mjs')]
      }
    ])
  )
  const ev = makeEvidence(path.join(EVIDENCE, 'fase4-ui-evidencia.json'))
  let ctx = null
  try {
    ctx = await startApp(sb, ev, 'ui')
    const pid = ctx.app.child.pid
    const repo = await busyAgent(ctx.cdp, ev, 'ui', { transcriptFirst: true })

    // se abre el repo desde la UI, como lo haría una persona: selector de
    // repositorio → «hello-app»
    ab('connect', String(PORT))
    ab('click', refOf(ab('snapshot', '-i'), /button "Repository Choose a repo"/))
    ab('click', refOf(ab('snapshot', '-i'), /button "hello-app OpenSpec"/))
    const textBefore = await waitFor('transcript en la UI', () => {
      const t = ab('eval', 'document.body.innerText')
      return /turno de prueba/.test(t) ? t : null
    })
    assert(repo, 'repo')
    ab('screenshot', path.join(EVIDENCE, 'fase4-ui-1-antes-de-la-caida.png'))
    ev.add('UI antes de la caída', {
      mencionaElTurno: /turno de prueba/.test(textBefore),
      caracteres: textBefore.length
    })

    // caída + recarga por el diálogo nativo
    await ctx.cdp.crashRenderer()
    const dlg = uia('click-dialog', {
      AppPid: pid,
      Title: 'Recargar OpenSpecControl',
      Button: 'Recargar',
      TimeoutSec: 25
    })
    ev.add('diálogo de recarga', dlg)
    assert(dlg.found, 'no apareció el diálogo de recarga')

    await sleep(1500)
    ab('connect', String(PORT)) // la página es nueva tras la recarga
    // el repo abierto persiste en localStorage: la UI lo reabre y el replay
    // devuelve el transcript sin tocar nada
    const textAfter = await waitFor('transcript tras recargar', () => {
      const t = ab('eval', 'document.body.innerText')
      return /turno de prueba/.test(t) ? t : null
    })
    ab('screenshot', path.join(EVIDENCE, 'fase4-ui-2-tras-recargar.png'))
    assert(
      /turno de prueba/.test(textAfter),
      'tras recargar la UI no vuelve a mostrar el transcript del turno'
    )
    ev.add('UI tras recargar', {
      mencionaElTurno: /turno de prueba/.test(textAfter),
      caracteres: textAfter.length,
      muestra: textAfter.slice(0, 300)
    })
    ab('close')

    win('close', { AppPid: pid })
    const dlgClose = uia('click-dialog', {
      AppPid: pid,
      Title: 'Cerrar OpenSpecControl',
      Button: 'Cerrar igual',
      TimeoutSec: 20
    })
    ev.add('cierre final', { dialogo: dlgClose.found })
  } finally {
    try {
      ab('close')
    } catch {
      /* ya cerrada */
    }
    if (ctx && ctx.app.child.exitCode === null) {
      await sleep(3000)
      if (ctx.app.child.exitCode === null) {
        spawnSync('taskkill', ['/pid', String(ctx.app.child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
    }
    await sleep(1200)
    cleanSandbox(sb)
  }
  ev.write()
  console.log(`\n[fase4] OK: ${ev.data.steps.length} pasos registrados`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[fase4] FALLA: ${e instanceof Error ? e.stack : e}`)
    process.exit(1)
  }
)

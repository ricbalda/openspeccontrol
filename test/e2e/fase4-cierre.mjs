// fase4-cierre.mjs (tarea 4.9): verificación con evidencia del cierre seguro
// (4.4) y de la caída del renderer (4.7) sobre la app real en Windows, con el
// agente ACP falso (test/e2e/fake-acp-agent.mjs) declarado en agents.json.
//
//   npx electron-vite build          # una vez
//   node test/e2e/fase4-cierre.mjs
//
// Cubre, con evidencia (JSON en test/e2e/captures/fase4-cierre-evidencia.json):
//   4.4  con un turno en curso (busy + pendingInteractions>0), cerrar la ventana
//        muestra el diálogo nativo y la app NO sale hasta decidir:
//        · «Cancelar»: la app, la ventana y el proceso del agente siguen vivos
//        · «Cerrar igual»: salida 0 y NINGÚN proceso huérfano (árbol completo
//          comparado antes/después con CIM; el -wal desaparece → checkpoint)
//        · lo mismo por el camino menú Archivo → Salir (role quit = app.quit() →
//          before-quit), disparado por el inspector del proceso principal
//   4.7  Page.crash sobre la página: motivo registrado en el log del main,
//        diálogo nativo «¿Recargar la ventana?», y tras Recargar la sesión
//        re-suscribe y el replay devuelve el transcript (eventos contados por
//        la API window.osc; la comprobación visual de la UI la hace
//        fase4-ui.mjs con agent-browser, sesión fase4v)
//
// Puerto CDP 9302 (asignado a esta tarea). Sandbox temporal propio.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  EVIDENCE,
  MAIN_APP,
  ROOT,
  busyAgent,
  cleanSandbox,
  createDemoRepo,
  mainEval,
  makeEvidence,
  makeSandbox,
  sleep,
  startApp,
  uia,
  waitFor,
  win
} from './fase4-lib.mjs'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

function waitExit(child, timeoutMs = 30_000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('tiempo agotado esperando la salida')), timeoutMs)
    child.once('exit', (c, s) => {
      clearTimeout(t)
      res(c ?? s)
    })
  })
}

/** Estado de los archivos de la base (checkpoint del WAL al cerrar). */
const dbFiles = (sb) =>
  Object.fromEntries(
    ['openspeccontrol.db', 'openspeccontrol.db-wal', 'openspeccontrol.db-shm'].map((f) => {
      const p = path.join(sb.data, f)
      return [f, fs.existsSync(p) ? fs.statSync(p).size : null]
    })
  )

/** Procesos del árbol de la app + proceso del agente (node.exe hijo). */
function snapshotTree(pid, ev, label) {
  const tree = win('tree', { AppPid: pid })
  const agent = tree.filter((p) => /node|cmd|powershell/i.test(p.name))
  ev.add(`${label}: árbol de procesos`, {
    pid,
    total: tree.length,
    procesos: tree.map((p) => `${p.pid} ${p.name}`)
  })
  return { tree, agentPids: agent.map((p) => p.pid) }
}

/** Espera a que todos los pids dados desaparezcan (sin huérfanos). */
async function waitPidsGone(pids, timeoutMs = 20_000) {
  const alive = () => pids.filter((p) => win('info', { AppPid: p }).exists)
  await waitFor('procesos huérfanos fuera', () => (alive().length === 0 ? true : null), {
    timeoutMs,
    intervalMs: 400
  })
  return alive()
}

async function main() {
  assert(
    fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js')),
    'falta out/main/index.js: ejecuta `npx electron-vite build` antes'
  )
  const sb = makeSandbox('osc-fase4c-')
  createDemoRepo(sb)
  // el agente falso, como en perf.mjs/multi-repo.mjs: el hub lo arranca igual
  // que a uno real
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
  console.log(`[fase4] sandbox ${sb.tmp}\n[fase4] agente falso: ${process.execPath}`)
  const ev = makeEvidence(path.join(EVIDENCE, 'fase4-cierre-evidencia.json'))
  let ctx = null // { app, cdp }

  try {
    // ================= 4.4 · rama Cancelar ==================================
    ctx = await startApp(sb, ev, 'cerrar-1')
    const pid1 = ctx.app.child.pid
    await busyAgent(ctx.cdp, ev, 'cerrar-1')
    const snap1 = snapshotTree(pid1, ev, 'cerrar-1 antes del cierre')
    ev.add('4.4 db antes de cerrar', dbFiles(sb))
    assert(snap1.agentPids.length >= 1, 'no se ve el proceso del agente falso en el árbol')

    win('close', { AppPid: pid1 }) // como pulsar la X
    await sleep(1500) // la app NO debe salir mientras el diálogo está abierto
    assert(win('info', { AppPid: pid1 }).exists, 'la app salió sin esperar la decisión')
    const dlgCancel = uia('click-dialog', {
      AppPid: pid1,
      Title: 'Cerrar OpenSpecControl',
      Button: 'Cancelar',
      TimeoutSec: 20
    })
    ev.add('4.4 diálogo nativo (Cancelar)', dlgCancel)
    assert(dlgCancel.found, 'no apareció el diálogo de cierre seguro')
    assert(
      dlgCancel.buttons && dlgCancel.buttons.includes('Cerrar igual'),
      `botones inesperados: ${JSON.stringify(dlgCancel.buttons)}`
    )
    await sleep(1000)
    const aliveAfterCancel = win('info', { AppPid: pid1 }).exists
    const mainInfo = win('info', { AppPid: pid1 })
    // el diálogo debe haberse cerrado de verdad (un clic ignorado lo dejaría
    // abierto y MainWindowHandle apuntaría a él: falso positivo de «sigue viva»)
    const dialogStillOpen = uia('dump-dialog', {
      AppPid: pid1,
      Title: 'Cerrar OpenSpecControl',
      TimeoutSec: 2
    }).found
    const visibleAfterCancel = mainInfo.visible && mainInfo.title === 'OpenSpecControl'
    const treeAfterCancel = win('tree', { AppPid: pid1 })
    ev.add('4.4 tras Cancelar', {
      appViva: aliveAfterCancel,
      dialogoSigueAbierto: dialogStillOpen,
      tituloVentana: mainInfo.title,
      ventanaVisible: visibleAfterCancel,
      procesosAntes: snap1.tree.length,
      procesosDespues: treeAfterCancel.length,
      agenteVivo: snap1.agentPids.every((p) => win('info', { AppPid: p }).exists)
    })
    assert(!dialogStillOpen, 'el diálogo sigue abierto tras pulsar Cancelar')
    assert(aliveAfterCancel && visibleAfterCancel, 'Cancelar no mantuvo la app con su ventana')
    assert(
      snap1.agentPids.every((p) => win('info', { AppPid: p }).exists),
      'el proceso del agente murió tras Cancelar'
    )

    // ================= 4.4 · rama Cerrar igual ==============================
    win('close', { AppPid: pid1 })
    const dlgClose = uia('click-dialog', {
      AppPid: pid1,
      Title: 'Cerrar OpenSpecControl',
      Button: 'Cerrar igual',
      TimeoutSec: 20
    })
    ev.add('4.4 diálogo nativo (Cerrar igual)', dlgClose)
    const exit1 = await waitExit(ctx.app.child)
    const orphans1 = await waitPidsGone([...snap1.tree.map((p) => p.pid), pid1])
    ev.add('4.4 salida tras Cerrar igual', {
      exitCode: exit1,
      pidsEsperados: [...snap1.tree.map((p) => p.pid), pid1],
      huérfanos: orphans1,
      dbDespues: dbFiles(sb)
    })
    assert(exit1 === 0, `la app salió con código ${exit1}, no 0`)
    assert(orphans1.length === 0, `procesos huérfanos: ${JSON.stringify(orphans1)}`)
    assert(
      dbFiles(sb)['openspeccontrol.db-wal'] === null,
      'el -wal sigue en disco: el checkpoint no completó'
    )
    ev.add('4.4 checkpoint del WAL', {
      antes: 'openspeccontrol.db-wal presente',
      despues: dbFiles(sb),
      nota: 'SQLite elimina -wal/-shm al cerrar la última conexión con checkpoint'
    })
    ctx = null

    // ================= 4.4 · camino menú Archivo → Salir ====================
    ctx = await startApp(sb, ev, 'menu', ['--inspect=0'])
    const pid2 = ctx.app.child.pid
    await busyAgent(ctx.cdp, ev, 'menu')
    const snap2 = snapshotTree(pid2, ev, 'menu antes de Salir')

    // Archivo → Salir es un MenuItem con role:'quit', que Electron ejecuta como
    // app.quit(). El desplegable de Chromium no se puede accionar de forma fiable
    // por UIA (sin patrones, clic sintético ignorado, teclado a merced del primer
    // plano), así que se invoca app.quit() en el proceso principal por el
    // inspector: mismo código (before-quit → diálogo), sin tocar el teclado ni el
    // ratón de la persona.
    const quitCall = await mainEval(ctx.app, `${MAIN_APP}.quit(), 'app.quit() invocado'`)
    ev.add('4.4 Archivo → Salir (role quit = app.quit())', { via: 'inspector del main', quitCall })
    const dlgMenu = uia('click-dialog', {
      AppPid: pid2,
      Title: 'Cerrar OpenSpecControl',
      Button: 'Cerrar igual',
      TimeoutSec: 20
    })
    ev.add('4.4 diálogo tras Salir del menú', { dialogo: dlgMenu })
    assert(dlgMenu.found, 'el menú Salir no llevó al diálogo de cierre seguro')
    const exit2 = await waitExit(ctx.app.child)
    const orphans2 = await waitPidsGone([...snap2.tree.map((p) => p.pid), pid2])
    ev.add('4.4 salida por el menú', { exitCode: exit2, huerfanos: orphans2, db: dbFiles(sb) })
    assert(
      exit2 === 0 && orphans2.length === 0,
      `menú Salir: exit ${exit2}, huérfanos ${JSON.stringify(orphans2)}`
    )
    ctx = null

    // ================= 4.7 · caída del renderer =============================
    ctx = await startApp(sb, ev, 'crash')
    const pid3 = ctx.app.child.pid
    const repo = await busyAgent(ctx.cdp, ev, 'crash', { transcriptFirst: true })
    const snap3 = snapshotTree(pid3, ev, 'crash antes de la caída')

    await ctx.cdp.crashRenderer() // Page.crash
    // el motivo debe quedar registrado en el log del main (console.error)
    const logged = await waitFor('motivo de la caída en el log', () =>
      /El proceso de la interfaz terminó/.test(ctx.app.log()) ? true : null
    )
    const reasonLine = ctx.app
      .log()
      .split('\n')
      .find((l) => /El proceso de la interfaz/.test(l))
    ev.add('4.7 caída del renderer', { motivo: reasonLine?.trim() })
    assert(logged, 'no se registró el motivo de la caída en el log del main')

    const dlgReload = uia('click-dialog', {
      AppPid: pid3,
      Title: 'Recargar OpenSpecControl',
      Button: 'Recargar',
      TimeoutSec: 25
    })
    ev.add('4.7 diálogo de recarga', dlgReload)
    assert(dlgReload.found, 'no apareció el diálogo de recarga tras la caída')

    // la recarga revive el renderer: la sesión (busy) y el transcript (replay)
    // se recuperan al re-suscribir
    await waitFor('página tras recargar', () =>
      ctx.cdp.eval(`document.readyState === 'complete' ? true : null`).catch(() => null)
    )
    const replay = await waitFor('replay con transcript', () =>
      ctx.cdp
        .eval(
          `(async () => {
          window.__replay = null
          const off = window.osc.onMessage((m) => { if (m.type === 'replay') window.__replay = m })
          window.osc.send({ type: 'subscribe', repo: ${JSON.stringify(repo)} })
          for (let i = 0; i < 50 && !window.__replay; i++) await new Promise((r) => setTimeout(r, 100))
          off()
          const rp = window.__replay
          if (!rp) return null
          const kinds = {}
          for (const e of rp.entries) kinds[e.event?.kind] = (kinds[e.event?.kind] ?? 0) + 1
          return { n: rp.entries.length, kinds }
        })()`
        )
        .catch(() => null)
    )
    const sessionAfter = await ctx.cdp.eval(
      `window.osc.repos().then((w) => { const s = w.repos.find((r) => r.id === ${JSON.stringify(repo)})?.session; return s && { status: s.status, pending: s.pendingInteractions } })`
    )
    ev.add('4.7 recuperación tras recargar', { replay, sessionTrasRecarga: sessionAfter })
    assert(replay && replay.n >= 80, `replay insuficiente: ${JSON.stringify(replay)}`)
    assert(
      replay.kinds && (replay.kinds['agent_message_chunk'] > 0 || replay.kinds['user'] > 0),
      'el replay no contiene el transcript del turno'
    )
    assert(
      sessionAfter && sessionAfter.status === 'busy' && sessionAfter.pending === 1,
      `la sesión no se recuperó: ${JSON.stringify(sessionAfter)}`
    )

    // cierre final con el agente aún busy (mismo camino ya verificado)
    win('close', { AppPid: pid3 })
    const dlgFinal = uia('click-dialog', {
      AppPid: pid3,
      Title: 'Cerrar OpenSpecControl',
      Button: 'Cerrar igual',
      TimeoutSec: 20
    })
    const exit3 = await waitExit(ctx.app.child)
    const orphans3 = await waitPidsGone([...snap3.tree.map((p) => p.pid), pid3])
    ev.add('4.7 cierre final', {
      dialogo: dlgFinal.found,
      exitCode: exit3,
      huerfanos: orphans3,
      db: dbFiles(sb)
    })
    assert(
      exit3 === 0 && orphans3.length === 0,
      `cierre final: exit ${exit3}, huérfanos ${JSON.stringify(orphans3)}`
    )
    ctx = null
  } catch (e) {
    if (ctx) console.error(`[fase4] log de Electron:\n${ctx.app.log().trim().slice(-3000)}`)
    throw e
  } finally {
    if (ctx && ctx.app.child.exitCode === null) {
      win('close', { AppPid: ctx.app.child.pid })
      await sleep(2500)
      if (ctx.app.child.exitCode === null) {
        spawnSync('taskkill', ['/pid', String(ctx.app.child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
    }
    await sleep(1200)
    cleanSandbox(sb)
  }

  ev.write()
  console.log(`\n[fase4] OK: ${ev.data.steps.length} pasos registrados`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[fase4] FALLA: ${e instanceof Error ? e.stack : e}`)
    process.exit(1)
  }
)

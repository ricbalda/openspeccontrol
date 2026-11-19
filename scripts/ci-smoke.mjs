// Fase 10 (tarea 10.2): arranque de prueba para la CI.
//
//   node scripts/ci-smoke.mjs        # requiere `electron-vite build` previo (out/)
//   xvfb-run -a node scripts/ci-smoke.mjs   # en Linux sin pantalla
//
// Lanza la app (`electron .`) con `--remote-debugging-port`, se conecta por el
// protocolo Chrome DevTools y comprueba que (1) existe `#root` con contenido
// renderizado y (2) no hay errores de consola ni excepciones. Sale con código 1
// si la app no carga, se cae o muestra errores; con 0 si carga limpia.
//
// El puerto de depuración se usa SOLO dentro del workflow de CI (.github/workflows/ci.yml):
// el binario de desarrollo no lo expone nunca y el paquete final tiene los fuses
// de inspección desactivados (Fase 7). Usa un directorio de datos y un perfil
// temporales para no tocar `~/.openspeccontrol` ni chocar con otra instancia.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describeConsoleError, pickPageTarget, ROOT_PROBE, smokeVerdict } from './ci-smoke-lib.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** ms que se espera a que la app abra su ventana y pinte #root */
const LOAD_TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS) || 60_000
/** ms que se siguen escuchando errores tras ver #root, para no perder los tardíos */
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS) || 3_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Pide al SO un puerto libre (el workflow no depende de uno fijo). */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Cierra el árbol de procesos de Electron (la app lanza varios helpers). */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL') // grupo propio (spawn con detached)
    } catch {
      child.kill('SIGKILL')
    }
  }
}

async function main() {
  if (!fs.existsSync(path.join(root, 'out', 'main', 'index.js'))) {
    throw new Error('falta out/main/index.js: ejecuta `npx electron-vite build` antes del arranque')
  }
  const electron = require('electron') // en Node, el paquete exporta la ruta del binario
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-smoke-'))
  const port = await freePort()
  const args = [
    '.',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${path.join(tmp, 'profile')}`
  ]
  // En runners Linux el sandbox SUID de Chromium no está configurado (y en Ubuntu
  // 24.04 AppArmor limita los user namespaces): sin esto Electron aborta al arrancar.
  // Solo afecta a este arranque de prueba, no a la app empaquetada.
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu')

  const env = { ...process.env, OSC_DATA: path.join(tmp, 'data') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.REPOS_ROOT

  console.log(`[smoke] electron ${args.join(' ')}`)
  const child = spawn(electron, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  })
  let log = ''
  const keep = (d) => {
    log = (log + d).slice(-4000)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let exited = null
  child.once('exit', (code, signal) => {
    exited = `código ${code ?? signal}`
  })

  const errors = []
  let probe = null
  let ws = null
  try {
    const deadline = Date.now() + LOAD_TIMEOUT
    const fail = (msg) => {
      throw new Error(msg)
    }

    // 1) esperar a que aparezca la página de la app en /json/list
    let target = null
    while (!target) {
      if (exited) fail(`Electron terminó antes de abrir la ventana (${exited})`)
      if (Date.now() > deadline) fail('tiempo agotado esperando la ventana de la app')
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`)
        target = pickPageTarget(await res.json())
      } catch {
        /* el puerto de depuración aún no escucha */
      }
      if (!target) await sleep(500)
    }

    // 2) conectar por CDP y empezar a recoger errores (Runtime/Log reenvían lo ya ocurrido)
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('no se pudo abrir el WebSocket CDP')), {
        once: true
      })
    })
    let nextId = 0
    const pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id !== undefined) {
        pending.get(msg.id)?.(msg)
        pending.delete(msg.id)
        return
      }
      const found = describeConsoleError(msg)
      if (found) errors.push(found)
    })
    // si la ventana se cierra, las peticiones en vuelo no deben quedarse colgadas
    ws.addEventListener('close', () => {
      for (const done of pending.values()) done({ error: { message: 'WebSocket CDP cerrado' } })
      pending.clear()
    })
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++nextId
        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
      })
    await send('Runtime.enable')
    await send('Log.enable')

    // 3) esperar a que #root exista y tenga contenido
    for (;;) {
      if (exited) fail(`Electron terminó durante la prueba (${exited})`)
      const r = await send('Runtime.evaluate', { expression: ROOT_PROBE, returnByValue: true })
      probe = r.result?.result?.value ?? null
      if (probe?.present && probe.children > 0) break
      if (Date.now() > deadline) break // el veredicto explica qué faltó
      await sleep(500)
    }
    await sleep(SETTLE_MS)
    if (exited) errors.push(`Electron terminó durante la prueba (${exited})`)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  } finally {
    try {
      ws?.close()
    } catch {
      /* ya cerrado */
    }
    killTree(child)
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  const { ok, problems } = smokeVerdict({ probe, errors })
  if (ok) {
    console.log(`[smoke] OK: #root con ${probe.children} hijo(s) y sin errores de consola`)
    return 0
  }
  console.error('[smoke] FALLA:')
  for (const p of problems) console.error(`  - ${p}`)
  if (log.trim()) console.error(`[smoke] últimas líneas de Electron:\n${log.trim()}`)
  // anotación visible en el resumen del workflow de GitHub Actions
  if (process.env.GITHUB_ACTIONS) {
    console.error(`::error title=Arranque de prueba::${problems.join(' | ').replace(/\n/g, ' ')}`)
  }
  return 1
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[smoke] FALLA: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
)

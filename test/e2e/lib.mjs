// Fase 11 (tareas 11.3 y 11.5): utilidades compartidas por los scripts E2E
// (`smoke.mjs`) y de rendimiento (`perf.mjs`).
//
// Lanzan la app real (`electron .` sobre `out/`, tras `npx electron-vite build`)
// con `--remote-debugging-port`, y la manejan con el CLI `agent-browser` por CDP.
// El puerto de depuración se usa SOLO aquí: el binario empaquetado tiene los
// fuses de inspección desactivados (Fase 7) y el de desarrollo no lo expone.
//
// Aislamiento: cada ejecución crea un directorio temporal con
//   repos/    → REPOS_ROOT (repos de demo)
//   data/     → OSC_DATA (db, config.json, agents.json de la app)
//   home/     → HOME y USERPROFILE: la app importa en lectura el
//               ~/.openspec-studio del usuario si existe (Fase 2); sin esto, el
//               E2E vería los repos reales de quien lo ejecuta
//   profile/  → --user-data-dir de Electron
// y lo borra al terminar (salvo KEEP_TMP=1).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CDP_PORT = Number(process.env.CDP_PORT) || 9222
const AGENT_BROWSER = process.env.AGENT_BROWSER_BIN || 'agent-browser'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Directorio temporal aislado con la estructura descrita arriba. */
export function makeSandbox(prefix = 'osc-e2e-') {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const sb = {
    tmp,
    repos: path.join(tmp, 'repos'),
    data: path.join(tmp, 'data'),
    home: path.join(tmp, 'home'),
    profile: path.join(tmp, 'profile')
  }
  for (const d of [sb.repos, sb.data, sb.home]) fs.mkdirSync(d, { recursive: true })
  return sb
}

export function cleanSandbox(sb) {
  if (process.env.KEEP_TMP === '1') {
    console.log(`[e2e] KEEP_TMP=1: se conserva ${sb.tmp}`)
    return
  }
  try {
    fs.rmSync(sb.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch (e) {
    console.warn(`[e2e] no se pudo borrar ${sb.tmp}: ${e.message}`)
  }
}

/** Crea `hello-app` (repo de demo con el cambio `add-hello-endpoint`) en `sb.repos`. */
export function createDemoRepo(sb) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'demo-repo.mjs'), sb.repos], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error(`demo-repo.mjs falló: ${r.stderr || r.stdout}`)
  return path.join(sb.repos, 'hello-app')
}

/** Cierra el árbol de procesos de Electron (la app lanza varios helpers). */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/**
 * Lanza `electron . --remote-debugging-port=<port>` y espera a que el puerto
 * CDP responda con una página de la app. `env` se suma al entorno aislado.
 */
export async function launchApp(sb, { port = CDP_PORT, env = {}, timeoutMs = 60_000 } = {}) {
  if (!fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js'))) {
    throw new Error('falta out/main/index.js: ejecuta `npx electron-vite build` antes')
  }
  const electron = require('electron') // en Node, el paquete exporta la ruta del binario
  const args = [
    '.',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${sb.profile}`
  ]
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu')
  const childEnv = {
    ...process.env,
    REPOS_ROOT: sb.repos,
    OSC_DATA: sb.data,
    HOME: sb.home,
    USERPROFILE: sb.home,
    OSC_NO_UPDATE_CHECK: '1',
    ...env
  }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, args, {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  })
  let log = ''
  const keep = (d) => {
    log = (log + d).slice(-6000)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let exited = null
  child.once('exit', (code, signal) => {
    exited = `código ${code ?? signal}`
  })

  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (exited) throw new Error(`Electron terminó antes de abrir la ventana (${exited})\n${log}`)
    if (Date.now() > deadline) throw new Error('tiempo agotado esperando el puerto CDP')
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await res.json()
      if (targets.some((t) => t.type === 'page' && String(t.url).includes('index.html'))) break
    } catch {
      /* el puerto aún no escucha */
    }
    await sleep(400)
  }
  return {
    child,
    port,
    log: () => log,
    stop: () => killTree(child)
  }
}

/** Entrecomilla un argumento para el shell de Windows (agent-browser es un shim .cmd). */
const quote = (a) => (/^[\w./:=@,+-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`)

/**
 * Driver de agent-browser: cada método ejecuta un comando del CLI contra la
 * sesión propia de esta ejecución (nunca la sesión compartida por defecto).
 */
export function createDriver(session = `osc-fase11-${process.pid}`) {
  const run = (args, { input, allowFail = false } = {}) => {
    const full = ['--session', session, '--json', ...args]
    const opts = { cwd: ROOT, encoding: 'utf8', input, timeout: 90_000 }
    // en Windows agent-browser es un shim .cmd: va por el shell, con la línea ya entrecomillada
    const r =
      process.platform === 'win32'
        ? spawnSync([AGENT_BROWSER, ...full.map(quote)].join(' '), { ...opts, shell: true })
        : spawnSync(AGENT_BROWSER, full, opts)
    let parsed = null
    try {
      parsed = JSON.parse(r.stdout.trim().split('\n').pop())
    } catch {
      /* salida no JSON */
    }
    if (!allowFail && (r.status !== 0 || !parsed?.success)) {
      throw new Error(
        `agent-browser ${args.join(' ')} falló: ${parsed?.error ?? (r.stderr || r.stdout || r.error?.message)}`
      )
    }
    return parsed
  }
  return {
    session,
    run,
    connect: (port) => run(['connect', String(port)]),
    /** Evalúa JS en la página (admite `await`) y devuelve el valor serializable. */
    eval: (js) => run(['eval', '--stdin'], { input: js }).data.result,
    click: (sel) => run(['click', sel]),
    /** Pulsa un botón/enlace por su texto visible (semantic locator `find text`). */
    clickText: (text, { exact = false } = {}) =>
      run(['find', 'text', text, 'click', ...(exact ? ['--exact'] : [])]),
    clickRole: (role, name) => run(['find', 'role', role, 'click', '--name', name]),
    fillPlaceholder: (placeholder, value) =>
      run(['find', 'placeholder', placeholder, 'fill', value]),
    reload: () => run(['reload']),
    screenshot: (file) => run(['screenshot', file]),
    pageErrors: () => run(['errors'], { allowFail: true })?.data,
    close: () => run(['close'], { allowFail: true })
  }
}

/** Reintenta `fn` hasta que devuelva algo verdadero o se agote el tiempo. */
export async function waitFor(what, fn, { timeoutMs = 20_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) {
      last = e
    }
    if (Date.now() > deadline) {
      throw new Error(
        `tiempo agotado esperando: ${what}${last instanceof Error ? ` (${last.message})` : ''}`
      )
    }
    await sleep(intervalMs)
  }
}

/** Marca de tiempo corta para las trazas. */
export const stamp = () => new Date().toISOString().slice(11, 23)

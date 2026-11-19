// fase4-lib.mjs (tarea 4.9): utilidades de la verificación manual de la Fase 4.
//
// División del trabajo (ver INFORME-VERIF-FASE4.md): los scripts fase4-*.mjs se
// ocupan de procesos, ventanas nativas, diálogos y archivos — por CDP a nivel de
// navegador (bounds, crash) y por PowerShell (user32/UIA/CIM). Las comprobaciones
// de la UI web (DOM, clics, capturas de la página) las hace el subagente
// test-browser con agent-browser, sesión `fase4v`, sobre el mismo puerto CDP.
//
// Puerto asignado a esta tarea: 9302 (los demás workers usan los suyos).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { makeSandbox, cleanSandbox, createDemoRepo, sleep, stamp, waitFor } from './lib.mjs'

export { makeSandbox, cleanSandbox, createDemoRepo, sleep, waitFor, stamp }
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PORT = Number(process.env.CDP_PORT) || 9302
export const EVIDENCE = path.join(ROOT, 'test', 'e2e', 'captures')

const require = createRequire(import.meta.url)
const PS = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']

/** Ejecuta una acción de test/e2e/fase4-win.ps1 y devuelve su JSON. */
export function win(action, params = {}) {
  const args = [...PS, path.join(ROOT, 'test', 'e2e', 'fase4-win.ps1'), '-Action', action]
  for (const [k, v] of Object.entries(params)) if (v !== undefined) args.push(`-${k}`, String(v))
  const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 120_000 })
  if (r.status !== 0) throw new Error(`fase4-win.ps1 ${action} falló: ${r.stderr || r.stdout}`)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

/** Ejecuta una acción de test/e2e/fase4-uia.ps1 y devuelve su JSON. */
export function uia(action, params = {}) {
  const args = [...PS, path.join(ROOT, 'test', 'e2e', 'fase4-uia.ps1'), '-Action', action]
  for (const [k, v] of Object.entries(params)) if (v !== undefined) args.push(`-${k}`, String(v))
  const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 120_000 })
  if (r.status !== 0) throw new Error(`fase4-uia.ps1 ${action} falló: ${r.stderr || r.stdout}`)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

/**
 * Lanza electron (o un ejecutable empaquetado) igual que lib.launchApp pero sin
 * esperar el puerto CDP: para la segunda instancia (que debe salir sola), que no
 * recibe puerto de depuración, y para el binario empaquetado.
 */
export function spawnApp(sb, { exe, port = PORT, withCdp = true, env = {}, extraArgs = [] } = {}) {
  const bin = exe ?? require('electron')
  const args = exe
    ? [`--user-data-dir=${sb.profile}`]
    : [
        '.',
        ...(withCdp ? [`--remote-debugging-port=${port}`] : []),
        '--remote-allow-origins=*',
        `--user-data-dir=${sb.profile}`,
        ...extraArgs
      ]
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
  const child = spawn(bin, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  const keep = (d) => {
    log = (log + d).slice(-8000)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  return { child, log: () => log }
}

/**
 * Evalúa una expresión en el proceso PRINCIPAL por el inspector de Node
 * (`--inspect=0`, puerto aleatorio que Electron imprime en stderr; solo en la
 * build sin empaquetar). Sirve para ejercer rutas del main que no tienen API en
 * el renderer, como app.quit() (lo que ejecuta role:'quit' del menú Archivo →
 * Salir), sin inyectar teclado ni ratón sobre la sesión de la persona.
 */
export async function mainEval(app, expression) {
  const url = await waitFor('inspector del proceso principal', () => {
    const m = app.log().match(/ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+/)
    return m ? m[0] : null
  })
  const ws = new WebSocket(url)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('inspector del main: error de conexión'))
  })
  const out = await new Promise((res, rej) => {
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data)
      if (j.id === 1) j.error ? rej(new Error(j.error.message)) : res(j.result)
    }
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      })
    )
  })
  ws.close()
  if (out.exceptionDetails) throw new Error(`mainEval: ${out.exceptionDetails.text}`)
  return out.result?.value
}

/** `app` de Electron en el proceso principal (la misma instancia que `import { app }`). */
export const MAIN_APP = "process._linkedBinding('electron_browser_app').app"

/** CDP a nivel de navegador: bounds de ventana y crash del renderer. */
export class Cdp {
  constructor(port) {
    this.port = port
  }

  static async connect(port = PORT) {
    const c = new Cdp(port)
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    c.ws = new WebSocket(ver.webSocketDebuggerUrl)
    c.nextId = 1
    c.pending = new Map()
    await new Promise((res, rej) => {
      c.ws.onopen = res
      c.ws.onerror = (e) => rej(new Error(`CDP ws: ${e.message ?? 'error'}`))
    })
    c.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id)
        c.pending.delete(msg.id)
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`))
        else res(msg.result)
      }
    }
    return c
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    this.ws.send(JSON.stringify(msg))
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error(`CDP sin respuesta: ${method}`))
        }
      }, 30_000).unref()
    })
  }

  /** La página de la app (id del target; Electron 45 lo llama `id`, no `targetId`). */
  async pageTargetId() {
    const targets = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page' && String(t.url).includes('index.html'))
    if (!page) throw new Error('sin página index.html en CDP')
    return page.id ?? page.targetId
  }

  /** Sesión plana nueva sobre la página (tras crash/recarga hay que reattach). */
  async attachPage() {
    const { sessionId } = await this.send('Target.attachToTarget', {
      targetId: await this.pageTargetId(),
      flatten: true
    })
    return sessionId
  }

  /** Runtime.evaluate en la página (awaitPromise; devuelve el valor JS). */
  async eval(js) {
    const sessionId = await this.attachPage()
    const r = await this.send(
      'Runtime.evaluate',
      { expression: js, awaitPromise: true, returnByValue: true },
      sessionId
    )
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.text}`)
    return r.result?.value
  }

  /**
   * Geometría de la ventana en DIP leída desde la página (screenX/Y y
   * outerWidth/Height son CSS px = DIP, el mismo dominio que window-state.json).
   * Electron 45 no implementa Browser.getWindowForTarget/setWindowBounds, así
   * que esta es la lectura CDP; las acciones van por Win32 (fase4-win.ps1).
   */
  async winInfo() {
    return this.eval(
      `({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, dpr: window.devicePixelRatio })`
    )
  }

  /** Page.crash sobre la página: simula la caída del renderer (4.7). */
  async crashRenderer() {
    const sessionId = await this.attachPage()
    await this.send('Page.enable', {}, sessionId)
    // el renderer muere antes de responder: no se espera la respuesta
    this.send('Page.crash', {}, sessionId).catch(() => {})
    await sleep(300)
  }

  close() {
    this.ws?.close()
  }
}

/** Registra la evidencia de un paso: imprime y acumula para el JSON final. */
export function makeEvidence(file) {
  const data = { startedAt: new Date().toISOString(), steps: [] }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  return {
    add(step, detail = {}) {
      const entry = { step, at: new Date().toISOString(), ...detail }
      data.steps.push(entry)
      console.log(`[fase4] ${step}: ${JSON.stringify(detail).slice(0, 400)}`)
      return entry
    },
    write(extra = {}) {
      data.finishedAt = new Date().toISOString()
      fs.writeFileSync(file, JSON.stringify({ ...data, ...extra }, null, 2))
      console.log(`[fase4] evidencia en ${path.relative(ROOT, file)}`)
    },
    data
  }
}

/** Lee/escribe window-state.json del sandbox. */
export const windowStateFile = (sb) => path.join(sb.data, 'window-state.json')
export const readWindowState = (sb) => JSON.parse(fs.readFileSync(windowStateFile(sb), 'utf8'))
export const writeWindowState = (sb, state) =>
  fs.writeFileSync(windowStateFile(sb), JSON.stringify(state))

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/** Lanza la app y espera a que la ventana se muestre (ready-to-show). */
export async function startApp(sb, ev, label, extraArgs = []) {
  const app = spawnApp(sb, { port: PORT, extraArgs })
  app.child.once('exit', (c) => ev.add(`${label}: proceso salió`, { code: c }))
  await waitFor('página index.html en CDP', async () => {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      return t.some((x) => x.type === 'page' && String(x.url).includes('index.html')) || null
    } catch {
      return null
    }
  })
  const vis = win('wait-visible', { AppPid: app.child.pid, TimeoutSec: 30 })
  assert(vis.visible, `${label}: la ventana no se mostró`)
  const cdp = await Cdp.connect(PORT)
  await waitFor('página cargada', () =>
    cdp.eval(`document.readyState === 'complete' ? true : null`).catch(() => null)
  )
  return { app, cdp }
}

/** Arranca el agente falso en hello-app y deja un turno en curso. */
export async function busyAgent(cdp, ev, label, { transcriptFirst = false } = {}) {
  const repo = await cdp.eval(
    `window.osc.repos().then((w) => w.repos.find((r) => r.name === 'hello-app').id)`
  )
  assert(repo, 'no se encontró hello-app en el workspace')
  cdp.eval(`window.osc.send({ type: 'start', repo: ${JSON.stringify(repo)}, agent: 'fake' }), true`)
  await waitFor(`${label}: sesión ready`, () =>
    cdp
      .eval(
        `window.osc.repos().then((w) => w.repos.find((r) => r.id === ${JSON.stringify(repo)})?.session?.status ?? null)`
      )
      .then((s) => s === 'ready')
  )
  if (transcriptFirst) {
    // un turno que TERMINA: deja ~80 eventos de transcript en la base
    cdp.eval(
      `window.osc.send({ type: 'prompt', repo: ${JSON.stringify(repo)}, text: 'turno de prueba events=80' }), true`
    )
    await waitFor(`${label}: turno events=80 completado`, () =>
      cdp
        .eval(
          `window.osc.repos().then((w) => w.repos.find((r) => r.id === ${JSON.stringify(repo)})?.session?.status ?? null)`
        )
        .then((s) => s === 'ready')
    )
  }
  // turno que se queda esperando un permiso → busy + pendingInteractions 1
  cdp.eval(
    `window.osc.send({ type: 'prompt', repo: ${JSON.stringify(repo)}, text: 'pide permiso: permission' }), true`
  )
  const st = await waitFor(`${label}: busy con decisión pendiente`, () =>
    cdp.eval(
      `window.osc.repos().then((w) => { const s = w.repos.find((r) => r.id === ${JSON.stringify(repo)})?.session; return s && s.status === 'busy' && s.pendingInteractions === 1 ? s : null })`
    )
  )
  ev.add(`${label}: sesión en curso`, {
    repo,
    status: st.status,
    pendingInteractions: st.pendingInteractions
  })
  return repo
}

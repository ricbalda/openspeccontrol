// migrate-to-electron-desktop (tarea 1.11): lo comprobable de «Debug All» sin VS Code.
//
//   node test/e2e/fase3-debug-all.mjs     # sale 1 si algún punto falla
//
// «Debug All» = «Debug Main Process» (node/launch de electron-vite con los
// runtimeArgs y el env de .vscode/launch.json) + «Debug Renderer Process»
// (chrome/attach al puerto 9222). Aquí se reproduce el lado del servidor de esa
// conexión, que es lo que se puede medir desde un script:
//
//   A) la configuración tal cual está en launch.json
//   B) la misma + `--inspect` (inspector V8 del main en 5858)
//
// y para cada una: el puerto del renderer (REMOTE_DEBUGGING_PORT → CDP, aquí
// sustituido por 9301 para no chocar con otros workers) y el inspector del main
// (`/json/list` + `Debugger.enable` por WebSocket, con sourcemaps). Lo que NO se
// puede ver aquí: que VS Code (js-debug) se enganche de verdad al pulsar F5.
//
// Aislamiento: --user-data-dir (ELECTRON_CLI_ARGS), OSC_DATA y REPOS_ROOT temporales. NO se
// sustituye USERPROFILE: con otro, `electron-vite dev` termina con código 3 (comprobado).
// A cambio, OSC_DATA lleva ya el marcador imported-from-studio.json, para que la app no
// lea el ~/.openspec-studio real. El dev server de Vite usa 5173 (de electron-vite).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, sleep, stamp } from './lib.mjs'

const RENDERER_PORT = Number(process.env.CDP_PORT) || 9301
const INSPECT_PORT = 5858 // el que abre `--inspect` sin número (electron-vite)

/** launch.json sin comentarios (JSONC). */
function readLaunch() {
  const raw = fs.readFileSync(path.join(ROOT, '.vscode', 'launch.json'), 'utf8')
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))
}

const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(2000) })).json()
const listening = (port) => {
  const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
  return r.stdout.split('\n').filter((l) => /LISTENING/i.test(l) && l.includes(`:${port} `))
}

/** Conecta al inspector del main, `Debugger.enable` y recoge los scripts parseados. */
async function inspectMain(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('WebSocket del inspector rechazado'))
  })
  const scripts = []
  let enabled = false
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id === 1) enabled = !m.error
    if (m.method === 'Debugger.scriptParsed') scripts.push(m.params)
  }
  ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }))
  const deadline = Date.now() + 8000
  while (!enabled && Date.now() < deadline) await sleep(100)
  await sleep(1000)
  ws.close()
  return { enabled, scripts }
}

async function scenario(name, extraArgs) {
  const launch = readLaunch()
  const main = launch.configurations.find((c) => c.name === 'Debug Main Process')
  const args = [
    'dev',
    ...main.runtimeArgs,
    ...extraArgs.filter((a) => !main.runtimeArgs.includes(a))
  ]
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-fase3-dbg-')))
  const data = path.join(tmp, 'data')
  const repos = path.join(tmp, 'repos')
  fs.mkdirSync(data)
  fs.mkdirSync(repos)
  fs.writeFileSync(
    path.join(data, 'imported-from-studio.json'),
    JSON.stringify({ note: 'marcador de la prueba: evita leer el ~/.openspec-studio real' })
  )
  const env = {
    ...process.env,
    ...main.env,
    REMOTE_DEBUGGING_PORT: String(RENDERER_PORT), // la config trae 9222: otro puerto libre para no chocar
    REPOS_ROOT: repos,
    OSC_DATA: data,
    OSC_NO_UPDATE_CHECK: '1',
    // userData propio: en Windows Electron no usa APPDATA y, sin esto, el bloqueo de
    // instancia única choca con cualquier otra OpenSpecControl abierta y la app sale sola
    ELECTRON_CLI_ARGS: JSON.stringify([`--user-data-dir=${path.join(tmp, 'profile')}`])
  }
  delete env.ELECTRON_RUN_AS_NODE
  const bin = path.join(ROOT, 'node_modules', '.bin', 'electron-vite.cmd')
  const cmdline = [bin, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  console.log(
    `[${stamp()}] [${name}] ${cmdline.replace(ROOT, '.')}  (REMOTE_DEBUGGING_PORT=${RENDERER_PORT})`
  )
  const child = spawn(cmdline, { cwd: ROOT, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (d) => (log = (log + d).slice(-4000)))
  child.stderr.on('data', (d) => (log = (log + d).slice(-4000)))
  const out = { name, args: args.join(' '), renderer: null, main: null, scripts: null, mapOk: null }
  try {
    // (a) el renderer, por el puerto de REMOTE_DEBUGGING_PORT
    const deadline = Date.now() + 90_000
    for (; Date.now() < deadline; await sleep(500)) {
      try {
        const targets = await get(`http://127.0.0.1:${RENDERER_PORT}/json/list`)
        const page = targets.find(
          (t) => t.type === 'page' && /localhost|127\.0\.0\.1|index\.html/.test(t.url)
        )
        if (page) {
          out.renderer = { url: page.url, title: page.title, targets: targets.length }
          break
        }
      } catch {
        /* aún no escucha */
      }
    }
    // (b) el inspector del main
    await sleep(1500)
    out.mainPortListening = listening(INSPECT_PORT).length > 0
    if (out.mainPortListening) {
      try {
        const list = await get(`http://127.0.0.1:${INSPECT_PORT}/json/list`)
        out.main = list.map((t) => ({ type: t.type, title: t.title, url: t.url }))
        const dbg = await inspectMain(list[0].webSocketDebuggerUrl)
        const mine = dbg.scripts.filter((s) => /out[\\/]+main[\\/]/.test(s.url))
        out.scripts = {
          debuggerEnabled: dbg.enabled,
          total: dbg.scripts.length,
          appMain: mine.map((s) => s.url)
        }
        out.mapOk = mine.some((s) => s.sourceMapURL) // sourcemap anunciado por el motor
        out.mapUrls = mine.map((s) => s.sourceMapURL)
        const mapFile = path.join(ROOT, 'out', 'main', 'index.js.map')
        out.mapFile = fs.existsSync(mapFile)
        if (out.mapFile) {
          const m = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
          out.mapSources = (m.sources ?? []).filter((s) => s.includes('src/main')).length
        }
      } catch (e) {
        out.mainError = e.message
      }
    }
    return out
  } finally {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await sleep(2500)
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      /* best effort */
    }
    if (!out.renderer) console.error(`[e2e] [${name}] salida de electron-vite:\n${log}`)
  }
}

for (const p of [INSPECT_PORT, RENDERER_PORT, 5173]) {
  if (listening(p).length) {
    console.error(`[e2e] el puerto ${p} ya está ocupado: no se puede medir con limpieza`)
    process.exit(1)
  }
}
const a = await scenario('A: launch.json tal cual', [])
const b = await scenario('B: launch.json + --inspect', ['--inspect'])
for (const r of [a, b]) {
  console.log(`\n[${r.name}] electron-vite ${r.args}`)
  console.log(`  renderer (${RENDERER_PORT}):`, JSON.stringify(r.renderer))
  console.log(`  puerto del inspector del main (${INSPECT_PORT}) en LISTEN:`, r.mainPortListening)
  if (r.main) console.log('  /json/list del main:', JSON.stringify(r.main))
  if (r.scripts)
    console.log(
      '  Debugger.enable:',
      JSON.stringify(r.scripts),
      '· sourceMapURL:',
      JSON.stringify(r.mapUrls),
      '· index.js.map:',
      r.mapFile,
      `(${r.mapSources} fuentes de src/main)`
    )
  if (r.mainError) console.log('  error del inspector:', r.mainError)
}
const ok =
  Boolean(a.renderer) &&
  Boolean(b.renderer) &&
  b.mainPortListening &&
  b.scripts?.debuggerEnabled &&
  b.mapOk
console.log(`\n[e2e] ${ok ? 'OK' : 'FALLA'}`)
process.exit(ok ? 0 : 1)

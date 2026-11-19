// migrate-to-electron-desktop (tareas 3.11 y 1.11): recorrido completo del
// Walkthrough del README de Studio, como E2E reproducible con evidencia real.
//
//   npx electron-vite build                  # una vez: genera out/
//   node test/e2e/fase3-walkthrough.mjs     # sale 1 si algún paso falla
//
// Requiere `agent-browser` en el PATH, el CLI `openspec` y `git`. Lanza la app
// real (`electron . --remote-debugging-port=9301`) con sandbox temporal y:
//
//   home/repos-studio/  → repo de demo CON openspec: llega por la importación
//                         de un ~/.openspec-studio de fixture (studio.db con
//                         esquema de Studio 0.3.x, config.json, agents.json)
//   home/repos-walk/    → repo de demo SIN openspec: se añade desde la UI
//                         escribiendo `~/repos-walk` (el diálogo nativo de
//                         carpeta no es automatizable por CDP: queda sin
//                         verificar aquí) y se recorre el Walkthrough entero
//                         con el agente falso (fase3-acp-agent.mjs):
//                         inicializar (openspec init real) → conectar →
//                         proponer → comentar → enviar ronda → construir →
//                         rama → commit → archivar (openspec archive real)
//   data/               → OSC_DATA (agents.json declara el agente falso, que
//                         la importación de Studio trae de casa al sobrescribir
//                         el archivo: el fixture lo declara ya dentro)
//
// Además comprueba, con el agente conectado y trabajando, que el árbol de
// procesos de la app (main, GPU, utility, renderer, agente, openspec, git) no
// deja NINGÚN socket TCP en LISTEN salvo el 9301 de --remote-debugging-port
// (bandera de esta prueba, no de la app), y en un arranque sin esa bandera que
// no hay ninguno. Un segundo arranque con el mismo OSC_DATA demuestra que la
// importación no se repite. Capturas en test/e2e/captures/fase3-*.png.
// Variables: CDP_PORT (9301), KEEP_TMP=1 (conserva el directorio temporal),
// HOLD=1 (si un paso falla, deja la app viva hasta crear `<sandbox>/stop`).

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { demoFiles } from '../../scripts/demo-repo-files.mjs'
import { ROOT, cleanSandbox, createDriver, launchApp, makeSandbox, stamp, waitFor } from './lib.mjs'

const require = createRequire(import.meta.url)
const PORT = Number(process.env.CDP_PORT) || 9301
const SESSION = 'fase3v'
const CAPTURES = path.join(ROOT, 'test', 'e2e', 'captures')
const CHANGE = 'add-hello-endpoint'
const QUOTE = 'GET /api/v1/helloworld'
const NOTE = 'Fase 3: ¿versionamos este endpoint en la v1?'
const STUDIO_NOTE = 'Importado de Studio: ¿versionamos este endpoint?'

const results = []
async function step(name, fn) {
  const t0 = performance.now()
  try {
    const detail = await fn()
    const ms = Math.round(performance.now() - t0)
    results.push({ name, ok: true, ms, detail: String(detail ?? '') })
    console.log(`[${stamp()}] ✔ ${name} (${ms} ms)${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    results.push({ name, ok: false, ms, detail: e.message })
    console.error(`[${stamp()}] ✘ ${name} (${ms} ms) — ${e.message}`)
    throw e
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

// ---- fixtures -----------------------------------------------------------------

/** Huella del contenido de un árbol (nombre + bytes), para probar que no cambia. */
export function fingerprint(dir) {
  const parts = []
  const walk = (d) => {
    for (const e of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        parts.push(`${e.name}/`)
        walk(full)
      } else
        parts.push(
          `${e.name}|${fs.statSync(full).size}|${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`
        )
    }
  }
  walk(dir)
  return parts.join('\n')
}

/** Repo de demo (hello-app). `openspec: false` → solo el código, sin openspec/. */
export function buildRepo(dir, { openspec }) {
  for (const [rel, text] of Object.entries(demoFiles(new Date().toISOString().slice(0, 10)))) {
    if (!openspec && rel.startsWith('openspec/')) continue
    const f = path.join(dir, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
  }
  const git = (...args) => spawnSync('git', args, { cwd: dir, stdio: 'ignore' }).status === 0
  assert(git('init', '-q'), 'git init falló')
  // el HOME temporal no tiene ~/.gitconfig: sin identidad local, el commit de la app fallaría
  assert(git('config', 'user.name', 'Fase 3 E2E'), 'git config user.name falló')
  assert(git('config', 'user.email', 'fase3@example.com'), 'git config user.email falló')
  assert(git('add', '-A'), 'git add falló')
  assert(git('commit', '-qm', 'demo repo'), 'git commit falló')
  return dir
}

/**
 * Un ~/.openspec-studio realista: studio.db con el esquema de Studio 0.3.x (el
 * mismo que hereda la app: sessions/events/comments/rounds), un comentario
 * resuelto y su ronda para hello-app, config.json con la carpeta de repos y
 * agents.json con agentes propios (entre ellos el falso de esta prueba, porque
 * la importación sobrescribe agents.json con el del fixture).
 */
export function buildStudioHome(home, studioRepo, fakeAgentArgs) {
  const dir = path.join(home, '.openspec-studio')
  fs.mkdirSync(dir, { recursive: true })
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(dir, 'studio.db'))
  const iso = new Date().toISOString()
  const comment = {
    id: 'stc1',
    repo: studioRepo,
    change: CHANGE,
    file: 'proposal.md',
    anchor: {
      exact: QUOTE,
      prefix: '- Add `',
      suffix: '` returning a JSON greeting.',
      headingPath: ['What Changes'],
      lineHint: 9
    },
    kind: 'comment',
    body: STUDIO_NOTE,
    status: 'resolved',
    agentNote: null,
    roundId: null,
    orphaned: false,
    createdAt: iso
  }
  const round = {
    id: 'str1',
    repo: studioRepo,
    change: CHANGE,
    status: 'done',
    createdAt: iso,
    commentIds: ['stc1'],
    resultParsed: true,
    stopReason: 'end_turn',
    diffs: []
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE sessions (
      repo TEXT NOT NULL, agent TEXT NOT NULL, acp_session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY (repo, agent)
    );
    CREATE TABLE events (
      repo TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL,
      PRIMARY KEY (repo, seq)
    );
    CREATE TABLE comments (id TEXT PRIMARY KEY, repo TEXT NOT NULL, change TEXT NOT NULL, json TEXT NOT NULL);
    CREATE INDEX comments_by_change ON comments (repo, change);
    CREATE TABLE rounds (
      id TEXT PRIMARY KEY, repo TEXT NOT NULL, change TEXT NOT NULL, created_at TEXT NOT NULL,
      json TEXT NOT NULL, snapshot TEXT NOT NULL
    );
    CREATE INDEX rounds_by_change ON rounds (repo, change, created_at);
    INSERT INTO sessions VALUES ('${studioRepo}', 'codebuddy', 'studio-acp-session', '${iso}');
    INSERT INTO comments VALUES ('stc1', '${studioRepo}', '${CHANGE}', '${JSON.stringify(comment).replace(/'/g, "''")}');
    INSERT INTO rounds VALUES ('str1', '${studioRepo}', '${CHANGE}', '${iso}', '${JSON.stringify(round).replace(/'/g, "''")}', '{}');
  `)
  db.close()
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ roots: [path.dirname(studioRepo)] }, null, 2)
  )
  fs.writeFileSync(
    path.join(dir, 'agents.json'),
    JSON.stringify(
      [
        { id: 'gemini', label: 'Gemini', cmd: 'gemini', args: ['--experimental-acp'] },
        {
          id: 'fake',
          label: 'Agente falso',
          cmd: process.execPath,
          args: fakeAgentArgs,
          openspecTool: 'claude',
          style: 'slash'
        }
      ],
      null,
      2
    )
  )
  return dir
}

// ---- procesos y puertos (PowerShell) -------------------------------------------

/**
 * Árbol de procesos de `pid` (main → GPU/utility/renderer/agentes/CLI) con los
 * sockets TCP en LISTEN de cualquiera de ellos. Sin Get-NetTCPConnection no
 * hay evidencia: se devuelve todo como JSON.
 */
function treeAndListeners(pid) {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$root = ${pid}
$all = Get-CimInstance Win32_Process
$children = @{}
foreach ($p in $all) {
  $pp = [int]$p.ParentProcessId
  if (-not $children.ContainsKey($pp)) { $children[$pp] = @() }
  $children[$pp] += [int]$p.ProcessId
}
$tree = New-Object 'System.Collections.Generic.HashSet[int]'
$q = [System.Collections.Generic.Queue[int]]::new()
$q.Enqueue($root); [void]$tree.Add($root)
while ($q.Count -gt 0) {
  $cur = $q.Dequeue()
  if ($children.ContainsKey($cur)) {
    foreach ($c in $children[$cur]) { if ($tree.Add($c)) { $q.Enqueue($c) } }
  }
}
$procs = @()
foreach ($p in $all) { if ($tree.Contains([int]$p.ProcessId)) {
  $procs += @{ pid = [int]$p.ProcessId; name = $p.Name; cmdline = [string]$p.CommandLine }
} }
$listens = @()
foreach ($c in Get-NetTCPConnection -State Listen) {
  if ($tree.Contains([int]$c.OwningProcess)) {
    $listens += @{ local = "$($c.LocalAddress):$($c.LocalPort)"; pid = [int]$c.OwningProcess }
  }
}
ConvertTo-Json -Compress -Depth 4 @{ procs = $procs; listens = $listens }
`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    timeout: 60_000
  })
  assert(r.status === 0, `PowerShell falló: ${r.stderr || r.stdout}`)
  const out = JSON.parse(r.stdout.trim().split('\n').pop())
  // dedup IPv4/IPv6 del mismo puerto y ordena
  const seen = new Set()
  out.listens = (out.listens ?? []).filter((l) => {
    const key = `${l.local}|${l.pid}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return out
}

/** Lanza Electron SIN --remote-debugging-port (la prueba de «sin bandera»). */
async function launchAppNoCdp(sb, env = {}) {
  const electron = require('electron')
  const child = spawn(electron, ['.', `--user-data-dir=${sb.profile}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      REPOS_ROOT: sb.repos,
      OSC_DATA: sb.data,
      HOME: sb.home,
      USERPROFILE: sb.home,
      OSC_NO_UPDATE_CHECK: '1',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  // sin CDP no hay página que esperar: se espera al proceso renderer del árbol
  await waitFor('proceso renderer en el árbol', () => {
    if (child.exitCode !== null) throw new Error(`Electron terminó: ${child.exitCode}\n${log}`)
    const t = treeAndListeners(child.pid)
    return t.procs.some((p) => /--type=renderer/.test(p.cmdline)) ? t : null
  })
  return { child, log: () => log, stop: () => killTree(child) }
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

/** `netstat -ano` filtrado por pids, como evidencia en paralelo a Get-NetTCPConnection. */
function netstatFor(pids) {
  const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 30_000 })
  if (r.status !== 0) return '(netstat no disponible)'
  return (
    r.stdout
      // eslint-disable-next-line no-control-regex -- netstat colorea LISTENING en algunas consolas
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split('\n')
      .filter(
        (l) => /LISTENING/i.test(l) && pids.some((p) => new RegExp(`\\s${p}$`).test(l.trimEnd()))
      )
      .map((l) => l.trim())
      .join('\n')
  )
}

// ---- helpers de página ----------------------------------------------------------

const section = (id) =>
  `([...document.querySelectorAll('[data-repo]')].find((el) => el.dataset.repo === ${JSON.stringify(id)}) ?? null)`
const openPicker = (ab) =>
  ab.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Repository'))
    b?.click()
    return !!b
  })()`)
const pickRepo = (ab, id) =>
  ab.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(id)})
    b?.click()
    return !!b
  })()`)
/** Clica un botón por texto DENTRO de la sección de un repo (hay dos hello-app). */
const clickInSection = (ab, id, text) =>
  ab.eval(`(() => {
    const root = ${section(id)}
    const b = [...(root?.querySelectorAll('button') ?? [])].find((x) => x.innerText.includes(${JSON.stringify(text)}))
    b?.click()
    return !!b
  })()`)
const clickChangeCard = (ab, id, change) =>
  ab.eval(`(() => {
    const t = ${section(id)}?.querySelector('div[title=${JSON.stringify(change)}]')
    t?.closest('.group')?.click()
    return !!t
  })()`)

// ---- guion ----------------------------------------------------------------------

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true })
  const sb = makeSandbox('osc-fase3-')
  const walkRepo = path.join(sb.home, 'repos-walk', 'hello-app')
  const studioRepo = path.join(sb.home, 'repos-studio', 'hello-app')
  const fakeAgentArgs = [path.join(ROOT, 'test', 'e2e', 'fase3-acp-agent.mjs')]
  buildRepo(walkRepo, { openspec: false })
  buildRepo(studioRepo, { openspec: true })
  const studioHome = buildStudioHome(sb.home, studioRepo, fakeAgentArgs)
  const studioBefore = fingerprint(studioHome)
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)
  console.log(
    `[e2e] origen de Studio antes: sha256 ${sha(studioBefore)}\n${studioBefore.replace(/^/gm, '        ')}`
  )
  const markerFile = path.join(sb.data, 'imported-from-studio.json')
  console.log(`[e2e] sandbox ${sb.tmp}\n[e2e] studio fixture ${studioHome}`)

  let app = null
  const ab = createDriver(SESSION)
  let failure = null
  let walkId = ''
  let studioId = ''

  /** Espera a que el agente del repo `id` vuelva a estar tras el turno (busy→ready). */
  const waitTurnEnd = (id, what) =>
    waitFor(
      what,
      () =>
        ab.eval(
          `window.osc.repos().then((w) => { const s = w.repos.find((r) => r.id === ${JSON.stringify(id)})?.session; return s && s.status === 'ready' ? true : null })`
        ),
      { timeoutMs: 90_000 }
    )
  const changesOf = (id) =>
    ab.eval(
      `window.osc.changes(${JSON.stringify(id)}).then((c) => ({ active: c.active.map((x) => ({ name: x.name, stage: x.stage, done: x.completedTasks, total: x.totalTasks })), archived: c.archived }))`
    )
  const reviewOf = (id, change) =>
    ab.eval(
      `window.osc.review(${JSON.stringify(id)}, ${JSON.stringify(change)}).then((r) => ({ comments: r.comments.map((c) => ({ body: c.body, status: c.status, note: c.agentNote, exact: c.anchor?.exact })), rounds: r.rounds.map((x) => ({ status: x.status, parsed: x.resultParsed, diffs: x.diffs.map((d) => d.file) })) }))`
    )
  const gitOf = (id, change) =>
    ab.eval(
      `window.osc.git(${JSON.stringify(id)}${change ? `, { change: ${JSON.stringify(change)} }` : ''})`
    )

  try {
    app = await launchApp(sb, { port: PORT, env: { DEFAULT_AGENT: 'fake' } })
    console.log(`[e2e] Electron arriba en el puerto CDP ${app.port} (pid ${app.child.pid})`)
    ab.connect(app.port)
    await waitFor('#root con contenido', () =>
      ab.eval(`document.getElementById('root')?.childElementCount > 0`)
    )

    // ---- 3.11.2: importación desde Studio ----
    let marker1 = null
    await step(
      'importación: el workspace y los agentes de Studio aparecen sin tocar nada',
      async () => {
        const ws = await waitFor('repo de Studio en el workspace', () =>
          ab.eval(
            `window.osc.repos().then((w) => { const r = w.repos.find((x) => x.name === 'hello-app'); return r ? { id: r.id, openspec: r.openspec, roots: w.roots.map((x) => x.path) } : null })`
          )
        )
        studioId = ws.id
        assert(
          ws.id === studioRepo,
          `se esperaba el repo de Studio en ${studioRepo}, llegó ${ws.id}`
        )
        assert(ws.openspec, 'el repo de Studio no se ve como openspec')
        assert(
          ws.roots.includes(path.dirname(studioRepo)),
          `la carpeta importada no está en las roots: ${JSON.stringify(ws.roots)}`
        )
        const cfg = ab.eval(`window.osc.config().then((c) => c.agents.map((a) => a.id))`)
        assert(
          cfg.includes('gemini') && cfg.includes('fake'),
          `agents.json de Studio no se importó: ${JSON.stringify(cfg)}`
        )
        assert(fs.existsSync(path.join(sb.data, 'openspeccontrol.db')), 'falta la db importada')
        marker1 = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
        assert(
          marker1.files.includes('openspeccontrol.db') && marker1.files.includes('agents.json'),
          `marcador de importación incorrecto: ${JSON.stringify(marker1)}`
        )
        assert(
          fs.realpathSync.native(marker1.from) === studioHome,
          'el marcador no apunta al origen'
        )
        assert(
          fingerprint(studioHome) === studioBefore,
          'el origen de Studio cambió durante la importación'
        )
        return `root ${path.dirname(studioRepo)} + agentes [${cfg.join(', ')}]; origen intacto (sha256 ${sha(fingerprint(studioHome))} = antes)`
      }
    )

    await step(
      'importación: comentario y ronda de Studio visibles en la UI y en OSC_DATA',
      async () => {
        openPicker(ab)
        await waitFor('selector abierto', () =>
          ab.eval(`!!document.querySelector('input[placeholder="Filter…"]')`)
        )
        assert(pickRepo(ab, studioId), 'no está el repo de Studio en el selector')
        await waitFor(
          'sección del repo de Studio con el cambio',
          () => ab.eval(`!!${section(studioId)}?.querySelector('div[title="${CHANGE}"]')`),
          { timeoutMs: 30_000 }
        )
        assert(clickChangeCard(ab, studioId, CHANGE), 'no se pudo abrir el cambio de Studio')
        await waitFor(
          'propuesta de Studio renderizada',
          () =>
            ab.eval(
              `document.querySelector('.doc')?.innerText.includes('Proposal: Add hello endpoint')`
            ),
          { timeoutMs: 30_000 }
        )
        // el comentario importado está resuelto: la UI lo oculta tras «Show 1 resolved»
        // (el botón aparece cuando carga la revisión: se pulsa dentro de la espera)
        const seen = await waitFor('tarjeta del comentario importado', () =>
          ab.eval(`(() => {
          if (document.body.innerText.includes(${JSON.stringify(STUDIO_NOTE)})) return true
          ;[...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Show ') && b.innerText.endsWith(' resolved'))?.click()
          return null
        })()`)
        )
        assert(seen, 'el comentario importado no se ve')
        const tab = await ab.eval(`document.body.innerText.includes('What changed')`)
        assert(tab, 'la pestaña "What changed" no aparece con la ronda importada')
        const r = await reviewOf(studioId, CHANGE)
        assert(
          r.comments.length === 1 &&
            r.comments[0].body === STUDIO_NOTE &&
            r.comments[0].status === 'resolved',
          `comentario importado incorrecto: ${JSON.stringify(r.comments)}`
        )
        assert(
          r.rounds.length === 1 && r.rounds[0].status === 'done',
          `ronda importada incorrecta: ${JSON.stringify(r.rounds)}`
        )
        ab.screenshot(path.join(CAPTURES, 'fase3-1-import-studio.png'))
        return `comentario stc1 resuelto + ronda str1 done en ${path.relative(ROOT, markerFile)}`
      }
    )

    // ---- 3.11.3: añadir carpeta (ruta escrita con ~) ----
    await step(
      'añadir carpeta: diálogo con ruta escrita `~/repos-walk` (el nativo queda sin verificar)',
      async () => {
        assert(
          ab.eval(
            `(() => { const b = document.querySelector('button[title="Add folder…"]'); b?.click(); return !!b })()`
          ),
          'no está el botón Add folder…'
        )
        await waitFor('diálogo Add a folder', () =>
          ab.eval(`document.body.innerText.includes('Add a folder')`)
        )
        ab.screenshot(path.join(CAPTURES, 'fase3-2-add-folder.png'))
        const filled = ab.eval(`(() => {
        const i = [...document.querySelectorAll('input')].find((x) => (x.placeholder ?? '').includes('repos'))
        if (!i) return null
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        set.call(i, '~/repos-walk')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        return i.value
      })()`)
        assert(filled === '~/repos-walk', `no se pudo escribir la ruta: ${filled}`)
        ab.eval(
          `(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Add this folder'))?.click(); return true })()`
        )
        const ws = await waitFor(
          'hello-app nuevo en el workspace',
          () =>
            ab.eval(
              `window.osc.repos().then((w) => { const r = w.repos.find((x) => x.id === ${JSON.stringify(walkRepo)}); return r && !r.openspec ? { roots: w.roots.map((x) => x.path) } : null })`
            ),
          { timeoutMs: 30_000 }
        )
        walkId = walkRepo
        assert(
          ws.roots.includes(path.join(sb.home, 'repos-walk')),
          `la root añadida con ~ no se resolvió: ${JSON.stringify(ws.roots)}`
        )
        return `~/repos-walk → ${path.join(sb.home, 'repos-walk')} (repo sin openspec listo para inicializar)`
      }
    )

    // ---- inicializar ----
    await step('inicializar: `openspec init` real desde la UI', async () => {
      openPicker(ab)
      await waitFor('selector abierto', () =>
        ab.eval(`!!document.querySelector('input[placeholder="Filter…"]')`)
      )
      assert(pickRepo(ab, walkId), 'no está el repo del walkthrough en el selector')
      await waitFor(
        'pantalla Set up OpenSpec in this repo',
        () => ab.eval(`document.body.innerText.includes('Set up OpenSpec in this repo')`),
        { timeoutMs: 30_000 }
      )
      const chip = await ab.eval(`document.body.innerText.includes('Agente falso')`)
      assert(chip, 'el agente falso no aparece como herramienta de init')
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Initialize OpenSpec')?.click(); return true })()`
      )
      const ready = await waitFor(
        'repo con openspec',
        () =>
          ab.eval(
            `window.osc.repos().then((w) => w.repos.find((r) => r.id === ${JSON.stringify(walkId)})?.openspec ? true : null)`
          ),
        { timeoutMs: 120_000 }
      )
      assert(ready, 'el repo no quedó inicializado')
      // hasOpenSpec() es «existe openspec/»: el CLI aún puede estar escribiendo el resto
      await waitFor(
        'openspec init terminado (config.yaml + .claude/)',
        () =>
          fs.existsSync(path.join(walkRepo, 'openspec', 'config.yaml')) &&
          fs.existsSync(path.join(walkRepo, '.claude')),
        { timeoutMs: 120_000 }
      )
      ab.screenshot(path.join(CAPTURES, 'fase3-3-inicializado.png'))
      return 'openspec/config.yaml + .claude/ en el repo del walkthrough'
    })

    // ---- conectar agente ----
    await step('conectar agente: sesión ready con el agente falso', async () => {
      assert(
        ab.eval(
          `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Connect'); b?.click(); return !!b })()`
        ),
        'no está el botón Connect'
      )
      const s = await waitFor(
        'sesión ready',
        () =>
          ab.eval(
            `window.osc.repos().then((w) => { const s = w.repos.find((r) => r.id === ${JSON.stringify(walkId)})?.session; return s?.status === 'ready' ? s.sessionId : null })`
          ),
        { timeoutMs: 60_000 }
      )
      assert(s, 'la sesión no llegó a ready')
      return `sesión ${s}`
    })

    // ---- proponer ----
    let portsDuringTurn = null
    await step('proponer: New change → el agente crea artefactos reales', async () => {
      assert(clickInSection(ab, walkId, 'New change'), 'no está el botón New change')
      await waitFor('diálogo New change (textarea)', () =>
        ab.eval(`!!document.querySelector('textarea[placeholder*="One sentence"]')`)
      )
      ab.eval(`(() => {
        const t = document.querySelector('textarea[placeholder*="One sentence"]')
        if (!t) return false
        const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        set.call(t, 'Add a hello endpoint')
        t.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Propose')?.click(); return true })()`
      )
      // mientras el turno corre (agente trabajando): puertos TCP del árbol
      await waitFor(
        'turno en marcha (busy)',
        () =>
          ab.eval(
            `(async () => { const w = await window.osc.repos(); return w.repos.find((r) => r.id === ${JSON.stringify(walkId)})?.session?.status === 'busy' ? true : null })()`
          ),
        { timeoutMs: 30_000 }
      )
      const t = treeAndListeners(app.child.pid)
      const agentProcs = t.procs.filter((p) => /fase3-acp-agent/.test(p.cmdline))
      portsDuringTurn = t
      assert(agentProcs.length >= 1, 'el proceso del agente no está en el árbol durante el turno')
      console.log(
        `[e2e] árbol de la app durante el turno: ${t.procs.length} procesos; LISTEN: ${JSON.stringify(t.listens)}`
      )
      await waitTurnEnd(walkId, 'turno de propose terminado')
      const ch = await waitFor(
        'cambio en In review',
        () => {
          const v = changesOf(walkId)
          const ch = v.active.find((x) => x.name === CHANGE)
          return ch && ch.stage === 'review' ? ch : null
        },
        { timeoutMs: 60_000 }
      )
      for (const f of ['proposal.md', 'design.md', 'tasks.md', 'specs/greeting/spec.md'])
        assert(fs.existsSync(path.join(walkRepo, 'openspec', 'changes', CHANGE, f)), `falta ${f}`)
      ab.screenshot(path.join(CAPTURES, 'fase3-4-propuesta.png'))
      return `add-hello-endpoint en "${ch.stage}" con 4 artefactos en disco`
    })

    // ---- puertos (3.11.1) ----
    await step(
      'puertos: con el agente trabajando solo escucha el CDP 9301 de la prueba',
      async () => {
        const t = portsDuringTurn ?? treeAndListeners(app.child.pid)
        const bad = t.listens.filter((l) => !l.local.endsWith(`:${PORT}`))
        const kinds = [
          ...new Set(t.procs.map((p) => /--type=(\w+)/.exec(p.cmdline)?.[1] ?? 'main'))
        ]
        assert(
          bad.length === 0,
          `sockets en LISTEN ajenos al CDP de la prueba: ${JSON.stringify(bad)}`
        )
        const cdp = t.listens.filter((l) => l.local.endsWith(`:${PORT}`))
        assert(cdp.length >= 1, `ni siquiera el CDP ${PORT} aparece: ${JSON.stringify(t.listens)}`)
        const net = netstatFor(t.procs.map((p) => p.pid))
        console.log(
          `[e2e] netstat -ano (LISTENING, pids del árbol):\n${net || '(ninguno)'}\n[e2e] tipos de proceso: ${kinds.join(', ')}`
        )
        return `${t.procs.length} procesos [${kinds.join(', ')}]; LISTEN solo ${cdp.map((l) => l.local).join(', ')} (bandera de la prueba)`
      }
    )

    // ---- comentar ----
    await step('revisar: comentario anclado en la propuesta', async () => {
      assert(clickChangeCard(ab, walkId, CHANGE), 'no se pudo abrir el cambio nuevo')
      await waitFor(
        'propuesta nueva renderizada',
        () =>
          ab.eval(
            `document.querySelector('.doc')?.innerText.includes('Proposal: Add hello endpoint')`
          ),
        { timeoutMs: 30_000 }
      )
      const selected = ab.eval(`(() => {
        const doc = document.querySelector('.doc')
        const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) if (node.nodeValue.includes(${JSON.stringify(QUOTE)})) break
        if (!node) return null
        const i = node.nodeValue.indexOf(${JSON.stringify(QUOTE)})
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + ${QUOTE.length})
        const sel = getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return sel.toString()
      })()`)
      assert(selected === QUOTE, `no se pudo seleccionar el texto: ${selected}`)
      await waitFor('barra flotante con Comment', () =>
        ab.eval(`!!document.querySelector('div[data-ui].absolute button[title="Comment"]')`)
      )
      ab.click('div[data-ui].absolute button[title="Comment"]')
      await waitFor('editor del comentario', () =>
        ab.eval(`!!document.querySelector('textarea[placeholder^="Pick a suggestion"]')`)
      )
      ab.fillPlaceholder('Pick a suggestion or write a note…', NOTE)
      ab.clickRole('button', 'Add comment')
      const saved = await waitFor('comentario en la db', () => {
        const r = reviewOf(walkId, CHANGE)
        return r.comments.length ? r.comments : null
      })
      assert(
        saved.length === 1 && saved[0].body === NOTE,
        `comentario incorrecto: ${JSON.stringify(saved)}`
      )
      assert(saved[0].exact === QUOTE, `ancla incorrecta: ${saved[0].exact}`)
      return `ancla "${QUOTE}" en proposal.md`
    })

    // ---- enviar ronda ----
    await step('enviar ronda: el agente revisa, reporta veredictos y deja diff', async () => {
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Send review'))?.click(); return true })()`
      )
      await waitTurnEnd(walkId, 'ronda terminada')
      const r = await waitFor(
        'ronda done con veredictos',
        () => {
          const v = reviewOf(walkId, CHANGE)
          const rd = v.rounds[0]
          return rd && rd.status === 'done' && rd.parsed ? v : null
        },
        { timeoutMs: 60_000 }
      )
      assert(
        r.comments[0].status === 'addressed' && /Alternatives/.test(r.comments[0].note ?? ''),
        `veredicto incorrecto: ${JSON.stringify(r.comments[0])}`
      )
      assert(
        r.rounds[0].diffs.includes('proposal.md'),
        `la ronda no registró el diff de proposal.md: ${JSON.stringify(r.rounds[0].diffs)}`
      )
      assert(
        /## Alternatives considered/.test(
          fs.readFileSync(path.join(walkRepo, 'openspec', 'changes', CHANGE, 'proposal.md'), 'utf8')
        ),
        'el agente no editó proposal.md'
      )
      ab.screenshot(path.join(CAPTURES, 'fase3-5-ronda.png'))
      return `Round 1 done, veredicto "${r.comments[0].status}", diff [${r.rounds[0].diffs}]`
    })

    await step('resolver lo atendido: el cambio pasa a Ready to build', async () => {
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.includes('resolve addressed'))?.click(); return true })()`
      )
      const ch = await waitFor(
        'stage ready',
        () => {
          const v = changesOf(walkId)
          const c = v.active.find((x) => x.name === CHANGE)
          return c && c.stage === 'ready' ? c : null
        },
        { timeoutMs: 60_000 }
      )
      const r = reviewOf(walkId, CHANGE)
      assert(
        r.comments[0].status === 'resolved',
        `el comentario no quedó resuelto: ${JSON.stringify(r.comments[0])}`
      )
      return `stage "${ch.stage}" (${ch.done}/${ch.total} tareas)`
    })

    // ---- construir ----
    await step('construir: Build it escribe código real y marca las tareas', async () => {
      assert(clickInSection(ab, walkId, 'Build it'), 'no está el botón Build it')
      await waitTurnEnd(walkId, 'turno de apply terminado')
      const ch = await waitFor(
        'stage done',
        () => {
          const v = changesOf(walkId)
          const c = v.active.find((x) => x.name === CHANGE)
          return c && c.stage === 'done' ? c : null
        },
        { timeoutMs: 60_000 }
      )
      assert(ch.done === ch.total && ch.total === 3, `tareas: ${JSON.stringify(ch)}`)
      for (const f of ['src/routes/hello.js', 'test/hello.test.js'])
        assert(fs.existsSync(path.join(walkRepo, f)), `falta ${f}`)
      assert(
        /'GET \/api\/v1\/helloworld': hello,/.test(
          fs.readFileSync(path.join(walkRepo, 'src', 'app.js'), 'utf8')
        ),
        'la ruta no quedó registrada en src/app.js'
      )
      const t = fs.readFileSync(
        path.join(walkRepo, 'openspec', 'changes', CHANGE, 'tasks.md'),
        'utf8'
      )
      assert(!t.includes('- [ ]'), 'tasks.md conserva tareas sin marcar')
      const test = spawnSync(process.execPath, ['--test'], { cwd: walkRepo, encoding: 'utf8' })
      assert(
        test.status === 0,
        `npm test falló tras construir:\n${(test.stdout || '') + (test.stderr || '')}`.slice(0, 500)
      )
      ab.screenshot(path.join(CAPTURES, 'fase3-6-construido.png'))
      return `3/3 tareas, node --test en verde (stage "${ch.stage}")`
    })

    // ---- rama y commit ----
    await step('rama: Create branch change/ desde el aviso de la rama base', async () => {
      const banner = await waitFor('aviso de rama base con Create branch', () =>
        ab.eval(
          `!![...document.querySelectorAll('button')].find((b) => b.innerText.includes('Create branch change/'))`
        )
      )
      assert(banner, 'no apareció el aviso de estar en la rama base')
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Create branch change/'))?.click(); return true })()`
      )
      const g = await waitFor(
        'rama change/ creada',
        () => {
          const v = gitOf(walkId)
          return v.branch === `change/${CHANGE}` ? v : null
        },
        { timeoutMs: 30_000 }
      )
      assert(!g.onBase, `no debería estar en la rama base: ${JSON.stringify(g)}`)
      return `rama ${g.branch}`
    })

    await step('commit: solo los archivos del cambio, con mensaje editable', async () => {
      const g0 = gitOf(walkId, CHANGE)
      assert(
        (g0.pending ?? []).length === 5,
        `pendientes inesperados: ${JSON.stringify(g0.pending)}`
      )
      await waitFor('botón Commit N files…', () =>
        ab.eval(
          `!![...document.querySelectorAll('button')].find((b) => /Commit \\d+ files?…/.test(b.innerText))`
        )
      )
      ab.screenshot(path.join(CAPTURES, 'fase3-7-commit.png'))
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => /Commit \\d+ files?…/.test(b.innerText))?.click(); return true })()`
      )
      await waitFor('diálogo de commit', () =>
        ab.eval(`document.body.innerText.includes('Commit add-hello-endpoint')`)
      )
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].find((b) => /^Commit \\d+ files?$/.test(b.innerText.trim()))?.click(); return true })()`
      )
      await waitFor(
        'diálogo cerrado y working tree limpio',
        () => {
          const v = gitOf(walkId, CHANGE)
          const closed = ab.eval(`!document.body.innerText.includes('Commit add-hello-endpoint')`)
          return closed && (v.pending ?? []).length === 0 ? v : null
        },
        { timeoutMs: 60_000 }
      )
      const log = spawnSync('git', ['log', '--oneline'], { cwd: walkRepo, encoding: 'utf8' })
      const lines = log.stdout.trim().split('\n')
      assert(lines.length === 2, `se esperaban 2 commits, hay ${lines.length}`)
      const show = spawnSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
        cwd: walkRepo,
        encoding: 'utf8'
      })
      const files = show.stdout.trim().split('\n')
      // por diseño el commit solo lleva los archivos del cambio (openspec/changes/<c>/):
      // el código que escribió el agente queda en el working tree para que el usuario decida
      assert(
        files.length === 5 && files.every((f) => f.startsWith(`openspec/changes/${CHANGE}/`)),
        `el commit no lleva exactamente los 5 archivos del cambio: ${JSON.stringify(files)}`
      )
      const left = spawnSync('git', ['status', '--short'], {
        cwd: walkRepo,
        encoding: 'utf8'
      }).stdout
      assert(
        /src\/app\.js/.test(left) && /src\/routes\/hello\.js/.test(left),
        `el código construido debería seguir sin commitear (alcance del commit): ${left}`
      )
      return `commit ${lines[0].slice(0, 9)}… con ${files.length} archivos del cambio; src/ sin commitear (por diseño)`
    })

    // ---- archivar ----
    await step('archivar: `openspec archive` real desde la UI', async () => {
      assert(clickInSection(ab, walkId, 'Archive'), 'no está el botón Archive')
      await waitFor('diálogo Archive change', () =>
        ab.eval(`document.body.innerText.includes('Archive change')`)
      )
      // el botón del diálogo es el último «Archive» del DOM (el de la tarjeta queda detrás)
      ab.eval(
        `(() => { [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Archive').at(-1)?.click(); return true })()`
      )
      await waitTurnEnd(walkId, 'turno de archive terminado')
      const v = await waitFor(
        'cambio archivado',
        () => {
          const c = changesOf(walkId)
          return !c.active.some((x) => x.name === CHANGE) && c.archived.length ? c.archived : null
        },
        { timeoutMs: 60_000 }
      )
      const archivedName = v.find((x) => x.endsWith(CHANGE))
      assert(archivedName, `archivado inesperado: ${JSON.stringify(v)}`)
      assert(
        fs.existsSync(path.join(walkRepo, 'openspec', 'changes', 'archive', archivedName)),
        'falta la carpeta de archivado (¿no corrió el CLI?)'
      )
      assert(
        fs.existsSync(path.join(walkRepo, 'openspec', 'specs', 'greeting', 'spec.md')),
        'los specs principales no se fusionaron al archivar'
      )
      // la UI también debe reflejarlo: la tarjeta sale de las activas (sin esto la
      // captura mostraría el estado anterior al refresco)
      await waitFor(
        'la tarjeta del cambio desaparece de los activos en la UI',
        () => ab.eval(`!${section(walkId)}?.querySelector('div[title="${CHANGE}"]')`),
        { timeoutMs: 20_000 }
      )
      ab.screenshot(path.join(CAPTURES, 'fase3-8-archivado.png'))
      return `${archivedName} + specs/greeting/spec.md en specs principales`
    })

    await step('sin errores de página durante el recorrido', async () => {
      const errs = ab.pageErrors()
      const list = Array.isArray(errs?.errors) ? errs.errors : []
      assert(list.length === 0, `errores de página: ${JSON.stringify(list).slice(0, 500)}`)
    })

    // ---- 3.11.2 (final): segundo arranque no reimporta ----
    await step(
      'segundo arranque: la importación no se repite y lo añadido se conserva',
      async () => {
        const before = { at: marker1.at, mtime: fs.statSync(markerFile).mtimeMs }
        ab.close()
        app.stop()
        await new Promise((r) => setTimeout(r, 2500))
        app = await launchApp(sb, { port: PORT, env: { DEFAULT_AGENT: 'fake' } })
        ab.connect(app.port)
        await waitFor('#root tras rearrancar', () =>
          ab.eval(
            `document.getElementById('root')?.childElementCount > 0 && typeof window.osc === 'object'`
          )
        )
        const after = {
          at: JSON.parse(fs.readFileSync(markerFile, 'utf8')).at,
          mtime: fs.statSync(markerFile).mtimeMs
        }
        assert(
          after.at === before.at && after.mtime === before.mtime,
          `el marcador cambió: ${JSON.stringify({ before, after })}`
        )
        // el cambio ya está archivado (la revisión por API es de cambios activos): se
        // comprueba en la db de OSC_DATA, que tiene tanto lo importado como lo nuevo
        const db = new (require('node:sqlite').DatabaseSync)(
          path.join(sb.data, 'openspeccontrol.db'),
          {
            readOnly: true
          }
        )
        const rows = db.prepare('SELECT id, repo, json FROM comments ORDER BY id').all()
        const rounds = db.prepare('SELECT id, repo FROM rounds ORDER BY id').all()
        db.close()
        const mine = rows.filter((x) => JSON.parse(x.json).body === NOTE)
        assert(
          mine.length === 1 && mine[0].repo === walkId,
          `el comentario del recorrido no sobrevivió al rearranque: ${JSON.stringify(rows.map((x) => x.id))}`
        )
        assert(
          rows.some((x) => x.id === 'stc1') && rounds.some((x) => x.id === 'str1'),
          'el comentario/ronda importados de Studio ya no están en la db'
        )
        const ws = ab.eval(`window.osc.repos().then((w) => w.roots.map((x) => x.path))`)
        assert(
          ws.includes(path.join(sb.home, 'repos-walk')),
          `la carpeta añadida no persistió: ${JSON.stringify(ws)}`
        )
        assert(
          fingerprint(studioHome) === studioBefore,
          'el origen de Studio cambió en el segundo arranque'
        )
        return `marcador intacto (${after.at}); db con ${rows.length} comentarios (stc1 importado + el del recorrido) y ${rounds.length} rondas; roots a salvo`
      }
    )

    // ---- 3.11.1 (final): sin la bandera no hay ningún puerto ----
    await step(
      'sin --remote-debugging-port: ningún socket TCP en LISTEN en todo el árbol',
      async () => {
        ab.close()
        app.stop()
        await new Promise((r) => setTimeout(r, 2500))
        const bare = await launchAppNoCdp(sb, { DEFAULT_AGENT: 'fake' })
        try {
          await waitFor('árbol estable con renderer', () => {
            const v = treeAndListeners(bare.child.pid)
            return v.procs.some((p) => /--type=renderer/.test(p.cmdline)) && v.procs.length >= 4
              ? v
              : null
          })
          await new Promise((r) => setTimeout(r, 3000)) // asentar (watchers, agents…)
          const t2 = treeAndListeners(bare.child.pid)
          console.log(
            `[e2e] árbol sin bandera: ${t2.procs.length} procesos; LISTEN: ${JSON.stringify(t2.listens)}`
          )
          assert(
            t2.listens.length === 0,
            `puertos en LISTEN sin la bandera: ${JSON.stringify(t2.listens)}`
          )
          const net = netstatFor(t2.procs.map((p) => p.pid))
          console.log(
            `[e2e] netstat -ano (LISTENING, pids del árbol sin bandera):\n${net || '(ninguno)'}`
          )
          assert(
            fingerprint(studioHome) === studioBefore,
            'el origen de Studio cambió en el arranque sin bandera'
          )
          return `${t2.procs.length} procesos, 0 sockets en LISTEN`
        } finally {
          bare.stop()
        }
      }
    )
  } catch (e) {
    failure = e
    if (app) console.error(`[e2e] últimas líneas de Electron:\n${app.log().trim()}`)
  } finally {
    if (failure && process.env.HOLD === '1') {
      // depuración: deja la app viva hasta que exista `<sandbox>/stop`
      const stopFile = path.join(sb.tmp, 'stop')
      console.log(`[e2e] HOLD=1: app viva en CDP ${PORT}; crea ${stopFile} para cerrar`)
      while (!fs.existsSync(stopFile)) await new Promise((r) => setTimeout(r, 2000))
    }
    ab.close()
    app?.stop()
    await new Promise((r) => setTimeout(r, 1500))
    cleanSandbox(sb)
  }

  const ok = results.filter((r) => r.ok).length
  console.log(`\n[e2e] capturas en ${CAPTURES}`)
  console.log(`[e2e] ${failure ? 'FALLA' : 'OK'}: ${ok}/${results.length} pasos`)
  for (const r of results)
    console.log(
      `  ${r.ok ? 'OK ' : 'FALLA'} · ${r.name}${r.ok && r.detail ? ` — ${r.detail}` : ''}`
    )
  return failure ? 1 : 0
}

mainExported()
function mainExported() {
  return main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[e2e] FALLA: ${e instanceof Error ? e.stack : e}`)
      process.exit(1)
    }
  )
}

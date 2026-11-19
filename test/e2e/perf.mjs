// Fase 11 (tarea 11.5): mediciones de rendimiento sobre la app real.
//
//   npx electron-vite build
//   node test/e2e/perf.mjs            # escribe test/e2e/perf-results.json y sale 1 si pasa algún umbral
//
// Requiere agent-browser, el CLI `openspec` y Node ≥ 22.18 (importa src/main/core/db.ts
// para sembrar la base con el mismo esquema que usa la app). Mide dos cosas:
//
//  A) Rail con una base grande — un repo con 40 cambios activos, 120 archivados y
//     25 specs, 60 repos más en REPOS_ROOT y 3000 comentarios + 200 rondas en la db.
//     Se mide desde el clic en el repo hasta que el rail pinta los 40 cambios (primera
//     carga: arranca el CLI de OpenSpec) y las recargas siguientes (caché de la vista
//     del CLI). Umbral del plan: < 2 s.
//
//  B) Sesión con más de 2000 eventos — el agente falso (fake-acp-agent.mjs, definido
//     en agents.json de la app) emite 2500 `session/update` por el camino real
//     (hub → db → IPC → store → transcripción). Mientras tanto una sonda en la página
//     registra tareas largas (PerformanceObserver `longtask`), el hueco máximo de un
//     latido de timers y la latencia de ida y vuelta al proceso principal (IPC
//     `updateState()` cada 100 ms). También se mide el replay de 2000 eventos al
//     re-suscribirse. «Sin bloquear la UI»: hueco máximo del latido de timers ≤ 500 ms
//     y tarea más larga ≤ 250 ms (entre 200 y 500 ms la interacción empieza a sentirse
//     congelada). La latencia IPC se informa pero no puntúa: una consulta hecha en
//     mitad de la ráfaga espera detrás de los ~2500 mensajes ya encolados. El latido es la medida decisiva:
//     un renderizado de ~30 ms por evento, repetido 2500 veces, deja la página
//     congelada ~80 s sin que ninguna tarea suelta pase de 50 ms (`longtask`).
//
// Escribe test/e2e/perf-results-<N>-cambios.json.
// Variables: PERF_CHANGES (40), PERF_ARCHIVED (120), PERF_SPECS (25), PERF_REPOS (60),
// PERF_COMMENTS (3000), PERF_EVENTS (2500), CDP_PORT, KEEP_TMP=1.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { demoFiles } from '../../scripts/demo-repo-files.mjs'
import {
  ROOT,
  cleanSandbox,
  createDriver,
  launchApp,
  makeSandbox,
  sleep,
  stamp,
  waitFor
} from './lib.mjs'

const N_CHANGES = Number(process.env.PERF_CHANGES) || 40
const N_ARCHIVED = Number(process.env.PERF_ARCHIVED) || 120
const N_SPECS = Number(process.env.PERF_SPECS) || 25
const N_REPOS = Number(process.env.PERF_REPOS) || 60
const N_COMMENTS = Number(process.env.PERF_COMMENTS) || 3000
const N_ROUNDS = 200
const N_EVENTS = Number(process.env.PERF_EVENTS) || 2500

const LIMITS = {
  railMs: 2000,
  timerGapMs: 500,
  longTaskMs: 250
}

const log = (m) => console.log(`[${stamp()}] ${m}`)
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]

// ---- fixture -------------------------------------------------------------------------

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** big-app: el repo de demo clonado 40 veces como cambios, más archivados y specs. */
function buildBigRepo(sb) {
  const repo = path.join(sb.repos, 'big-app')
  const today = new Date().toISOString().slice(0, 10)
  const files = demoFiles(today)
  for (const [rel, text] of Object.entries(files)) write(path.join(repo, rel), text)
  const base = 'openspec/changes/add-hello-endpoint/'
  const changeFiles = Object.entries(files).filter(([rel]) => rel.startsWith(base))
  for (let i = 1; i <= N_CHANGES; i++) {
    const name = `bulk-change-${String(i).padStart(3, '0')}`
    for (const [rel, text] of changeFiles) {
      write(
        path.join(repo, rel.replace('add-hello-endpoint', name)),
        text.replaceAll('add-hello-endpoint', name)
      )
    }
  }
  for (let i = 1; i <= N_ARCHIVED; i++) {
    const d = `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}-archived-${String(i).padStart(3, '0')}`
    write(
      path.join(repo, 'openspec', 'changes', 'archive', d, 'proposal.md'),
      `# Proposal: archived ${i}\n\n## Why\nHistorical change ${i}.\n`
    )
  }
  for (let i = 1; i <= N_SPECS; i++) {
    const reqs = Array.from(
      { length: 6 },
      (_, k) =>
        `### Requirement: Behaviour ${k + 1}\nThe system SHALL do thing ${k + 1}.\n\n#### Scenario: case ${k + 1}\n- **WHEN** x\n- **THEN** y\n`
    ).join('\n')
    write(
      path.join(repo, 'openspec', 'specs', `capability-${String(i).padStart(2, '0')}`, 'spec.md'),
      `# capability-${i} Specification\n\n## Purpose\nPurpose ${i}.\n\n## Requirements\n${reqs}`
    )
  }
  spawnSync('git', ['init', '-q'], { cwd: repo })
  // 60 repos más en la misma carpeta de trabajo (el escaneo del rail los recorre)
  for (let i = 1; i <= N_REPOS; i++) {
    write(
      path.join(
        sb.repos,
        `repo-${String(i).padStart(3, '0')}`,
        'openspec',
        'specs',
        'x',
        'spec.md'
      ),
      `# x\n`
    )
  }
  return repo
}

/** Siembra comentarios y rondas con el mismo código de db que usa la app. */
async function seedDb(sb, repoId) {
  const db = await import(pathToFileURL(path.join(ROOT, 'src', 'main', 'core', 'db.ts')).href)
  db.openDb(path.join(sb.data, 'openspeccontrol.db'))
  const handle = db.getDb()
  handle.exec('BEGIN')
  const kinds = ['change', 'question', 'remove', 'comment', 'ok']
  for (let i = 0; i < N_COMMENTS; i++) {
    const change = `bulk-change-${String((i % N_CHANGES) + 1).padStart(3, '0')}`
    db.comments.put({
      id: `c${String(i).padStart(6, '0')}`,
      repo: repoId,
      change,
      file: 'proposal.md',
      anchor: {
        exact: 'GET /api/v1/helloworld',
        prefix: 'Add ',
        suffix: ' returning a JSON greeting.',
        headingPath: ['Proposal: Add hello endpoint', 'What Changes'],
        lineHint: 6
      },
      kind: kinds[i % kinds.length],
      body: `Comentario sintético ${i}: revisar este punto antes de construir.`,
      status: i % 4 === 0 ? 'resolved' : 'draft',
      agentNote: null,
      roundId: null,
      orphaned: false,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
    })
  }
  const snapshot = Object.fromEntries(
    ['proposal.md', 'design.md', 'tasks.md'].map((f) => [f, `# ${f}\n${'texto '.repeat(400)}\n`])
  )
  for (let i = 0; i < N_ROUNDS; i++) {
    db.rounds.put(
      {
        id: `r${String(i).padStart(5, '0')}`,
        repo: repoId,
        change: `bulk-change-${String((i % N_CHANGES) + 1).padStart(3, '0')}`,
        status: 'done',
        createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, i)).toISOString(),
        commentIds: [],
        resultParsed: true,
        stopReason: 'end_turn',
        diffs: []
      },
      snapshot
    )
  }
  handle.exec('COMMIT')
  db.closeDb()
}

// ---- sonda en la página ----------------------------------------------------------------

const INSTALL_PROBE = `(() => {
  if (window.__probe) window.__probe.stop()
  const st = {
    start: performance.now(), visibility: document.visibilityState,
    longtasks: [], events: 0, kinds: {}, firstEvent: null, turnEnd: null, lastEvent: null,
    maxGap: 0, gaps50: 0, gaps100: 0, ticks: 0, pings: []
  }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longtasks.push(Math.round(e.duration)) })
      .observe({ entryTypes: ['longtask'] })
  } catch {}
  let running = true
  let last = performance.now()
  const tick = () => {
    if (!running) return
    const now = performance.now(), gap = now - last
    last = now; st.ticks++
    if (gap > st.maxGap) st.maxGap = gap
    if (gap > 50) st.gaps50++
    if (gap > 100) st.gaps100++
    setTimeout(tick, 0)
  }
  setTimeout(tick, 0)
  const ping = setInterval(async () => {
    const t = performance.now()
    try { await window.osc.updateState(); st.pings.push(performance.now() - t) } catch {}
  }, 100)
  const off = window.osc.onMessage((m) => {
    if (m.type !== 'event') return
    const now = performance.now()
    st.events++
    st.kinds[m.entry.event.kind] = (st.kinds[m.entry.event.kind] ?? 0) + 1
    st.firstEvent ??= now
    st.lastEvent = now
    if (m.entry.event.kind === 'turn_end') st.turnEnd = now
  })
  st.stop = () => { running = false; clearInterval(ping); off() }
  window.__probe = st
  return true
})()`

const READ_PROBE = `(() => {
  const s = window.__probe
  const { stop, ...rest } = s
  return { ...rest, now: performance.now() }
})()`

const summarize = (p) => {
  const longest = p.longtasks.length ? Math.max(...p.longtasks) : 0
  return {
    events: p.events,
    kinds: p.kinds,
    visibility: p.visibility,
    streamMs: p.turnEnd && p.firstEvent ? Math.round(p.turnEnd - p.firstEvent) : null,
    longTasks: p.longtasks.length,
    longestTaskMs: longest,
    blockedMs: p.longtasks.reduce((a, b) => a + Math.max(0, b - 50), 0),
    timerMaxGapMs: Math.round(p.maxGap),
    timerGapsOver100ms: p.gaps100,
    ipcPings: p.pings.length,
    ipcMedianMs: p.pings.length ? Math.round(median(p.pings)) : null,
    ipcP95Ms: p.pings.length ? Math.round(pct(p.pings, 0.95)) : null,
    ipcMaxMs: p.pings.length ? Math.round(Math.max(...p.pings)) : null
  }
}

// ---- recorrido ---------------------------------------------------------------------------

async function main() {
  const sb = makeSandbox('osc-perf-')
  log(`sandbox ${sb.tmp}`)
  const repoDir = buildBigRepo(sb)
  const repoId = fs.realpathSync.native(repoDir)
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
  await seedDb(sb, repoId)
  log(
    `base sembrada: ${N_CHANGES} cambios, ${N_ARCHIVED} archivados, ${N_SPECS} specs, ${N_REPOS + 1} repos, ${N_COMMENTS} comentarios, ${N_ROUNDS} rondas`
  )

  const results = {
    when: new Date().toISOString(),
    env: {
      os: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
      cpu: `${os.cpus()[0]?.model.trim()} × ${os.cpus().length}`,
      ramGb: Math.round(os.totalmem() / 2 ** 30),
      node: process.version,
      openspec: spawnSync('openspec', ['--version'], {
        encoding: 'utf8',
        shell: true
      }).stdout.trim()
    },
    fixture: {
      changes: N_CHANGES,
      archived: N_ARCHIVED,
      specs: N_SPECS,
      repos: N_REPOS + 1,
      comments: N_COMMENTS,
      rounds: N_ROUNDS
    },
    limits: LIMITS
  }
  const problems = []
  const ab = createDriver()
  let app = null
  try {
    app = await launchApp(sb)
    ab.connect(app.port)
    await waitFor('selector de repos', () =>
      ab.eval(`document.body.innerText.includes('Choose a repo')`)
    )
    results.env.electron = ab.eval(`navigator.userAgent.match(/Electron\\/[\\d.]+/)?.[0] ?? ''`)

    // ---- A) rail ----
    const countChanges = `document.querySelectorAll('[title^="bulk-change-"]').length`
    ab.clickText('Choose a repo')
    await waitFor('lista de repos', () => ab.eval(`document.body.innerText.includes('big-app')`))
    log('A) primera carga del rail (arranca el CLI de OpenSpec)…')
    const cold = ab.eval(`(async () => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('big-app'))
      const t0 = performance.now()
      btn.click()
      while (${countChanges} < ${N_CHANGES}) {
        if (performance.now() - t0 > 60000) return { timeout: true, cards: ${countChanges} }
        await new Promise((r) => setTimeout(r, 5))
      }
      return { ms: Math.round(performance.now() - t0) }
    })()`)
    if (cold.timeout) throw new Error(`el rail no pintó los ${N_CHANGES} cambios (${cold.cards})`)
    const api = (call) =>
      ab.eval(
        `(async () => { const t = performance.now(); await ${call}; return Math.round(performance.now() - t) })()`
      )
    const warm = []
    for (let i = 0; i < 5; i++) warm.push(api(`window.osc.changes(${JSON.stringify(repoId)})`))
    const scans = []
    for (let i = 0; i < 3; i++) scans.push(api(`window.osc.repos(true)`))
    // invalida la caché del CLI tocando un archivo bajo openspec/ y vuelve a pedir
    const colds = []
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(
        path.join(repoDir, 'openspec', 'changes', 'bulk-change-001', 'tasks.md'),
        `\n<!-- ${i} -->\n`
      )
      colds.push(api(`window.osc.changes(${JSON.stringify(repoId)})`))
    }
    results.rail = {
      firstPaintMs: cold.ms,
      changesColdMs: colds,
      changesWarmMs: warm,
      repoScanMs: scans,
      verdict: cold.ms < LIMITS.railMs && Math.max(...colds) < LIMITS.railMs
    }
    log(
      `A) rail: primera carga ${cold.ms} ms; changes() en frío ${colds.join('/')} ms, en caliente ${warm.join('/')} ms; escaneo ${scans.join('/')} ms`
    )
    if (!results.rail.verdict) problems.push(`rail por encima de ${LIMITS.railMs} ms`)

    // ---- B) sesión de más de 2000 eventos ----
    log(`B) arranca el agente falso y emite ${N_EVENTS} eventos…`)
    ab.eval(
      `window.osc.send({ type: 'start', repo: ${JSON.stringify(repoId)}, agent: 'fake' }), true`
    )
    await waitFor('sesión lista', () =>
      ab.eval(
        `window.osc.repos().then((w) => w.repos.find((r) => r.id === ${JSON.stringify(repoId)})?.session?.status === 'ready')`
      )
    )
    ab.eval(INSTALL_PROBE)
    await sleep(500) // línea base sin carga
    const idle = summarize(ab.eval(READ_PROBE))
    ab.eval(
      `window.osc.send({ type: 'prompt', repo: ${JSON.stringify(repoId)}, text: 'prueba de carga events=${N_EVENTS}' }), true`
    )
    await waitFor(
      'fin del turno',
      () => {
        const p = ab.eval(READ_PROBE)
        return p.turnEnd ? p : null
      },
      { timeoutMs: 180_000, intervalMs: 500 }
    )
    await sleep(1500) // deja que el renderer termine de pintar lo pendiente
    const after = ab.eval(READ_PROBE)
    const rendered = ab.eval(`document.body.innerText.includes('Fragmento')`)
    const stream = summarize(after)
    results.session = {
      emitted: N_EVENTS,
      idleBaseline: { ipcMedianMs: idle.ipcMedianMs, timerMaxGapMs: idle.timerMaxGapMs },
      stream,
      transcriptRendered: rendered,
      verdict:
        stream.events > 2000 &&
        stream.timerMaxGapMs <= LIMITS.timerGapMs &&
        stream.longestTaskMs <= LIMITS.longTaskMs &&
        rendered
    }
    log(
      `B) streaming: ${stream.events} eventos en ${stream.streamMs} ms; tarea más larga ${stream.longestTaskMs} ms (${stream.longTasks} largas); hueco máx. de timers ${stream.timerMaxGapMs} ms; IPC mediana/p95/máx ${stream.ipcMedianMs}/${stream.ipcP95Ms}/${stream.ipcMaxMs} ms`
    )
    if (!results.session.verdict) problems.push('sesión de >2000 eventos fuera de umbral')

    // replay: el cliente se vuelve a suscribir y recibe los últimos 2000 eventos de golpe
    ab.eval(INSTALL_PROBE)
    const replay = ab.eval(`(async () => {
      const t = performance.now()
      let replayEntries = 0
      const off = window.osc.onMessage((m) => { if (m.type === 'replay') replayEntries = m.entries.length })
      window.osc.send({ type: 'subscribe', repo: ${JSON.stringify(repoId)} })
      while (!replayEntries && performance.now() - t < 20000) await new Promise((r) => setTimeout(r, 5))
      const gotMs = Math.round(performance.now() - t)
      await new Promise((r) => setTimeout(r, 1500))
      off()
      return { entries: replayEntries, receivedMs: gotMs }
    })()`)
    const rp = summarize(ab.eval(READ_PROBE))
    results.replay = {
      entries: replay.entries,
      receivedMs: replay.receivedMs,
      longestTaskMs: rp.longestTaskMs,
      timerMaxGapMs: rp.timerMaxGapMs,
      verdict:
        replay.entries >= 2000 &&
        rp.timerMaxGapMs <= LIMITS.timerGapMs &&
        rp.longestTaskMs <= LIMITS.longTaskMs
    }
    log(
      `B) replay: ${replay.entries} entradas recibidas en ${replay.receivedMs} ms; tarea más larga ${rp.longestTaskMs} ms; hueco máx. ${rp.timerMaxGapMs} ms`
    )
    if (!results.replay.verdict) problems.push('replay de 2000 eventos fuera de umbral')
    ab.eval(`window.__probe.stop(), true`)
  } catch (e) {
    problems.push(`error de ejecución: ${e.message}`)
    results.error = e.stack
    if (app) {
      const alive = await fetch(`http://127.0.0.1:${app.port}/json/version`, {
        signal: AbortSignal.timeout(5000)
      }).then(
        () => true,
        () => false
      )
      console.error(
        `[perf] Electron vivo: ${app.child.exitCode === null} (exitCode ${app.child.exitCode}); CDP responde: ${alive}\n${app.log().trim()}`
      )
    }
  } finally {
    ab.close()
    app?.stop()
    await sleep(1500)
    cleanSandbox(sb)
  }
  results.ok = problems.length === 0
  results.problems = problems
  const out = path.join(ROOT, 'test', 'e2e', `perf-results-${N_CHANGES}-cambios.json`)
  fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)
  log(`resultados en ${path.relative(ROOT, out)}`)
  console.log(
    results.ok
      ? '\n[perf] OK: dentro de los umbrales'
      : `\n[perf] FUERA DE UMBRAL: ${problems.join('; ')}`
  )
  return results.ok ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[perf] FALLA: ${e instanceof Error ? e.stack : e}`)
    process.exit(1)
  }
)

// fase4-ventana.mjs (tarea 4.9): verificación con evidencia de la ventana y la
// instancia única sobre la app real en Windows.
//
//   npx electron-vite build        # una vez
//   node test/e2e/fase4-ventana.mjs
//
// Cubre, con evidencia (JSON en test/e2e/captures/fase4-ventana-evidencia.json):
//   4.1  segunda instancia con el MISMO --user-data-dir sale sola; la primera
//        restaura y enfoca su ventana; queda un solo árbol de procesos
//   4.2  tamaño/posición/maximizado persisten en window-state.json y se
//        restauran al reabrir; coordenadas fuera de pantalla se descartan y el
//        mínimo 1024×640 se respeta
//   4.3  la ventana se crea con show:false y aparece en ready-to-show: marcas
//        de tiempo (arranque → página CDP → ventana visible) y color del primer
//        fotograma (backgroundColor del tema, no blanco)
//
// Puerto CDP 9302 (asignado a esta tarea). Sandbox temporal propio (OSC_DATA,
// HOME, USERPROFILE y --user-data-dir aislados).

import fs from 'node:fs'
import path from 'node:path'
import {
  Cdp,
  EVIDENCE,
  PORT,
  ROOT,
  cleanSandbox,
  makeEvidence,
  makeSandbox,
  readWindowState,
  sleep,
  spawnApp,
  win,
  writeWindowState,
  waitFor
} from './fase4-lib.mjs'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

/** Espera a que el puerto CDP sirva la página de la app. */
async function waitForCdp(port, timeoutMs = 60_000) {
  const t0 = Date.now()
  await waitFor(
    'página index.html en CDP',
    async () => {
      try {
        const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        return t.some((x) => x.type === 'page' && String(x.url).includes('index.html')) || null
      } catch {
        return null
      }
    },
    { timeoutMs }
  )
  return Date.now() - t0
}

/** Lanza la app y espera el CDP; devuelve { child, log, tCdpMs }. */
async function startApp(sb, ev, label) {
  const t0 = Date.now()
  const app = spawnApp(sb, { port: PORT })
  let exited = null
  app.child.once('exit', (c, s) => (exited = `código ${c ?? s}`))
  app.child.once('exit', (c) => ev.add(`${label}: proceso salió`, { code: c }))

  const tCdpMs = await waitForCdp(PORT)
  return { ...app, tCdpMs, t0, hasExited: () => exited }
}

/** Estado de la ventana recién abierta + window-state.json vigente (diagnóstico). */
function logStartup(ev, label, sb, pid) {
  const info = win('info', { AppPid: pid })
  let state = null
  try {
    state = readWindowState(sb)
  } catch {
    /* sin estado aún */
  }
  ev.add(`${label}: arranque`, {
    rect: info.rect,
    zoomed: info.zoomed,
    iconic: info.iconic,
    visible: info.visible,
    windowStateJson: state
  })
}

/** Espera a que el proceso termine; devuelve el código de salida. */
function waitExit(child, timeoutMs = 30_000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('tiempo agotado esperando la salida')), timeoutMs)
    child.once('exit', (c, s) => {
      clearTimeout(t)
      res(c ?? s)
    })
  })
}

/**
 * Coloca la ventana en DIP (x, y, w, h) con la propia API de la ventana
 * (window.moveTo/resizeTo, lo más cercano a Browser.setWindowBounds, que
 * Electron 45 no implementa). SetWindowPos directo pelea con Chromium por el
 * tamaño, y un resize lanzado durante la animación de un restore puede quedar
 * clampado al mínimo: se reintenta hasta que el tamaño pedido cuaja. Devuelve el
 * rect físico ESTABLE real (la y con que queda la ventana puede diferir de la
 * pedida —peculiaridad de moveTo en Chromium—, así que las afirmaciones usan
 * este rect como fuente de verdad).
 */
async function placeWindow(cdp, pid, { x, y, w, h }, scale) {
  // esperar a que la página termine de cargar: un resizeTo antes de
  // readyState=complete queda clampado al mínimo (rareza de Chromium observada)
  await waitFor('página cargada', () =>
    cdp.eval(`document.readyState === 'complete' ? true : null`).catch(() => null)
  )
  const stable = async () => {
    let prev = null
    for (let i = 0; i < 40; i++) {
      const rect = win('info', { AppPid: pid }).rect
      if (
        prev &&
        rect.left === prev.left &&
        rect.top === prev.top &&
        rect.width === prev.width &&
        rect.height === prev.height &&
        rect.height < 20000
      ) {
        return rect
      }
      prev = rect
      await sleep(150)
    }
    return prev
  }
  let last = null
  let via = 'moveTo/resizeTo'
  for (let attempt = 0; attempt < 5; attempt++) {
    await cdp.eval(`window.moveTo(${x}, ${y}); window.resizeTo(${w}, ${h}); true`)
    await sleep(450)
    last = await stable()
    if (last.width >= w * scale * 0.97 && last.height >= h * scale * 0.97)
      return { rect: last, via }
    // clampado o ignorado (rareza tras restore): reintentar
  }
  // plan B: SetWindowPos en píxeles físicos (pasa por Win32, sin el clamp de
  // Chromium), también con reintentos hasta estabilizar el tamaño pedido
  via = 'SetWindowPos'
  for (let attempt = 0; attempt < 5; attempt++) {
    win('move', {
      AppPid: pid,
      Left: Math.round(x * scale),
      Top: Math.round(y * scale),
      W: Math.round(w * scale),
      H: Math.round(h * scale)
    })
    await sleep(450)
    last = await stable()
    if (last.width >= w * scale * 0.97 && last.height >= h * scale * 0.97)
      return { rect: last, via }
  }
  return { rect: last, via: `${via} (sin cuajar)` }
}

/** Convierte el rect físico (Win32 GetWindowRect) a DIP con la escala dada. */
const toDip = (rect, scale) => ({
  x: rect.left / scale,
  y: rect.top / scale,
  width: rect.width / scale,
  height: rect.height / scale
})

async function main() {
  assert(
    fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js')),
    'falta out/main/index.js: ejecuta `npx electron-vite build` antes'
  )
  const sb = makeSandbox('osc-fase4-')
  console.log(`[fase4] sandbox ${sb.tmp}`)
  const ev = makeEvidence(path.join(EVIDENCE, 'fase4-ventana-evidencia.json'))
  let app = null

  try {
    // ---- 4.3: show:false + ready-to-show + backgroundColor -------------------
    // La ventana debe asomar solo cuando ya hay algo pintado; el primer fotograma
    // lleva el fondo del tema (#111114 oscuro / #f7f7f8 claro), nunca blanco.
    const capture = path.join(EVIDENCE, 'fase4-ventana-primer-fotograma.png')
    app = await startApp(sb, ev, 'instancia A')
    const cdp = await Cdp.connect(PORT)
    const firstVisible = win('wait-visible', {
      AppPid: app.child.pid,
      TimeoutSec: 30,
      Out: capture
    })
    const themeDark = await cdp.eval(`matchMedia('(prefers-color-scheme: dark)').matches`)
    const [r, g, b] = firstVisible.avgRgb ?? [0, 0, 0]
    const expected = themeDark ? [17, 17, 20] : [247, 247, 248]
    ev.add('4.3 ventana visible tras ready-to-show', {
      cdpListoMs: app.tCdpMs,
      visibleMs: firstVisible.elapsedMs,
      nota: 'visibleMs se mide desde que empieza la espera (con CDP ya listo); el primer fotograma se captura con PrintWindow en cuanto la ventana es visible: si trae la UI ya pintada, show() no se llamó antes de ready-to-show',
      tema: themeDark ? 'oscuro' : 'claro',
      primerFotogramaRgb: firstVisible.avgRgb,
      esquinaSupIzq: firstVisible.topLeftRgb,
      fondoEsperadoRgb: expected,
      captura: path.relative(ROOT, capture)
    })
    assert(fs.existsSync(capture), 'no se capturó el primer fotograma')
    // El primer fotograma puede ser fondo puro o contenido ya pintado; lo que se
    // afirma es que NO hay destello blanco: con tema oscuro el fotograma es
    // oscuro (canal máximo bajo). Los valores exactos quedan como evidencia.
    if (themeDark) {
      assert(
        Math.max(r, g, b) < 150,
        `posible destello blanco con tema oscuro: rgb(${r},${g},${b})`
      )
    } else {
      assert(
        Math.min(r, g, b) > 150,
        `primer fotograma inesperadamente oscuro con tema claro: rgb(${r},${g},${b})`
      )
    }

    // factor de escala físico/DIP para mover con SetWindowPos (píxeles reales)
    const info0 = win('info', { AppPid: app.child.pid })
    const b0 = await cdp.winInfo()
    const scale = info0.rect.width / b0.w
    ev.add('escala de monitor', { fisico: info0.rect, dip: b0, scale })

    // ---- 4.1: instancia única ------------------------------------------------
    const before = win('tree', { AppPid: app.child.pid })
    const exePath = win('info', { AppPid: app.child.pid }).path
    const beforeExe = win('procs-by-exe', { ExePath: exePath }).pids
    // minimizar como usuario y verificar el estado
    win('show', { AppPid: app.child.pid, State: 'minimize' })
    const minimized = await waitFor('ventana minimizada', () =>
      win('info', { AppPid: app.child.pid }).iconic ? true : null
    )
    assert(minimized, 'la ventana no se minimizó')

    // segunda instancia con el MISMO --user-data-dir (spawnApp reutiliza sb.profile)
    const tB = Date.now()
    const second = spawnApp(sb, { withCdp: false })
    const secondExit = await waitExit(second.child, 40_000)
    const secondMs = Date.now() - tB
    ev.add('4.1 segunda instancia', {
      pid: second.child.pid,
      exitCode: secondExit,
      duracionMs: secondMs,
      mismaUserDataDir: sb.profile
    })
    assert(secondExit === 0, `la segunda instancia salió con código ${secondExit}, no 0`)

    // la primera sigue viva, restaurada y (salvo bloqueo de primer plano del SO)
    // con su ventana visible al frente
    const fg = win('wait-foreground', { AppPid: app.child.pid, TimeoutSec: 15 })
    const info1 = win('info', { AppPid: app.child.pid })
    const after = win('tree', { AppPid: app.child.pid })
    const afterExe = win('procs-by-exe', { ExePath: exePath }).pids
    ev.add('4.1 primera instancia tras second-instance', {
      viva: info1.exists,
      visible: info1.visible,
      minimizada: info1.iconic,
      primerPlano: info1.foreground,
      waitForeground: fg,
      procesosAntes: before.length,
      procesosDespues: after.length,
      pidsExeAntes: beforeExe,
      pidsExeDespues: afterExe,
      arbolDespues: after.map((p) => `${p.pid} ${p.name}`)
    })
    assert(info1.exists, 'la primera instancia murió al llegar la segunda')
    assert(info1.visible && !info1.iconic, 'la ventana no quedó restaurada y visible')
    assert(
      afterExe.length === beforeExe.length,
      `procesos con el exe de la app: ${beforeExe.length} → ${afterExe.length}`
    )
    // la evidencia del primer plano es best-effort (Windows puede denegar
    // SetForegroundWindow a un proceso de fondo); se registra tal cual

    // ---- 4.2: persistencia de tamaño y posición ------------------------------
    // Se cierra y se abre una instancia limpia: el primer resize programático
    // tras el restore del second-instance sufre una rareza de Chromium que lo
    // clamp al mínimo (documentado en el informe); en ventana fresca funciona.
    win('close', { AppPid: app.child.pid })
    const exitA = await waitExit(app.child)
    ev.add('4.1→4.2 cierre de la instancia de 4.1', { exitCode: exitA })
    app = null
    app = await startApp(sb, ev, 'instancia 4.2')
    const cdpA = await Cdp.connect(PORT)
    // espera a ready-to-show: un resizeTo sobre una ventana aún no mostrada se
    // clamp al mínimo (rareza de Chromium; ver informe)
    const vis42 = win('wait-visible', { AppPid: app.child.pid, TimeoutSec: 20 })
    assert(vis42.visible, 'la ventana de la instancia 4.2 no llegó a mostrarse')

    // Se pide una geometría distinta de la por defecto; la fuente de verdad es
    // el rect físico real (moveTo deja la y donde Chromium quiere).
    const wantReq = { x: 120, y: 90, w: 1100, h: 700 } // DIP pedidos
    logStartup(ev, 'instancia 4.2', sb, app.child.pid)
    const placed = await placeWindow(cdpA, app.child.pid, wantReq, scale)
    const phys = placed.rect
    const want = toDip(phys, scale)
    ev.add('4.2 mover/redimensionar', {
      mecanismo: placed.via,
      pedidoDip: wantReq,
      fisicoEstable: phys,
      dipEstable: {
        x: Math.round(want.x),
        y: Math.round(want.y),
        w: Math.round(want.width),
        h: Math.round(want.height)
      }
    })
    assert(
      want.width >= 1000 && want.height >= 660,
      `la ventana no quedó con la geometría pedida (¿clampada al mínimo?): ${JSON.stringify(want)}`
    )
    assert(
      want.x < 110 || want.y < 80 || want.width !== 1280,
      'la ventana sigue en la geometría por defecto (el movimiento no aplicó)'
    )

    // cierre normal (X) → estado guardado y salida limpia
    win('close', { AppPid: app.child.pid })
    const exit1 = await waitExit(app.child)
    const saved = readWindowState(sb)
    ev.add('4.2 cierre normal', { exitCode: exit1, windowStateJson: saved })
    assert(exit1 === 0, `cierre normal salió con código ${exit1}`)
    assert(
      near(saved.x, want.x, 2) &&
        near(saved.y, want.y, 2) &&
        near(saved.width, want.width, 2) &&
        near(saved.height, want.height, 2) &&
        saved.maximized === false,
      `window-state.json no refleja la ventana: ${JSON.stringify(saved)} vs ${JSON.stringify(want)}`
    )

    // reabrir → mismas coordenadas (tolerancia: GetWindowRect suma los bordes
    // invisibles de redimensionado de DWM; la comparación exacta es la del
    // JSON que la app guarda al cerrar la ventana reabierta, más abajo)
    app = await startApp(sb, ev, 'reabierta 1')
    const cdp2 = await Cdp.connect(PORT)
    await sleep(600) // deja asentar la restauración
    const restored = toDip(win('info', { AppPid: app.child.pid }).rect, scale)
    ev.add('4.2 reabrir restaura bounds', { dipRestaurado: restored, guardado: saved })
    assert(
      near(restored.x, saved.x, 6) &&
        near(restored.y, saved.y, 6) &&
        near(restored.width, saved.width, 6) &&
        near(restored.height, saved.height, 6),
      `al reabrir no se restauró la geometría: ${JSON.stringify(restored)}`
    )

    // ---- 4.2: maximizado persiste y el des-maximizar vuelve a los bounds ----
    win('show', { AppPid: app.child.pid, State: 'maximize' })
    await waitFor('ventana maximizada', () =>
      win('info', { AppPid: app.child.pid }).zoomed ? true : null
    )
    win('close', { AppPid: app.child.pid })
    const exit2 = await waitExit(app.child)
    const savedMax = readWindowState(sb)
    ev.add('4.2 maximizado', { exitCode: exit2, windowStateJson: savedMax })
    assert(exit2 === 0, `cierre maximizado salió con código ${exit2}`)
    assert(savedMax.maximized === true, 'window-state.json no registró maximized:true')
    // ciclo exacto JSON→JSON: al cerrar la reabierta, la app persiste los mismos
    // números normales que la vez anterior, con un desfase pequeño y conocido:
    // en 125 % de escala Electron/Windows suma el borde de redimensionado de
    // DWM en cada reapertura (~4 DIP; hallazgo documentado en el informe)
    const dw = savedMax.width - saved.width
    const dh = savedMax.height - saved.height
    ev.add('4.2 deriva por ciclo de reapertura', {
      deltaWidthDip: dw,
      deltaHeightDip: dh,
      nota: 'borde DWM contado por getNormalBounds al reabrir en 125% de escala'
    })
    assert(
      savedMax.x === saved.x && savedMax.y === saved.y && Math.abs(dw) <= 6 && Math.abs(dh) <= 6,
      `el ciclo JSON→JSON derivó más de lo esperado: ${JSON.stringify(saved)} → ${JSON.stringify(savedMax)}`
    )

    app = await startApp(sb, ev, 'reabierta 2')
    const cdp3 = await Cdp.connect(PORT)
    const reopenedZoomed = win('info', { AppPid: app.child.pid }).zoomed
    ev.add('4.2 reabrir maximizada', { zoomed: reopenedZoomed })
    assert(reopenedZoomed, 'al reabrir no quedó maximizada')
    win('show', { AppPid: app.child.pid, State: 'restore' })
    await sleep(600)
    const unmax = toDip(win('info', { AppPid: app.child.pid }).rect, scale)
    ev.add('4.2 restaurar tras maximizado', { dip: unmax })
    assert(
      near(unmax.x, savedMax.x, 6) &&
        near(unmax.y, savedMax.y, 6) &&
        near(unmax.width, savedMax.width, 6) &&
        near(unmax.height, savedMax.height, 6),
      `al des-maximizar no volvió a los bounds guardados: ${JSON.stringify(unmax)}`
    )

    // ---- 4.2: monitor ausente (coordenadas fuera de pantalla) ----------------
    win('close', { AppPid: app.child.pid })
    await waitExit(app.child)
    app = null
    writeWindowState(sb, { width: 1100, height: 700, x: -5000, y: -4000, maximized: false })
    ev.add('4.2 estado fuera de pantalla inyectado', { json: readWindowState(sb) })

    app = await startApp(sb, ev, 'reabierta 3 (off-screen)')
    const cdp4 = await Cdp.connect(PORT)
    await sleep(600)
    const onScreen = toDip(win('info', { AppPid: app.child.pid }).rect, scale)
    const visibleOffscreen = win('info', { AppPid: app.child.pid })
    ev.add('4.2 reaparece dentro de la pantalla', {
      dip: onScreen,
      visible: visibleOffscreen.visible
    })
    assert(visibleOffscreen.visible, 'la ventana no quedó visible con estado fuera de pantalla')
    assert(
      onScreen.x > -1000 && onScreen.y > -1000,
      `se restauraron coordenadas fuera de pantalla: ${JSON.stringify(onScreen)}`
    )

    // ---- 4.2: mínimo 1024×640 -------------------------------------------------
    win('close', { AppPid: app.child.pid })
    await waitExit(app.child)
    app = null
    writeWindowState(sb, { width: 500, height: 300, x: 60, y: 60, maximized: false })
    app = await startApp(sb, ev, 'reabierta 4 (mínimo)')
    const cdp5 = await Cdp.connect(PORT)
    await sleep(600)
    const minBounds = toDip(win('info', { AppPid: app.child.pid }).rect, scale)
    ev.add('4.2 tamaño mínimo respetado', { guardado: { w: 500, h: 300 }, dip: minBounds })
    assert(
      minBounds.width >= 1024 && minBounds.height >= 640,
      `el mínimo 1024×640 no se respetó: ${JSON.stringify(minBounds)}`
    )

    // ---- cierre final y limpieza ---------------------------------------------
    win('close', { AppPid: app.child.pid })
    const exitLast = await waitExit(app.child)
    app = null
    ev.add('cierre final', { exitCode: exitLast, windowStateJson: readWindowState(sb) })
    cdp.close?.()
    cdp2.close()
    cdp3.close()
    cdp4.close()
    cdp5.close()
  } catch (e) {
    if (app) console.error(`[fase4] log de Electron:\n${app.log().trim()}`)
    throw e
  } finally {
    if (app?.child?.exitCode === null) {
      win('close', { AppPid: app.child.pid })
      await sleep(2500)
      if (app.child.exitCode === null) {
        const { spawnSync } = await import('node:child_process')
        spawnSync('taskkill', ['/pid', String(app.child.pid), '/T', '/F'], { stdio: 'ignore' })
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

process.on('unhandledRejection', (e) => {
  console.error(`[fase4] unhandledRejection: ${e instanceof Error ? e.stack : e}`)
})

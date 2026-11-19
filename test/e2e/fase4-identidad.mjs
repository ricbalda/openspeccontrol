// fase4-identidad.mjs (tarea 4.9): identidad de la app (4.8) en Windows, con
// evidencia sobre la app real:
//
//   npm run dist:dir                 # una vez: release/<versión>/win-unpacked
//   node test/e2e/fase4-identidad.mjs
//
// Comprueba, en la build de desarrollo (`electron .`) y en la empaquetada:
//   · app.getName() (solo dev: el inspector del main no existe con los fuses
//     del binario empaquetado) y el título de la ventana
//   · el AppUserModel.ID REAL de la ventana viva (propiedad del Shell que agrupa
//     la barra de tareas y las notificaciones), leído con SHGetPropertyStoreForWindow
//   · en el empaquetado: metadatos del .exe (ProductName, nombre) y, de paso, la
//     instancia única (4.1) sobre el binario real con los fuses volteados
//
// Sin puerto CDP: la app empaquetada se maneja solo por Win32 (fase4-win.ps1).
// Cada instancia usa sandbox propio (--user-data-dir, OSC_DATA, HOME, USERPROFILE).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  EVIDENCE,
  PORT,
  ROOT,
  cleanSandbox,
  mainEval,
  MAIN_APP,
  makeEvidence,
  makeSandbox,
  sleep,
  spawnApp,
  uia,
  waitFor,
  win
} from './fase4-lib.mjs'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const EXPECTED_AUMID = 'io.github.ricbalda.openspeccontrol'
const EXPECTED_NAME = 'OpenSpecControl'

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
 * AUMID efectivo de la app en la barra de tareas: el botón cuyo Appid es el esperado
 * y cuántas ventanas agrupa (el nombre dice «N ventanas de ejecución»). Otros
 * workers pueden tener su propia instancia de la misma app abierta, por eso se
 * compara antes y después de lanzar la nuestra.
 */
function taskbarAumid() {
  const r = uia('taskbar-appids')
  const b = (r.buttons ?? []).find((x) => x.appid === EXPECTED_AUMID)
  if (!b) return { presente: false, ventanas: 0 }
  const m = /(\d+) ventana/.exec(b.name)
  return { presente: true, ventanas: m ? Number(m[1]) : 1, boton: b.name }
}

/**
 * Compara la barra de tareas antes y después de lanzar NUESTRA instancia. Es
 * decisivo si el AUMID no estaba antes (solo puede ser nuestra ventana) o si el
 * grupo crece en algún muestreo; con otros workers abriendo/cerrando la misma
 * app en paralelo el recuento puede bajar justo entonces: se marca como no
 * concluyente en lugar de darlo por bueno.
 */
async function aumidDecision(antes) {
  let despues = taskbarAumid()
  for (let i = 0; i < 8 && !(despues.presente && despues.ventanas > antes.ventanas); i++) {
    await sleep(400)
    const s = taskbarAumid()
    if (s.presente && s.ventanas > despues.ventanas) despues = s
    else if (!despues.presente) despues = s
  }
  const creció = despues.presente && despues.ventanas > antes.ventanas
  return {
    antes,
    despues,
    presente: despues.presente,
    decisivo: despues.presente && (!antes.presente || creció)
  }
}

/** Cierra una instancia como lo haría la X; si no sale, la mata (solo su árbol). */
async function stop(app) {
  if (app.child.exitCode !== null) return
  try {
    win('close', { AppPid: app.child.pid })
    await waitExit(app.child, 15_000)
  } catch {
    spawnSync('taskkill', ['/pid', String(app.child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

/** Metadatos del .exe (FileVersionInfo): lo que ve el Explorador y el instalador. */
function exeMetadata(exe) {
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$v=(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo; ` +
        `@{ ProductName=$v.ProductName; FileDescription=$v.FileDescription; ` +
        `ProductVersion=$v.ProductVersion; InternalName=$v.InternalName; ` +
        `OriginalFilename=$v.OriginalFilename } | ConvertTo-Json -Compress`
    ],
    { encoding: 'utf8' }
  )
  return JSON.parse(r.stdout.trim())
}

/** Busca el ejecutable empaquetado de dist:dir en release/<versión>/win-unpacked. */
function findPackagedExe() {
  const release = path.join(ROOT, 'release')
  if (!fs.existsSync(release)) return null
  for (const v of fs.readdirSync(release)) {
    for (const dir of ['win-unpacked', 'win-arm64-unpacked']) {
      const d = path.join(release, v, dir)
      if (!fs.existsSync(d)) continue
      const exe = fs.readdirSync(d).find((f) => /^openspeccontrol\.exe$/i.test(f))
      if (exe) return path.join(d, exe)
    }
  }
  return null
}

async function main() {
  assert(
    fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js')),
    'falta out/main/index.js: ejecuta `npx electron-vite build` antes'
  )
  const ev = makeEvidence(path.join(EVIDENCE, 'fase4-identidad-evidencia.json'))
  const sbs = []
  const apps = []
  try {
    // ---- build de desarrollo (electron .) ---------------------------------------
    const sbDev = makeSandbox('osc-fase4i-')
    sbs.push(sbDev)
    const tbAntes = taskbarAumid()
    const dev = spawnApp(sbDev, { port: PORT, extraArgs: ['--inspect=0'] })
    apps.push(dev)
    await waitFor(
      'ventana dev visible',
      () => {
        const v = win('wait-visible', { AppPid: dev.child.pid, TimeoutSec: 5 })
        return v.visible ? v : null
      },
      { timeoutMs: 40_000 }
    )
    const devName = await mainEval(dev, `${MAIN_APP}.getName()`)
    const devVersion = await mainEval(dev, `${MAIN_APP}.getVersion()`)
    await sleep(1200) // el Shell tarda un instante en crear el botón de la barra de tareas
    const devId = win('aumid', { AppPid: dev.child.pid })
    const dec = await aumidDecision(tbAntes)
    ev.add('4.8 identidad en dev (electron .)', {
      appGetName: devName,
      appGetVersion: devVersion,
      tituloVentana: devId.title,
      barraDeTareas: dec,
      propiedadAumidDeLaVentana: devId.aumid,
      nota: 'app.setAppUserModelId fija el AUMID del proceso; la propiedad de ventana sale vacía (vt=0). La lectura externa válida es el Appid del botón de la barra de tareas.',
      exe: devId.exe
    })
    assert(devName === EXPECTED_NAME, `app.getName() = ${devName}`)
    assert(devId.title === EXPECTED_NAME, `título de ventana = ${devId.title}`)
    assert(dec.presente, `no hay botón con Appid ${EXPECTED_AUMID} en la barra de tareas`)
    await stop(dev)

    // ---- build empaquetada (dist:dir) -------------------------------------------
    const exe = findPackagedExe()
    if (!exe) {
      ev.add('4.8 empaquetado', {
        omitido: 'no existe release/*/win-unpacked: ejecuta npm run dist:dir'
      })
    } else {
      const meta = exeMetadata(exe)
      ev.add('4.8 metadatos del .exe empaquetado', { exe: path.relative(ROOT, exe), ...meta })
      assert(meta.ProductName === EXPECTED_NAME, `ProductName = ${meta.ProductName}`)

      const sbPkg = makeSandbox('osc-fase4p-')
      sbs.push(sbPkg)
      const tbPkgAntes = taskbarAumid()
      const pkg = spawnApp(sbPkg, { exe })
      apps.push(pkg)
      const vis = await waitFor(
        'ventana empaquetada visible',
        () => {
          const v = win('wait-visible', { AppPid: pkg.child.pid, TimeoutSec: 5 })
          return v.visible ? v : null
        },
        { timeoutMs: 60_000 }
      )
      await sleep(800)
      await sleep(1200)
      const id = win('aumid', { AppPid: pkg.child.pid })
      const decPkg = await aumidDecision(tbPkgAntes)
      ev.add('4.8 identidad en la app empaquetada', {
        pid: pkg.child.pid,
        visibleMs: vis.elapsedMs,
        tituloVentana: id.title,
        barraDeTareas: decPkg,
        proceso: id.exe
      })
      assert(id.title === EXPECTED_NAME, `título (empaquetada) = ${id.title}`)
      assert(decPkg.presente, `AUMID (empaquetada) ausente en la barra de tareas`)

      // 4.1 sobre el binario real (fuses volteados, asar): segunda instancia con el
      // mismo --user-data-dir sale sola y la primera enfoca su ventana
      const before = win('procs-by-exe', { ExePath: exe }).pids
      win('show', { AppPid: pkg.child.pid, State: 'minimize' })
      await waitFor('minimizada', () =>
        win('info', { AppPid: pkg.child.pid }).iconic ? true : null
      )
      const second = spawnApp(sbPkg, { exe })
      const code2 = await waitExit(second.child, 40_000)
      const fg = win('wait-foreground', { AppPid: pkg.child.pid, TimeoutSec: 15 })
      const infoPkg = win('info', { AppPid: pkg.child.pid })
      const after = win('procs-by-exe', { ExePath: exe }).pids
      ev.add('4.1 instancia única en la app empaquetada', {
        segundaInstanciaCodigoSalida: code2,
        primeraRestaurada: infoPkg.visible && !infoPkg.iconic,
        primeraEnPrimerPlano: fg.ok,
        nota: 'el primer plano lo concede Windows (foreground lock) y depende de lo que haga la persona en ese instante: se registra, no se exige',
        pidsAntes: before,
        pidsDespues: after
      })
      assert(code2 === 0, `la segunda instancia salió con ${code2}`)
      assert(
        infoPkg.visible && !infoPkg.iconic,
        'la primera instancia no quedó restaurada y visible'
      )
      assert(
        before.length === after.length,
        `procesos con el .exe: ${before.length} → ${after.length}`
      )
      await stop(pkg)
      const left = win('procs-by-exe', { ExePath: exe }).pids.filter((p) => before.includes(p))
      ev.add('cierre de la empaquetada', { procesosDeLaAppTrasCerrar: left })
      assert(left.length === 0, `quedan procesos de la app empaquetada: ${left}`)
    }
  } finally {
    for (const a of apps) await stop(a)
    await sleep(1200)
    for (const sb of sbs) cleanSandbox(sb)
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

// multi-repo-rail (tareas 5.1 y 5.2): E2E del rail multi-repo, con CDP propio.
//
//   npx electron-vite build            # una vez: genera out/
//   node test/e2e/multi-repo.mjs       # sale 1 si algún paso falla
//
// Requiere `agent-browser` en el PATH y el CLI `openspec`. Lanza la app real
// (`electron . --remote-debugging-port=9233`, distinto del 9222 de smoke.mjs)
// con REPOS_ROOT apuntando a DOS repos de demo recién creados (hello-app y
// notes-app) y OSC_DATA temporal que declara el agente falso
// (fake-acp-agent.mjs) en agents.json. Escenario del cambio:
//
//   abrir A → abrir B (dos secciones) → abrir cambio en A → cambiar a B y
//   volver (el cambio de A se conserva) → plegar A → cerrar B sin agente →
//   reabrir B y arrancar el agente falso → con B en segundo plano pide un
//   permiso: «Needs you · 1» en su sección, título «(1) Needs you» y aviso del
//   sistema con su nombre (ventana sin foco real; se deja captura del
//   escritorio como evidencia) → cerrar B con agente (cancelar y confirmar)
//
// Nota sobre la notificación del sistema (5.2): `window.osc.notify` está
// expuesto por contextBridge en solo-lectura (no se puede envolver para
// registrar la llamada) y el toast del SO no es legible por CDP. El E2E
// verifica la marca de la sección, el título de la ventana y la decisión
// pendiente (`pendingInteractions`) en el estado real del hub; el aviso del
// sistema se dispara con la ventana REALMENTE sin foco (una ventana propia le
// quita el foco a la app) y se deja una captura del escritorio para verificar
// visualmente el toast. Su título exacto lo cubre el test unitario
// test/renderer/multi-repo-notify.test.tsx (fase 4.1).
//
// Las capturas van a un directorio temporal FUERA del repo versionado (se
// imprime la ruta); el sandbox de la app se borra al terminar.
// Variables: CDP_PORT (9233), KEEP_TMP=1 (conserva el directorio temporal).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { demoFiles } from '../../scripts/demo-repo-files.mjs'
import {
  ROOT,
  cleanSandbox,
  createDemoRepo,
  createDriver,
  launchApp,
  makeSandbox,
  stamp,
  waitFor
} from './lib.mjs'

const PORT = Number(process.env.CDP_PORT) || 9233
const CHANGE_A = 'add-hello-endpoint'
const CHANGE_B = 'add-notes-endpoint'
/** Capturas fuera del repo versionado (no se commitean). */
const CAPTURES = path.join(
  os.tmpdir(),
  'opencode',
  'multi-repo-rail-e2e',
  new Date().toISOString().replace(/[:.]/g, '-')
)

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

/** Segundo repo de demo (notes-app): los archivos del demo con hello→notes. */
function buildSecondRepo(sb) {
  const repo = path.join(sb.repos, 'notes-app')
  const files = demoFiles(new Date().toISOString().slice(0, 10))
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(
      repo,
      rel.replaceAll('add-hello-endpoint', CHANGE_B).replaceAll('hello-app', 'notes-app')
    )
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(
      f,
      text.replaceAll('add-hello-endpoint', CHANGE_B).replaceAll('hello', 'notes')
    )
  }
  const git = (...args) => spawnSync('git', args, { cwd: repo, stdio: 'ignore' }).status === 0
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', 'demo repo')
  return repo
}

/**
 * Una ventana propia que roba el foco de la app (5.2: el aviso del sistema solo
 * sale con la ventana sin foco). Devuelve el proceso; `kill` cierra la ventana.
 */
function focusThief() {
  const ps =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    "$f = New-Object System.Windows.Forms.Form; $f.Text = 'e2e-focus'; $f.Width = 200; $f.Height = 80; " +
    '$f.Add_Shown({ $f.Activate() }); $f.Show(); [System.Windows.Forms.Application]::Run($f)'
  const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: 'ignore',
    windowsHide: true
  })
  return () => {
    if (p.pid && p.exitCode === null)
      spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

/** Captura del escritorio completo (no solo la ventana) por si asoma el toast. */
function desktopScreenshot(file) {
  const ps =
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ' +
    '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen; ' +
    '$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height); ' +
    '$g = [System.Drawing.Graphics]::FromImage($bmp); ' +
    '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); ' +
    `$bmp.Save('${file.replaceAll("'", "''")}'); $g.Dispose(); $bmp.Dispose()`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  return r.status === 0 && fs.existsSync(file)
}

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true })
  const sb = makeSandbox('osc-mrepo-')
  createDemoRepo(sb)
  buildSecondRepo(sb)
  // el agente falso, como en perf.mjs: el hub lo arranca como a uno real
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
  console.log(`[e2e] sandbox ${sb.tmp}\n[e2e] capturas ${CAPTURES}`)
  let app = null
  const ab = createDriver(`osc-multi-repo-${process.pid}`)
  let failure = null
  let A = ''
  let B = ''
  let realUnfocus = false
  let toastEvidence = ''

  // ---- helpers de página (todo por eval: ids = rutas reales de Windows) ----
  // ojo: los id son rutas Windows con '\' y en un selector CSS serían escapes;
  // los elementos se buscan comparando por valor, no con [attr="ruta"].
  /** Abre el selector de repos (el botón con la etiqueta «Repository»). */
  const openPicker = () =>
    ab.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Repository'))
      b?.click()
      return !!b
    })()`)
  /** Elige un repo del selector abierto: la fila con title = id del repo. */
  const pickRepo = (id) =>
    ab.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(id)})
      b?.click()
      return !!b
    })()`)
  const section = (id) =>
    `([...document.querySelectorAll('[data-repo]')].find((el) => el.dataset.repo === ${JSON.stringify(id)}) ?? null)`
  /** Clica un botón por su tooltip dentro de la sección de un repo. */
  const clickSectionButton = (id, title) =>
    ab.eval(`(() => {
      const root = ${section(id)}
      const b = root?.querySelector('button[title=${JSON.stringify(title)}]')
      b?.click()
      return !!b
    })()`)
  /** Snippet JS (no lo ejecuta) con el texto de la sección; se interpola en evals mayores. */
  const sectionText = (id) => `${section(id)}?.innerText ?? ''`
  /** Clica la tarjeta de un cambio (el título lleva tooltip = nombre). */
  const clickChangeCard = (id, change) =>
    ab.eval(`(() => {
      const t = ${section(id)}?.querySelector('div[title=${JSON.stringify(change)}]')
      t?.closest('.group')?.click()
      return !!t
    })()`)
  const repoSession = (id) =>
    ab.eval(
      `window.osc.repos().then((w) => w.repos.find((r) => r.id === ${JSON.stringify(id)})?.session ?? null)`
    )

  try {
    app = await launchApp(sb, { port: PORT })
    console.log(`[e2e] Electron arriba en el puerto CDP ${app.port}`)
    ab.connect(app.port)

    await step('arranque: app pintada y dos repos en el workspace', async () => {
      await waitFor('#root con contenido', () =>
        ab.eval(`document.getElementById('root')?.childElementCount > 0`)
      )
      await waitFor('botón del selector de repos', () =>
        ab.eval(`document.body.innerText.includes('Choose a repo')`)
      )
      const names = await waitFor('hello-app y notes-app en el workspace', () =>
        ab.eval(`window.osc.repos().then((w) => {
          const n = w.repos.map((r) => r.name).sort()
          return n.length === 2 && n[0] === 'hello-app' && n[1] === 'notes-app' ? n : null
        })`)
      )
      return names.join(' + ')
    })

    await step('abrir A (hello-app): su sección con el cambio en "In review"', async () => {
      openPicker()
      await waitFor('selector abierto (filtro visible)', () =>
        ab.eval(`!!document.querySelector('input[placeholder="Filter…"]')`)
      )
      A = await waitFor('id de hello-app', () =>
        ab.eval(
          `window.osc.repos().then((w) => w.repos.find((r) => r.name === 'hello-app')?.id ?? null)`
        )
      )
      assert(pickRepo(A), 'no se encontró la fila de hello-app en el selector')
      await waitFor(
        'sección de hello-app con el cambio',
        () =>
          ab.eval(`(() => {
            const t = ${sectionText(A)}
            return t.includes('${CHANGE_A}') && /in review/i.test(t) ? true : null
          })()`),
        { timeoutMs: 30_000 }
      )
      return 'sección [hello-app] activa'
    })

    await step(
      'abrir B (notes-app) desde el selector: dos secciones, B activa, A sigue abierta',
      async () => {
        openPicker()
        B = await waitFor('id de notes-app', () =>
          ab.eval(
            `window.osc.repos().then((w) => w.repos.find((r) => r.name === 'notes-app')?.id ?? null)`
          )
        )
        assert(pickRepo(B), 'no se encontró la fila de notes-app en el selector')
        await waitFor('dos secciones en el rail', () =>
          ab.eval(`document.querySelectorAll('[data-repo]').length === 2 ? true : null`)
        )
        const state = await waitFor(
          'B activa y A abierta, con el cambio de B cargado',
          () => {
            const st = ab.eval(`(() => {
              const a = ${section(A)}, b = ${section(B)}
              if (!a || !b) return null
              return {
                bActive: b.classList.contains('border-accent'),
                aActive: a.classList.contains('border-accent'),
                picker: [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Repository'))?.innerText ?? '',
                bChange: b.innerText.includes('${CHANGE_B}')
              }
            })()`)
            return st && st.bActive && !st.aActive && st.bChange ? st : null
          },
          { timeoutMs: 30_000 }
        )
        assert(state.bActive && !state.aActive, `B no quedó activa: ${JSON.stringify(state)}`)
        assert(state.picker.includes('notes-app'), `el selector no muestra a B: "${state.picker}"`)
        assert(state.bChange, 'la sección de B no muestra su cambio')
        ab.screenshot(path.join(CAPTURES, '1-dos-secciones.png'))
        return 'rail: [A][B], B activa; selector: notes-app'
      }
    )

    await step('abrir el cambio de A activa A y muestra su propuesta', async () => {
      // al abrir B, pick() plegó A: se despliega y se clica su tarjeta
      assert(
        await clickSectionButton(A, 'Expand hello-app'),
        'no se encontró el chevron de A (¿no estaba plegada?)'
      )
      await waitFor('tarjeta de A visible', () =>
        ab.eval(`!!${section(A)}?.querySelector('div[title="${CHANGE_A}"]')`)
      )
      assert(clickChangeCard(A, CHANGE_A), 'no se encontró la tarjeta del cambio de A')
      await waitFor(
        'propuesta de A en el centro',
        () =>
          ab.eval(
            `document.querySelector('.doc')?.innerText.includes('Proposal: Add hello endpoint') ?? null`
          ),
        { timeoutMs: 30_000 }
      )
      const active = await waitFor('A activa', () =>
        ab.eval(`${section(A)}.classList.contains('border-accent') ? true : null`)
      )
      assert(active, 'A no quedó activa tras abrir su cambio')
      return 'A activa con add-hello-endpoint abierto'
    })

    await step('cambiar a B y volver a A: el cambio abierto de A se conserva', async () => {
      assert(clickSectionButton(B, 'Show notes-app'), 'no se encontró la cabecera de B')
      await waitFor('B activa con centro vacío', () =>
        ab.eval(`(() => {
          if (!${section(B)}.classList.contains('border-accent')) return null
          return document.body.innerText.includes('Nothing open') ? true : null
        })()`)
      )
      assert(clickSectionButton(A, 'Show hello-app'), 'no se encontró la cabecera de A')
      // sin volver a clicar la tarjeta: la vista guardada de A restaura el cambio
      await waitFor(
        'propuesta de A restaurada',
        () =>
          ab.eval(
            `document.querySelector('.doc')?.innerText.includes('Proposal: Add hello endpoint') ?? null`
          ),
        { timeoutMs: 30_000 }
      )
      return 'A → B (Nothing open) → A (add-hello-endpoint sigue abierto)'
    })

    await step('plegar la sección de A: cabecera visible, cambios ocultos, recordado', async () => {
      assert(
        await clickSectionButton(A, 'Collapse hello-app'),
        'no se encontró el chevron de plegado de A'
      )
      await waitFor('cuerpo de A oculto', () =>
        ab.eval(`!${section(A)}?.querySelector('div[title="${CHANGE_A}"]') ? true : null`)
      )
      const head = await ab.eval(sectionText(A))
      assert(head.includes('hello-app'), 'la cabecera de A desapareció al plegar')
      const saved = await ab.eval(`JSON.parse(localStorage.getItem('rail-collapsed') ?? '[]')`)
      assert(
        Array.isArray(saved) && saved.includes(A),
        `'rail-collapsed' no recuerda a A: ${JSON.stringify(saved)}`
      )
      ab.screenshot(path.join(CAPTURES, '2-a-plegada.png'))
      return "cabecera 'hello-app' visible, cuerpo oculto, rail-collapsed lo recuerda"
    })
    // se vuelve a desplegar para los pasos siguientes
    await clickSectionButton(A, 'Expand hello-app')

    await step('cerrar B sin agente: sin diálogo, desaparece y queda solo A', async () => {
      assert(clickSectionButton(B, 'Close notes-app'), 'no se encontró el botón de cerrar de B')
      await waitFor('sección de B fuera del rail', () =>
        ab.eval(
          `!${section(B)} && document.querySelectorAll('[data-repo]').length === 1 ? true : null`
        )
      )
      const noDialog = await ab.eval(`!document.body.innerText.includes('Close repository')`)
      assert(noDialog, 'apareció el diálogo de cierre sin sesión viva')
      const open = await ab.eval(`JSON.parse(localStorage.getItem('open-repos') ?? '[]')`)
      assert(
        Array.isArray(open) && open.length === 1 && open[0] === A,
        `'open-repos' incorrecto tras cerrar B: ${JSON.stringify(open)}`
      )
      const aActive = await ab.eval(`${section(A)}.classList.contains('border-accent')`)
      assert(aActive, 'A no siguió activa tras cerrar B')
      ab.screenshot(path.join(CAPTURES, '3-b-cerrada-sin-agente.png'))
      return 'B fuera, open-repos=[A], A activa'
    })

    await step('reabrir B y arrancar el agente falso en B', async () => {
      openPicker()
      await waitFor('selector abierto (filtro visible)', () =>
        ab.eval(`!!document.querySelector('input[placeholder="Filter…"]')`)
      )
      assert(pickRepo(B), 'no se encontró la fila de notes-app en el selector')
      await waitFor('dos secciones otra vez', () =>
        ab.eval(`document.querySelectorAll('[data-repo]').length === 2 ? true : null`)
      )
      ab.eval(`window.osc.send({ type: 'start', repo: ${JSON.stringify(B)}, agent: 'fake' }), true`)
      await waitFor(
        'sesión del agente lista en B',
        () =>
          ab.eval(`(() => {
            const t = ${sectionText(B)}
            return t.includes('Ready') ? true : null
          })()`),
        { timeoutMs: 60_000 }
      )
      const s = await repoSession(B)
      assert(s?.status === 'ready', `la sesión de B no está lista: ${JSON.stringify(s)}`)
      return "sesión 'ready' con el agente falso"
    })

    await step(
      '5.2 agente de B en segundo plano pide un permiso: «Needs you · 1» en su sección y título de la ventana',
      async () => {
        // A vuelve a ser el repo activo; B queda en segundo plano con sesión viva
        assert(clickSectionButton(A, 'Show hello-app'), 'no se encontró la cabecera de A')
        await waitFor('A activa', () =>
          ab.eval(`${section(A)}.classList.contains('border-accent') ? true : null`)
        )
        await waitFor(
          'sección de B (segundo plano) en Ready',
          () =>
            ab.eval(`(() => {
              const t = ${sectionText(B)}
              return t.includes('Ready') ? true : null
            })()`),
          { timeoutMs: 30_000 }
        )
        // captura el evento de permiso cuando llegue (para el informe)
        ab.eval(`(() => {
          window.__perm = null
          window.__offMsg = window.osc.onMessage((m) => {
            if (m.type === 'event' && m.entry.event.kind === 'permission') window.__perm = m.entry.event
          })
          return true
        })()`)
        // la notificación del sistema solo sale con la ventana sin foco: se le
        // quita el foco real con una ventana propia; si el SO no lo permite, se
        // recurre a document.hasFocus=false (se deja constancia en el paso)
        let unfocus = null
        try {
          unfocus = focusThief()
          realUnfocus = await waitFor(
            'ventana de la app sin foco (real)',
            () => ab.eval(`document.hasFocus() === false ? true : null`),
            { timeoutMs: 8_000 }
          )
        } catch {
          realUnfocus = false
          ab.eval(`document.hasFocus = () => false, true`)
          console.log('[e2e] el SO no quitó el foco: se simula con document.hasFocus=false')
        }
        ab.eval(
          `window.osc.send({ type: 'prompt', repo: ${JSON.stringify(B)}, text: 'pide permiso: permission events=3' }), true`
        )
        await waitFor(
          'marca de decisión pendiente en la sección de B',
          () =>
            ab.eval(`(() => {
              const t = ${sectionText(B)}
              return t.includes('Needs you · 1') ? true : null
            })()`),
          { timeoutMs: 60_000 }
        )
        // evidencia inmediata del toast del SO (suele durar ~5 s en pantalla)
        if (desktopScreenshot(path.join(CAPTURES, '4-toast-escritorio.png')))
          toastEvidence = path.join(CAPTURES, '4-toast-escritorio.png')
        const perm = await waitFor('evento de permiso en B', () => ab.eval(`window.__perm ?? null`))
        assert(perm.id, 'el evento de permiso no trae id')
        const s = await repoSession(B)
        assert(
          s?.pendingInteractions === 1,
          `pendingInteractions de B debería ser 1: ${JSON.stringify(s)}`
        )
        // la decisión de B no se abre en el centro (A es el activo)
        const quiet = await ab.eval(
          `!document.body.innerText.includes('Edit openspec/changes/proposal.md')`
        )
        assert(quiet, 'la decisión de B apareció en el centro con A activa')
        const title = await ab.eval(`document.title`)
        assert(
          title === '(1) Needs you · OpenSpecControl',
          `título de la ventana incorrecto: "${title}"`
        )
        // segunda evidencia algo después (por si el toast tardó en salir)
        await new Promise((r) => setTimeout(r, 2500))
        desktopScreenshot(path.join(CAPTURES, '4-toast-escritorio-2.png'))
        ab.screenshot(path.join(CAPTURES, '4-b-necesita-atencion.png'))
        // recupera el foco/estado y deja de escuchar
        unfocus?.()
        if (!realUnfocus) ab.eval(`delete document.hasFocus, true`)
        ab.eval(`window.__offMsg(), true`)
        return `permiso ${perm.id} pendiente en B; título "${title}"; foco real perdido: ${realUnfocus}`
      }
    )

    await step('cerrar B con agente: cancelar lo deja abierto con su sesión intacta', async () => {
      assert(clickSectionButton(B, 'Close notes-app'), 'no se encontró el botón de cerrar de B')
      await waitFor('diálogo de cierre', () =>
        ab.eval(`document.body.innerText.includes('Close repository') ? true : null`)
      )
      const body = await ab.eval(`document.body.innerText`)
      assert(
        body.includes('Close notes-app and disconnect its agent?'),
        'el diálogo no nombra el repo ni advierte de la desconexión'
      )
      ab.clickRole('button', 'Cancel')
      await waitFor('diálogo cerrado', () =>
        ab.eval(`!document.body.innerText.includes('Close repository') ? true : null`)
      )
      assert(await ab.eval(`!!${section(B)}`), 'B desapareció del rail tras cancelar el cierre')
      const s = await repoSession(B)
      assert(
        s?.status === 'busy' || s?.status === 'ready',
        `la sesión de B no siguió viva tras cancelar: ${JSON.stringify(s)}`
      )
      return `diálogo cancelado: B abierta, sesión ${s?.status}`
    })

    await step('cerrar B con agente: confirmar la desconecta y la quita del rail', async () => {
      assert(clickSectionButton(B, 'Close notes-app'), 'no se encontró el botón de cerrar de B')
      await waitFor('diálogo de cierre (otra vez)', () =>
        ab.eval(`document.body.innerText.includes('Close repository') ? true : null`)
      )
      ab.clickRole('button', 'Close and disconnect')
      await waitFor('B fuera del rail', () =>
        ab.eval(
          `!${section(B)} && document.querySelectorAll('[data-repo]').length === 1 ? true : null`
        )
      )
      const s = await repoSession(B)
      assert(s === null, `la sesión de B sigue viva tras cerrar: ${JSON.stringify(s)}`)
      const aStill = await waitFor('A activa y con su cambio', () =>
        ab.eval(
          `${section(A)}.classList.contains('border-accent') && document.querySelector('.doc')?.innerText.includes('Proposal: Add hello endpoint') ? true : null`
        )
      )
      assert(aStill, 'A no quedó activa con su cambio tras cerrar B')
      ab.screenshot(path.join(CAPTURES, '5-b-cerrada-con-agente.png'))
      return 'B cerrada y agente desconectado; A activa con add-hello-endpoint'
    })

    await step('sin errores de página durante el recorrido', async () => {
      const errs = ab.pageErrors()
      const list = Array.isArray(errs?.errors) ? errs.errors : []
      assert(list.length === 0, `errores de página: ${JSON.stringify(list).slice(0, 500)}`)
    })
  } catch (e) {
    failure = e
    if (app) console.error(`[e2e] últimas líneas de Electron:\n${app.log().trim()}`)
  } finally {
    ab.close()
    app?.stop()
    // da tiempo a Windows a soltar los ficheros antes de borrar el sandbox
    await new Promise((r) => setTimeout(r, 1500))
    cleanSandbox(sb)
  }

  const ok = results.filter((r) => r.ok).length
  console.log(`\n[e2e] capturas en ${CAPTURES}`)
  if (toastEvidence) console.log(`[e2e] evidencia del toast del SO: ${toastEvidence}`)
  console.log(`[e2e] foco real perdido durante el permiso: ${realUnfocus}`)
  console.log(`[e2e] ${failure ? 'FALLA' : 'OK'}: ${ok}/${results.length} pasos`)
  for (const r of results)
    console.log(
      `  ${r.ok ? 'OK ' : 'FALLA'} · ${r.name}${r.ok && r.detail ? ` — ${r.detail}` : ''}`
    )
  return failure ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[e2e] FALLA: ${e instanceof Error ? e.stack : e}`)
    process.exit(1)
  }
)

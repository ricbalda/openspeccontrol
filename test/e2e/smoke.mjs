// Fase 11 (tarea 11.3): E2E de humo de la app de escritorio, manejada por CDP con agent-browser.
//
//   npx electron-vite build          # una vez: genera out/
//   node test/e2e/smoke.mjs          # (Linux sin pantalla: xvfb-run -a node test/e2e/smoke.mjs)
//
// Requiere `agent-browser` en el PATH (npm i -g agent-browser). Lanza
// `electron . --remote-debugging-port=9222` con REPOS_ROOT apuntando a un repo de
// demo recién creado y OSC_DATA temporal (ver lib.mjs: también aísla HOME para no
// importar el ~/.openspec-studio real) y recorre el escenario del plan:
//
//   rail → abrir add-hello-endpoint → comentario → recargar → comentario
//   anclado → cambiar tema → captura
//
// Cada paso comprueba algo observable (DOM, CSS Custom Highlight, y la API
// `window.osc` que lee la db de la app), no solo que el clic no falle. Deja las
// capturas en test/e2e/captures/ y sale con código 1 si algún paso falla.
// Variables: CDP_PORT (9222), KEEP_TMP=1 (conserva el directorio temporal).

import fs from 'node:fs'
import path from 'node:path'
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

const CAPTURES = path.join(ROOT, 'test', 'e2e', 'captures')
const CHANGE = 'add-hello-endpoint'
const QUOTE = 'GET /api/v1/helloworld'
const NOTE = 'E2E de humo: ¿versionamos este endpoint?'

const results = []
async function step(name, fn) {
  const t0 = performance.now()
  try {
    const detail = await fn()
    const ms = Math.round(performance.now() - t0)
    results.push({ name, ok: true, ms, detail })
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

/** Abre el cambio desde el rail; reintenta el clic por si la lista se repinta justo entonces. */
const openChange = (ab) =>
  waitFor(
    'propuesta en el visor',
    () => {
      const open = ab.eval(
        `document.querySelector('.doc')?.innerText.includes('Proposal: Add hello endpoint')`
      )
      if (!open) ab.clickText(CHANGE)
      return open
    },
    { timeoutMs: 30_000, intervalMs: 1000 }
  )

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true })
  const sb = makeSandbox('osc-e2e-')
  const repoDir = createDemoRepo(sb)
  console.log(`[e2e] sandbox ${sb.tmp}\n[e2e] repo de demo ${repoDir}`)
  let app = null
  const ab = createDriver()
  let failure = null
  try {
    app = await launchApp(sb)
    console.log(`[e2e] Electron arriba en el puerto CDP ${app.port}`)
    ab.connect(app.port)

    await step('arranque: #root pintado y contrato window.osc (sin window.api)', async () => {
      await waitFor('#root con contenido', () =>
        ab.eval(`document.getElementById('root')?.childElementCount > 0`)
      )
      const api = ab.eval(
        `({ osc: typeof window.osc, repos: typeof window.osc?.repos, api: typeof window.api })`
      )
      assert(
        api.osc === 'object' && api.repos === 'function',
        `window.osc ausente: ${JSON.stringify(api)}`
      )
      assert(api.api === 'undefined', 'sigue expuesto window.api de la plantilla')
    })

    await step('rail: el repo de demo aparece al abrir el selector', async () => {
      await waitFor('botón del selector de repos', () =>
        ab.eval(`document.body.innerText.includes('Choose a repo')`)
      )
      ab.clickText('Choose a repo')
      await waitFor('hello-app en la lista', () =>
        ab.eval(`document.body.innerText.includes('hello-app')`)
      )
      const ws = ab.eval(`window.osc.repos().then(w => w.repos.map(r => r.name))`)
      assert(
        JSON.stringify(ws) === '["hello-app"]',
        `repos inesperados (¿se coló Studio?): ${JSON.stringify(ws)}`
      )
      ab.clickText('hello-app')
      await waitFor('rail con el cambio en "In review"', () =>
        ab.eval(
          `document.body.innerText.includes('${CHANGE}') && /in review/i.test(document.body.innerText)`
        )
      )
      return 'hello-app → "In review": add-hello-endpoint'
    })

    await step('abrir add-hello-endpoint: la propuesta se renderiza', async () => {
      await openChange(ab)
    })

    let repoId = ''
    await step('comentario: selección → Comment → texto → Add comment', async () => {
      repoId = ab.eval(`window.osc.repos().then(w => w.repos[0].id)`)
      // el visor reacciona al mouseup de la selección (como un arrastre del ratón)
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
      await waitFor('barra flotante con "Comment"', () =>
        ab.eval(`!!document.querySelector('div[data-ui].absolute button[title="Comment"]')`)
      )
      ab.click('div[data-ui].absolute button[title="Comment"]')
      await waitFor('editor del comentario', () =>
        ab.eval(`!!document.querySelector('textarea[placeholder^="Pick a suggestion"]')`)
      )
      ab.fillPlaceholder('Pick a suggestion or write a note…', NOTE)
      ab.clickRole('button', 'Add comment')
      const saved = await waitFor('comentario guardado en la db', () =>
        ab.eval(
          `window.osc.review(${JSON.stringify(repoId)}, '${CHANGE}').then(r => r.comments.length ? r.comments : null)`
        )
      )
      assert(saved.length === 1, `se esperaba 1 comentario, hay ${saved.length}`)
      assert(saved[0].body === NOTE, `cuerpo distinto: ${saved[0].body}`)
      assert(saved[0].anchor?.exact === QUOTE, `ancla distinta: ${saved[0].anchor?.exact}`)
      assert(saved[0].file === 'proposal.md', `archivo distinto: ${saved[0].file}`)
      ab.screenshot(path.join(CAPTURES, 'smoke-1-comentario.png'))
      return `id ${saved[0].id}, ancla "${saved[0].anchor.exact}"`
    })

    await step('recargar: la ventana vuelve a cargar y recuerda el repo', async () => {
      ab.reload()
      await waitFor('#root tras recargar', () =>
        ab.eval(
          `document.getElementById('root')?.childElementCount > 0 && typeof window.osc === 'object'`
        )
      )
      await waitFor('rail con el cambio otra vez', () =>
        ab.eval(`document.body.innerText.includes('${CHANGE}')`)
      )
    })

    await step(
      'comentario anclado: tras recargar sigue en la db, en la tarjeta y resaltado',
      async () => {
        await openChange(ab)
        const seen = await waitFor('tarjeta y resaltado del comentario', () =>
          ab.eval(`(() => {
          const highlights = Object.fromEntries(
            [...CSS.highlights.entries()].map(([k, v]) => [k, [...v].map((r) => r.toString())])
          )
          const ranges = Object.values(highlights).flat()
          const card = document.body.innerText.includes(${JSON.stringify(NOTE)})
          return card && ranges.includes(${JSON.stringify(QUOTE)}) ? { highlights, card } : null
        })()`)
        )
        const persisted = ab.eval(
          `window.osc.review(${JSON.stringify(repoId)}, '${CHANGE}').then(r => r.comments.map(c => ({ body: c.body, exact: c.anchor?.exact, orphaned: c.orphaned })))`
        )
        assert(
          persisted.length === 1 && persisted[0].exact === QUOTE && !persisted[0].orphaned,
          `comentario persistido incorrecto: ${JSON.stringify(persisted)}`
        )
        return `resaltado ${JSON.stringify(Object.keys(seen.highlights))}`
      }
    )

    await step(
      'tema: system → light → dark (data-theme, color de fondo y localStorage)',
      async () => {
        const read = () =>
          ab.eval(`({
          theme: document.documentElement.dataset.theme ?? 'system',
          stored: localStorage.getItem('theme'),
          bg: getComputedStyle(document.body).backgroundColor
        })`)
        // el botón rota system → light → dark → system; se llega a cada tema pulsándolo
        const cycleTo = (theme) => {
          for (let i = 0; i < 3 && read().theme !== theme; i++) ab.click('button[title^="Theme:"]')
          return read()
        }
        const start = read()
        const light = cycleTo('light')
        const dark = cycleTo('dark')
        assert(
          light.theme === 'light' && light.stored === 'light',
          `no llegó a light: ${JSON.stringify(light)}`
        )
        assert(
          dark.theme === 'dark' && dark.stored === 'dark',
          `no llegó a dark: ${JSON.stringify(dark)}`
        )
        assert(light.bg !== dark.bg, `el fondo no cambia entre temas: ${light.bg}`)
        return `${start.theme} → light (${light.bg}) → dark (${dark.bg})`
      }
    )

    await step('captura final (tema oscuro, comentario anclado)', async () => {
      const file = path.join(CAPTURES, 'smoke-2-final-oscuro.png')
      ab.screenshot(file)
      assert(fs.existsSync(file) && fs.statSync(file).size > 10_000, 'captura vacía o ausente')
      return path.relative(ROOT, file)
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
  console.log(`\n[e2e] ${failure ? 'FALLA' : 'OK'}: ${ok}/${results.length} pasos`)
  return failure ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[e2e] FALLA: ${e instanceof Error ? e.stack : e}`)
    process.exit(1)
  }
)

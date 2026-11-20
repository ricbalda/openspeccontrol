// add-proposal-drafts (tareas 6.1 y 6.2): E2E de los borradores de proposal en
// la app real, con CDP y agent-browser como smoke.mjs.
//
//   npx electron-vite build          # una vez: genera out/
//   node test/e2e/drafts.mjs         # sale 1 si algún paso falla
//
// Requiere `agent-browser` en el PATH. Lanza `electron . --remote-debugging-port=9234`
// (puerto propio: smoke usa 9222, multi-repo 9233) con REPOS_ROOT apuntando al repo
// de demo hello-app y OSC_DATA temporal que declara el agente ACP falso
// (fake-acp-agent.mjs) como agente por defecto (DEFAULT_AGENT=fake; su estilo es
// slash, así que sus comandos OpenSpec son `/opsx:<acción> <texto>`). Recorrido de
// la spec de proposal-drafts:
//
//   crear → escribir y autoguardar (Saving… → Saved) → buscar «busqueda» y dar
//   con «Búsqueda» → superar 4000 (Explore y Propose deshabilitados, se guarda
//   igual) → recortar → Propose (el agente falso recibe `/opsx:propose
//   <contenido>`, verificado en la tabla `events` de la base del sandbox) →
//   enviado en solo lectura → duplicar → borrar (cancelar conserva, confirmar
//   borra) → segundo borrador → reiniciar la app y comprobar que los borradores
//   se conservan.
//
// 6.2: `git status --porcelain` del repo de demo antes y después del recorrido:
// los borradores nunca se escriben en el repositorio del usuario.
//
// Deja capturas en test/e2e/captures/. Variables: CDP_PORT (9234), KEEP_TMP=1.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  ROOT,
  cleanSandbox,
  createDemoRepo,
  createDriver,
  launchApp,
  makeSandbox,
  sleep,
  stamp,
  waitFor
} from './lib.mjs'

const PORT = Number(process.env.CDP_PORT) || 9234
const CAPTURES = path.join(ROOT, 'test', 'e2e', 'captures')
/** Textos con acentos del recorrido (llegan a la página por stdin, nunca por argv). */
const TITLE = 'Búsqueda'
const BODY_1 =
  '## Añadir búsqueda por cliente\n\nAñadir búsqueda por cliente en el listado mensual.'
const PROPOSE_TEXT = 'Añadir exportación a CSV del informe mensual'
const LONG = 'La búsqueda debe cubrir el informe mensual y exportar el resultado a CSV. '
  .repeat(70)
  .slice(0, 4210)
if (LONG.length !== 4210) throw new Error(`LONG mide ${LONG.length}, se esperaban 4210`)

/** Tooltips únicos de la sección Drafts y su editor (RepoSection.tsx / DraftEditor.tsx). */
const DRAFTS_TOGGLE = 'Proposal drafts kept in OpenSpecControl (never written to the repository)'
const NEW_DRAFT = 'Create an empty draft for this repository and open it in the editor'

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

/** `git status --porcelain` de un directorio (6.2: el repo de demo debe quedar igual). */
const gitStatus = (dir) =>
  spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout.trim()

/**
 * Textos de los eventos `user` de un repo en la base del sandbox: es lo único que
 * prueba qué comando exacto recibió el agente falso (el transcript pinta el label,
 * «Propose», no el texto). WAL permite leer mientras la app vive.
 */
function userPromptsFromDb(sb, repo) {
  const file = path.join(sb.data, 'openspeccontrol.db')
  let db
  try {
    db = new DatabaseSync(file, { readOnly: true })
  } catch {
    db = new DatabaseSync(file)
  }
  try {
    return db
      .prepare('SELECT json FROM events WHERE repo = ? ORDER BY seq')
      .all(repo)
      .map((r) => JSON.parse(r.json))
      .filter((e) => e.kind === 'user')
      .map((e) => e.text)
  } finally {
    db.close()
  }
}

/** Helpers de página sobre un driver (todo por eval: los acentos van por stdin). */
const page = (ab) => ({
  /** Escribe en un campo como el usuario: value nativo + evento input (React). */
  type: (sel, text) =>
    ab.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)})
      if (!el) return null
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return el.value.length
    })()`),
  /** Estado de un botón por su texto exacto (count si hay colisiones). */
  button: (text) =>
    ab.eval(`(() => {
      const bs = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === ${JSON.stringify(text)})
      return bs.length === 1 ? { disabled: bs[0].disabled } : { count: bs.length }
    })()`),
  /** Clica el botón con ese texto exacto; exige que sea único y no esté deshabilitado. */
  clickButton: (text) =>
    ab.eval(`(() => {
      const bs = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === ${JSON.stringify(text)})
      if (bs.length !== 1) return { count: bs.length }
      if (bs[0].disabled) return { clicked: false, disabled: true }
      bs[0].click()
      return { clicked: true }
    })()`),
  /** Clica un botón por su tooltip único. */
  clickTitle: (title) =>
    ab.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(title)})
      b?.click()
      return !!b
    })()`),
  /** El indicador del editor: Saving… / Saved / Not saved (D-6). */
  saveLabel: () =>
    ab.eval(`(() => {
      const hits = [...document.querySelectorAll('span')].map((s) => s.textContent.trim())
        .filter((t) => t === 'Saving…' || t === 'Saved' || t.startsWith('Not saved'))
      return hits.length ? hits[hits.length - 1] : null
    })()`),
  /** El contador `n / 4000` (con la advertencia si excede). */
  counter: () =>
    ab.eval(`[...document.querySelectorAll('span')].map((s) => s.textContent.trim())
      .find((t) => t.includes(' / 4000')) ?? null`),
  /** Los borradores del rail en su orden (updated_at descendente). */
  railDrafts: () =>
    ab.eval(`[...document.querySelectorAll('li[data-draft-id]')].map((li) => ({
      id: li.dataset.draftId,
      text: li.innerText.split('\\n').join(' | ')
    }))`),
  /** Abre un borrador del historial por su id. */
  openDraftItem: (id) =>
    ab.eval(`(() => {
      const b = document.querySelector('li[data-draft-id="${id}"] button')
      b?.click()
      return !!b
    })()`),
  /** El borrador por window.osc (resolve → draft, reject → { error }). */
  draftApi: (id) =>
    ab.eval(`window.osc.draft(${JSON.stringify(id)}).then(
      (d) => ({ title: d.title, body: d.body, status: d.status, sentMode: d.sentMode ?? null, len: d.body.length, createdAt: d.createdAt, updatedAt: d.updatedAt, repo: d.repo }),
      (e) => ({ error: String(e && e.message ? e.message : e) })
    )`),
  /** Estado de la sesión del agente del repo activo. */
  sessionStatus: (repoId) =>
    ab.eval(
      `window.osc.repos().then((w) => w.repos.find((r) => r.id === ${JSON.stringify(repoId)})?.session?.status ?? null)`
    ),
  /** ¿Está abierto el diálogo con ese título? */
  dialogOpen: (title) =>
    ab.eval(
      `[...document.querySelectorAll('h2')].some((h) => h.innerText.trim() === ${JSON.stringify(title)})`
    ),
  /** Clica un botón del pie de un diálogo por el título de su h2. */
  dialogClick: (title, text) =>
    ab.eval(`(() => {
      const h2 = [...document.querySelectorAll('h2')].find((h) => h.innerText.trim() === ${JSON.stringify(title)})
      const card = h2?.closest('.rounded-2xl')
      if (!card) return { open: false }
      const bs = [...card.querySelectorAll('button')].filter((b) => b.innerText.trim() === ${JSON.stringify(text)})
      if (bs.length !== 1) return { open: true, count: bs.length }
      if (bs[0].disabled) return { open: true, clicked: false }
      bs[0].click()
      return { open: true, clicked: true }
    })()`)
})

async function main() {
  fs.mkdirSync(CAPTURES, { recursive: true })
  const sb = makeSandbox('osc-drafts-')
  const repoDir = createDemoRepo(sb)
  const gitBefore = gitStatus(repoDir)
  assert(
    gitBefore === '',
    `el repo de demo no está limpio al empezar: ${JSON.stringify(gitBefore)}`
  )
  // el agente falso como agente por defecto (multi-repo.mjs): DEFAULT_AGENT=fake
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
  const ENV = { DEFAULT_AGENT: 'fake', FAKE_ACP_EVENTS: '6' }
  console.log(`[e2e] sandbox ${sb.tmp}\n[e2e] repo de demo ${repoDir}`)
  let app = null
  let ab = null
  let ab2 = null
  let failure = null
  try {
    app = await launchApp(sb, { port: PORT, env: ENV })
    console.log(`[e2e] Electron arriba en el puerto CDP ${app.port}`)
    ab = createDriver(`osc-drafts-${process.pid}`)
    ab.connect(app.port)
    const p = page(ab)

    let repoId = ''
    let id = '' // el borrador principal («Búsqueda»)
    let updatedAfterFirstSave = ''
    let errsRun1 = null // errores de página del primer arranque, leídos antes de pararlo

    await step('arranque: hello-app abierto y activo', async () => {
      await waitFor('#root con contenido', () =>
        ab.eval(`document.getElementById('root')?.childElementCount > 0`)
      )
      await waitFor('botón del selector de repos', () =>
        ab.eval(`document.body.innerText.includes('Choose a repo')`)
      )
      ab.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Choose a repo'))
        b?.click()
        return !!b
      })()`)
      await waitFor('hello-app en el selector', () =>
        ab.eval(`document.body.innerText.includes('hello-app')`)
      )
      repoId = await waitFor('id de hello-app', () =>
        ab.eval(
          `window.osc.repos().then((w) => w.repos.find((r) => r.name === 'hello-app')?.id ?? null)`
        )
      )
      ab.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.title === ${JSON.stringify(repoId)})
        b?.click()
        return !!b
      })()`)
      await waitFor(
        'sección de hello-app con el cambio',
        () =>
          ab.eval(
            `!!document.querySelector('[data-repo]') && document.body.innerText.includes('add-hello-endpoint')`
          ),
        { timeoutMs: 30_000 }
      )
      return repoId
    })

    await step('sección Drafts: desplegar muestra el vacío y «New draft»', async () => {
      assert(p.clickTitle(DRAFTS_TOGGLE), 'no se encontró la cabecera de Drafts')
      await waitFor('«No drafts yet.» y el botón «New draft»', () =>
        ab.eval(
          `document.body.innerText.includes('No drafts yet.') &&
            [...document.querySelectorAll('button')].some((b) => b.title.startsWith('Create an empty draft'))`
        )
      )
      ab.screenshot(path.join(CAPTURES, 'drafts-1-vacia.png'))
      return '«No drafts yet.»'
    })

    await step('crear: «New draft» abre el editor vacío (Propose deshabilitado)', async () => {
      assert(p.clickTitle(NEW_DRAFT), 'no se encontró «New draft»')
      await waitFor('editor abierto', () =>
        ab.eval(`!!document.querySelector('textarea[aria-label="Draft content"]')`)
      )
      const empty = ab.eval(`(() => ({
        title: document.querySelector('input[aria-label="Draft title"]')?.value ?? null,
        counter: [...document.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => t.includes(' / 4000')) ?? null,
        badgeDraft: [...document.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Draft')
      }))()`)
      assert(empty.title === '', `título inicial: ${JSON.stringify(empty.title)}`)
      assert(empty.counter === '0 / 4000', `contador inicial: ${JSON.stringify(empty.counter)}`)
      assert(empty.badgeDraft, 'falta la insignia «Draft»')
      const explore = p.button('Explore')
      const propose = p.button('Propose')
      assert(
        explore.disabled === false,
        `Explore debería estar habilitado: ${JSON.stringify(explore)}`
      )
      assert(
        propose.disabled === true,
        `Propose debería estar deshabilitado: ${JSON.stringify(propose)}`
      )
      const listed = await waitFor('el borrador nuevo en el historial', () => {
        const items = p.railDrafts()
        return items.length === 1 ? items : null
      })
      id = listed[0].id
      return `id ${id.slice(0, 8)}…, contador 0 / 4000`
    })

    await step('autoguardado: escribir → Saving… → Saved → persistido', async () => {
      const n = p.type('textarea[aria-label="Draft content"]', BODY_1)
      assert(n === BODY_1.length, `el textarea recibió ${n} caracteres`)
      const seen = p.saveLabel()
      assert(
        seen === 'Saving…' || seen === 'Saved',
        `indicador de guardado inesperado tras escribir: ${JSON.stringify(seen)}`
      )
      await waitFor('indicador «Saved»', () => (p.saveLabel() === 'Saved' ? true : null), {
        timeoutMs: 15_000
      })
      const n2 = p.type('input[aria-label="Draft title"]', TITLE)
      assert(n2 === TITLE.length, `el título recibió ${n2} caracteres`)
      await waitFor('indicador «Saved» de nuevo', () => (p.saveLabel() === 'Saved' ? true : null), {
        timeoutMs: 15_000
      })
      const d = p.draftApi(id)
      assert(!d.error, `window.osc.draft falló: ${d.error}`)
      assert(d.title === TITLE, `título guardado: ${JSON.stringify(d.title)}`)
      assert(d.body === BODY_1, `contenido guardado distinto (${d.body.length} caracteres)`)
      assert(
        d.createdAt < d.updatedAt,
        `updatedAt (${d.updatedAt}) no avanzó tras crear (${d.createdAt})`
      )
      updatedAfterFirstSave = d.updatedAt
      ab.screenshot(path.join(CAPTURES, 'drafts-2-editor.png'))
      return `«${TITLE}» guardado (${d.body.length} caracteres), vi ${JSON.stringify(seen)}`
    })

    await step('búsqueda sin acentos: «busqueda» encuentra «Búsqueda»', async () => {
      const n = p.type('input[placeholder="Search drafts…"]', 'busqueda')
      assert(n === 'busqueda'.length, `el buscador recibió ${n} caracteres`)
      const kept = await waitFor('«Búsqueda» sigue listado con «busqueda»', () => {
        const items = p.railDrafts()
        return items.length === 1 && items[0].id === id ? items : null
      })
      ab.screenshot(path.join(CAPTURES, 'drafts-3-busqueda.png'))
      // sin resultados → aviso + Clear search restaura la lista completa
      p.type('input[placeholder="Search drafts…"]', 'kubernetes')
      await waitFor('«No drafts match» para «kubernetes»', () =>
        ab.eval(
          `document.body.innerText.includes('No drafts match') && document.body.innerText.includes('kubernetes')`
        )
      )
      const cleared = p.clickButton('Clear search')
      assert(cleared.clicked === true, `Clear search: ${JSON.stringify(cleared)}`)
      await waitFor('lista restaurada', () => {
        const items = p.railDrafts()
        return items.length === 1 && items[0].id === id ? items : null
      })
      return `«busqueda» → ${kept[0].text.split(' | ')[0]}`
    })

    await step(
      'límite: 4210 caracteres deshabilita Explore y Propose, pero se guarda',
      async () => {
        const n = p.type('textarea[aria-label="Draft content"]', LONG)
        assert(n === LONG.length, `el textarea recibió ${n} caracteres`)
        await waitFor(
          `contador «${LONG.length} / 4000: shorten the draft to send it»`,
          () => {
            const c = p.counter()
            return c === `${LONG.length} / 4000: shorten the draft to send it` ? c : null
          },
          { timeoutMs: 15_000 }
        )
        const explore = p.button('Explore')
        const propose = p.button('Propose')
        assert(
          explore.disabled === true,
          `Explore debería estar deshabilitado: ${JSON.stringify(explore)}`
        )
        assert(
          propose.disabled === true,
          `Propose debería estar deshabilitado: ${JSON.stringify(propose)}`
        )
        await waitFor('«Saved» pese al exceso', () => (p.saveLabel() === 'Saved' ? true : null), {
          timeoutMs: 15_000
        })
        const d = p.draftApi(id)
        assert(!d.error, `window.osc.draft falló: ${d.error}`)
        assert(d.len === LONG.length, `guardó ${d.len} caracteres, se esperaban ${LONG.length}`)
        assert(d.status === 'draft', 'no debería estar enviado')
        assert(d.updatedAt > updatedAfterFirstSave, 'updatedAt no avanzó con el texto largo')
        ab.screenshot(path.join(CAPTURES, 'drafts-4-excede-4000.png'))
        return `${d.len} caracteres guardados, envío bloqueado`
      }
    )

    await step('recortar: dentro del límite habilita el envío', async () => {
      const n = p.type('textarea[aria-label="Draft content"]', PROPOSE_TEXT)
      assert(n === PROPOSE_TEXT.length, `el textarea recibió ${n} caracteres`)
      await waitFor(
        `contador «${PROPOSE_TEXT.length} / 4000» sin advertencia`,
        () => {
          const c = p.counter()
          return c === `${PROPOSE_TEXT.length} / 4000` ? c : null
        },
        { timeoutMs: 15_000 }
      )
      const explore = p.button('Explore')
      const propose = p.button('Propose')
      assert(
        explore.disabled === false,
        `Explore debería estar habilitado: ${JSON.stringify(explore)}`
      )
      assert(
        propose.disabled === false,
        `Propose debería estar habilitado: ${JSON.stringify(propose)}`
      )
      await waitFor('«Saved» tras recortar', () => (p.saveLabel() === 'Saved' ? true : null), {
        timeoutMs: 15_000
      })
      const d = p.draftApi(id)
      assert(!d.error && d.body === PROPOSE_TEXT, 'el contenido recortado no se guardó')
      return `${PROPOSE_TEXT.length} / 4000, botones habilitados`
    })

    await step(
      'Propose: el agente falso recibe /opsx:propose y el borrador queda enviado',
      async () => {
        const c = p.clickButton('Propose')
        assert(c.clicked === true, `Propose: ${JSON.stringify(c)}`)
        // ensureAgent arranca el agente falso (hasta 90 s) y luego marca el envío
        await waitFor(
          'editor en solo lectura con «Sent as proposal»',
          () =>
            ab.eval(`document.body.innerText.includes('Sent as proposal') &&
            !document.querySelector('textarea[aria-label="Draft content"]') ? true : null`),
          { timeoutMs: 90_000 }
        )
        const view = ab.eval(`(() => ({
        titleInput: !!document.querySelector('input[aria-label="Draft title"]'),
        explore: [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Explore').length,
        propose: [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Propose').length,
        doc: document.querySelector('.doc')?.innerText ?? null
      }))()`)
        assert(!view.titleInput, 'el título sigue editable en un enviado')
        assert(
          view.explore === 0 && view.propose === 0,
          `quedan botones de envío: ${JSON.stringify(view)}`
        )
        assert(
          view.doc?.includes(PROPOSE_TEXT),
          `el enviado no muestra el contenido: ${JSON.stringify(view.doc)}`
        )
        await waitFor(
          'agente falso vuelve a ready',
          () => {
            const s = p.sessionStatus(repoId)
            return s === 'ready' ? s : null
          },
          { timeoutMs: 30_000 }
        )
        // el comando exacto que llegó al agente: evento user en la base del sandbox
        const prompts = await waitFor('evento user /opsx:propose en la base', () => {
          const texts = userPromptsFromDb(sb, repoId)
          return texts.some((t) => t === `/opsx:propose ${PROPOSE_TEXT}`) ? texts : null
        })
        const d = p.draftApi(id)
        assert(
          !d.error && d.status === 'sent' && d.sentMode === 'propose',
          `borrador no enviado: ${JSON.stringify(d)}`
        )
        const rail = p.railDrafts().find((x) => x.id === id)
        assert(
          rail?.text.includes('Sent · propose'),
          `el historial no marca el envío: ${rail?.text}`
        )
        ab.screenshot(path.join(CAPTURES, 'drafts-5-enviado.png'))
        return `evento: ${prompts[prompts.length - 1].slice(0, 60)}…`
      }
    )

    let copyId = ''
    await step('duplicar: abre la copia editable «Búsqueda (copy)»', async () => {
      const c = p.clickButton('Duplicate')
      assert(c.clicked === true, `Duplicate: ${JSON.stringify(c)}`)
      const title = await waitFor('editor editable con «Búsqueda (copy)»', () => {
        const v = ab.eval(
          `document.querySelector('input[aria-label="Draft title"]')?.value ?? null`
        )
        return v === `${TITLE} (copy)` ? v : null
      })
      const state = ab.eval(`(() => ({
        textarea: !!document.querySelector('textarea[aria-label="Draft content"]'),
        badgeDraft: [...document.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Draft')
      }))()`)
      assert(
        state.textarea && state.badgeDraft,
        `la copia no es editable: ${JSON.stringify(state)}`
      )
      const items = await waitFor('la copia primera y el original enviado detrás', () => {
        const list = p.railDrafts()
        return list.length === 2 && list[1].id === id && list[0].id !== id ? list : null
      })
      copyId = items[0].id // la copia es la más nueva
      assert(copyId !== id, 'la copia comparte id con el original')
      assert(items[1].text.includes('Sent · propose'), 'el original no sigue enviado')
      assert(!items[0].text.includes('Sent ·'), `la copia aparece como enviada: ${items[0].text}`)
      const copy = p.draftApi(copyId)
      assert(
        !copy.error && copy.body === PROPOSE_TEXT && copy.status === 'draft',
        'la copia no conserva el contenido'
      )
      return `«${title}», id ${copyId.slice(0, 8)}…`
    })

    await step('borrar: cancelar conserva, confirmar borra y cierra el editor', async () => {
      const c = p.clickButton('Delete')
      assert(c.clicked === true, `Delete: ${JSON.stringify(c)}`)
      await waitFor('diálogo «Delete draft»', () => (p.dialogOpen('Delete draft') ? true : null))
      const cancel = p.dialogClick('Delete draft', 'Cancel')
      assert(cancel.clicked === true, `Cancel: ${JSON.stringify(cancel)}`)
      await waitFor('diálogo cerrado sin borrar', () =>
        p.dialogOpen('Delete draft') ? null : true
      )
      assert(p.railDrafts().length === 2, 'cancelar no conservó el borrador')
      const c2 = p.clickButton('Delete')
      assert(c2.clicked === true, `Delete (2): ${JSON.stringify(c2)}`)
      await waitFor('diálogo «Delete draft» de nuevo', () =>
        p.dialogOpen('Delete draft') ? true : null
      )
      const del = p.dialogClick('Delete draft', 'Delete')
      assert(del.clicked === true, `Confirmar borrado: ${JSON.stringify(del)}`)
      await waitFor('diálogo cerrado y editor cerrado', () =>
        ab.eval(`!document.querySelector('h2') || ![...document.querySelectorAll('h2')].some((h) => h.innerText.trim() === 'Delete draft')
          ? (document.body.innerText.includes('Nothing open') ? true : null) : null`)
      )
      const items = p.railDrafts()
      assert(
        items.length === 1 && items[0].id === id,
        `tras borrar debería quedar el original: ${JSON.stringify(items)}`
      )
      const gone = p.draftApi(copyId)
      assert(
        gone.error?.includes('not found'),
        `la copia sigue en la base: ${JSON.stringify(gone)}`
      )
      ab.screenshot(path.join(CAPTURES, 'drafts-6-tras-borrar.png'))
      return `copia ${copyId.slice(0, 8)}… eliminada, queda el enviado`
    })

    await step('segundo borrador sin título para el reinicio', async () => {
      assert(p.clickTitle(NEW_DRAFT), 'no se encontró «New draft»')
      await waitFor('editor vacío', () =>
        ab.eval(`!!document.querySelector('textarea[aria-label="Draft content"]') &&
          document.querySelector('textarea[aria-label="Draft content"]')?.value === ''`)
      )
      const items = await waitFor('«Untitled draft» primero en el historial', () => {
        const list = p.railDrafts()
        return list.length === 2 && list[0].text.includes('Untitled draft') ? list : null
      })
      const d = p.draftApi(items[0].id)
      assert(
        !d.error && d.title === '',
        `el título vacío se guardó como texto: ${JSON.stringify(d.title)}`
      )
      return '«Untitled draft» primero en el historial'
    })

    await step('6.2: el repositorio queda intacto (git status --porcelain vacío)', async () => {
      const after = gitStatus(repoDir)
      assert(
        after === gitBefore,
        `git status cambió tras el recorrido:\nantes:    ${JSON.stringify(gitBefore)}\ndespués: ${JSON.stringify(after)}`
      )
      return 'sin archivos nuevos ni modificados'
    })

    await step('reiniciar: los borradores se conservan', async () => {
      // los errores de página del primer arranque hay que leerlos con la app viva
      errsRun1 = ab.pageErrors()
      app.stop()
      await waitFor(
        'proceso Electron terminado',
        () => (app.child.exitCode !== null ? true : null),
        {
          timeoutMs: 20_000
        }
      )
      await sleep(1000) // margen para que Windows libere el puerto CDP
      app = await launchApp(sb, { port: PORT, env: ENV })
      ab2 = createDriver(`osc-drafts-r2-${process.pid}`)
      ab2.connect(app.port)
      const p2 = page(ab2)
      await waitFor('#root tras reiniciar', () =>
        ab2.eval(`document.getElementById('root')?.childElementCount > 0`)
      )
      await waitFor(
        'hello-app restaurado como activo',
        () =>
          ab2.eval(
            `!!document.querySelector('[data-repo]') && document.querySelector('[data-repo]')?.dataset.repo === ${JSON.stringify(repoId)}`
          ),
        { timeoutMs: 30_000 }
      )
      assert(p2.clickTitle(DRAFTS_TOGGLE), 'no se encontró la cabecera de Drafts tras reiniciar')
      const items = await waitFor('dos borradores: «Untitled draft» y «Búsqueda» enviada', () => {
        const list = p2.railDrafts()
        return list.length === 2 &&
          list[0].text.includes('Untitled draft') &&
          list[1].text.includes(TITLE) &&
          list[1].text.includes('Sent · propose')
          ? list
          : null
      })
      p2.openDraftItem(items[1].id)
      await waitFor('«Búsqueda» en solo lectura con «Sent as proposal»', () =>
        ab2.eval(`document.body.innerText.includes('Sent as proposal') &&
          !document.querySelector('textarea[aria-label="Draft content"]') ? true : null`)
      )
      const d = p2.draftApi(id)
      assert(
        !d.error &&
          d.status === 'sent' &&
          d.sentMode === 'propose' &&
          d.title === TITLE &&
          d.body === PROPOSE_TEXT,
        `el enviado no se conservó: ${JSON.stringify(d)}`
      )
      ab2.screenshot(path.join(CAPTURES, 'drafts-7-tras-reinicio.png'))
      return `2 borradores; «${TITLE}» enviado con su contenido`
    })

    await step('cierre: repo intacto tras el reinicio y sin errores de página', async () => {
      const after = gitStatus(repoDir)
      assert(
        after === gitBefore,
        `git status cambió tras reiniciar:\nantes:    ${JSON.stringify(gitBefore)}\ndespués: ${JSON.stringify(after)}`
      )
      const runs = [
        ['run 1', errsRun1],
        ['run 2', ab2.pageErrors()]
      ]
      for (const [run, errs] of runs) {
        const list = Array.isArray(errs?.errors) ? errs.errors : []
        assert(
          list.length === 0,
          `errores de página (${run}): ${JSON.stringify(list).slice(0, 400)}`
        )
      }
      return 'repo limpio, 0 errores de página'
    })
  } catch (e) {
    failure = e
    try {
      const shot = path.join(CAPTURES, 'drafts-99-fallo.png')
      ;(ab2 ?? ab)?.screenshot(shot)
      console.error(`[e2e] captura del fallo: ${path.relative(ROOT, shot)}`)
    } catch {
      /* sin conexión CDP ya no hay captura */
    }
    if (app) console.error(`[e2e] últimas líneas de Electron:\n${app.log().trim()}`)
  } finally {
    ab?.close()
    ab2?.close()
    app?.stop()
    // da tiempo a Windows a soltar los ficheros antes de borrar el sandbox
    await sleep(1500)
    cleanSandbox(sb)
  }

  const ok = results.filter((r) => r.ok).length
  console.log(`\n[e2e] ${failure ? 'FALLA' : 'OK'}: ${ok}/${results.length} pasos`)
  for (const r of results)
    console.log(`  ${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ` — ${r.detail}`}`)
  return failure ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[e2e] FALLA: ${e instanceof Error ? e.stack : e}`)
    process.exit(1)
  }
)

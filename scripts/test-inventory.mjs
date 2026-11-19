// Fase 11 (tareas 11.1 y 11.2): listado verificable de los tests exigidos por el plan.
//
//   node scripts/test-inventory.mjs            # ejecuta vitest y escribe test/INVENTARIO-TESTS.md
//   node scripts/test-inventory.mjs --check    # además sale con 1 si falta/falla/queda vacío algún test exigido
//
// Ejecuta `vitest run --reporter=json` (los dos proyectos: main y renderer) y
// cruza el resultado con las listas de tasks.md:
//  · 11.1 — núcleo conservado (agents, anchor, changes-cache, git, repoFile, review,
//    round, sandbox, schemas, specs, usage, workspace sin `browse`) y renderer
//    (columnResizer, relative, specMarkup, textModel, transcript, usage);
//  · 11.2 — tests nuevos de cada fase (osc-core, legacy-import, ipc, updater,
//    shell-env, tools).
// Un test «cuenta» si su archivo existe, ejecuta al menos un caso y ninguno falla.
// Los casos omitidos se listan con el motivo que declara el propio archivo (p. ej.
// `describe.skipIf(process.platform === 'win32')`): son tests que esta ejecución no
// pudo correr, no tests que pasaron.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

const CORE_MAIN = [
  'agents',
  'anchor',
  'changes-cache',
  'git',
  'repoFile',
  'review',
  'round',
  'sandbox',
  'schemas',
  'specs',
  'usage',
  'workspace'
]
const CORE_RENDERER = [
  'columnResizer',
  'relative',
  'specMarkup',
  'textModel',
  'transcript',
  'usage'
]
const NEW_MAIN = ['osc-core', 'legacy-import', 'ipc', 'updater', 'shell-env', 'tools']

const groups = [
  {
    title: '11.1 — núcleo conservado (proceso principal)',
    files: CORE_MAIN.map((n) => `test/main/${n}.test`)
  },
  {
    title: '11.1 — renderer conservado',
    files: CORE_RENDERER.map((n) => `test/renderer/${n}.test`)
  },
  {
    title: '11.2 — tests nuevos de cada fase',
    files: NEW_MAIN.map((n) => `test/main/${n}.test`)
  }
]

// ---- ejecutar vitest -----------------------------------------------------------------
const out = path.join(os.tmpdir(), `osc-inventory-${process.pid}.json`)
const run = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--reporter=json',
    `--outputFile=${out}`
  ],
  { cwd: root, encoding: 'utf8' }
)
if (!fs.existsSync(out)) {
  console.error(`vitest no produjo informe:\n${run.stderr || run.stdout}`)
  process.exit(1)
}
const report = JSON.parse(fs.readFileSync(out, 'utf8'))
fs.rmSync(out, { force: true })

const norm = (p) => path.relative(root, p).split(path.sep).join('/')
const byFile = new Map(report.testResults.map((t) => [norm(t.name), t.assertionResults]))
const count = (rs, st) => rs.filter((r) => r.status === st).length

/** La línea del archivo que declara por qué se omite (skipIf / skip), si la hay. */
const skipReason = (file) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
  const line = src
    .split(/\r?\n/)
    .find((l) => /\.skipIf\(|\.skip\(|describe\.skip|share \? describe/.test(l))
  return line?.trim() ?? 'omitido sin motivo declarado'
}

// ---- cruzar con las listas del plan --------------------------------------------------------
const problems = []
const warnings = []
/** `test/x/foo.test` → el archivo real (`.ts` o `.tsx`) que ejecutó vitest, o null */
const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`].find((f) => byFile.has(f)) ?? null
const lines = []
const now = new Date().toISOString()
lines.push('# Inventario de tests (tareas 11.1 y 11.2)')
lines.push('')
lines.push(
  `Generado por \`node scripts/test-inventory.mjs\` el ${now} en ${os.type()} ${os.release()} (${process.platform}/${process.arch}), Node ${process.version}.`
)
lines.push('')
lines.push(
  `Total de la ejecución: **${report.numPassedTests} pasan**, ${report.numFailedTests} fallan, ${report.numPendingTests} omitidos, en ${report.testResults.length} archivos (${report.numTotalTests} casos).`
)
lines.push('')
lines.push(
  'Un test exigido cuenta si su archivo existe, ejecuta al menos un caso y ninguno falla; si todo su contenido se omite por la plataforma queda como «no ejecutado en este SO», es decir, **no verificado** aquí. «Omitidos» son casos que esta ejecución **no** pudo correr (motivo declarado en el propio archivo).'
)
lines.push('')

for (const g of groups) {
  lines.push(`## ${g.title}`)
  lines.push('')
  lines.push('| Archivo | Casos | Pasan | Fallan | Omitidos | Estado |')
  lines.push('| --- | ---: | ---: | ---: | ---: | --- |')
  for (const base of g.files) {
    const f = resolveFile(base) ?? `${base}.ts`
    const rs = byFile.get(f)
    if (!rs) {
      lines.push(`| \`${f}\` | – | – | – | – | **FALTA** |`)
      problems.push(`falta ${f}`)
      continue
    }
    const pass = count(rs, 'passed')
    const fail = count(rs, 'failed')
    const skip = rs.length - pass - fail
    let state = 'ok'
    if (fail > 0) {
      state = '**FALLA**'
      problems.push(`${f}: ${fail} fallan`)
    } else if (pass === 0 && skip > 0) {
      // omitido por la plataforma: no es un fallo del repo, pero tampoco está verificado aquí
      state = '**no ejecutado en este SO** (todo omitido)'
      warnings.push(`${f}: todo omitido en este SO (${skipReason(f)})`)
    } else if (pass === 0) {
      state = '**VACÍO**'
      problems.push(`${f}: ningún caso ejecutado`)
    } else if (skip > 0) {
      state = 'ok, con omitidos'
    }
    lines.push(`| \`${f}\` | ${rs.length} | ${pass} | ${fail} | ${skip} | ${state} |`)
  }
  lines.push('')
}

// «workspace sin browse»: el selector de carpetas por texto desapareció con la Fase 5
const wsSrc = fs.readFileSync(path.join(root, 'test/main/workspace.test.ts'), 'utf8')
const browseMentions = (wsSrc.match(/\bbrowse\b/g) ?? []).length
lines.push('## Comprobaciones adicionales')
lines.push('')
lines.push(
  `- \`workspace\` sin \`browse\`: ${browseMentions === 0 ? 'ok — `test/main/workspace.test.ts` no menciona `browse`' : `**FALLA** — ${browseMentions} menciones`}.`
)
if (browseMentions > 0) problems.push('workspace.test.ts menciona browse')

const skipped = []
for (const [f, rs] of byFile) {
  const n = rs.length - count(rs, 'passed') - count(rs, 'failed')
  if (n > 0) skipped.push({ f, n })
}
lines.push('')
lines.push('## Casos omitidos en esta ejecución')
lines.push('')
if (skipped.length === 0) lines.push('Ninguno.')
else {
  lines.push('| Archivo | Omitidos | Motivo declarado |')
  lines.push('| --- | ---: | --- |')
  for (const { f, n } of skipped) lines.push(`| \`${f}\` | ${n} | \`${skipReason(f)}\` |`)
}
lines.push('')
lines.push('## Todos los archivos de test de esta ejecución')
lines.push('')
lines.push('| Archivo | Casos | Pasan |')
lines.push('| --- | ---: | ---: |')
for (const f of [...byFile.keys()].sort()) {
  const rs = byFile.get(f)
  lines.push(`| \`${f}\` | ${rs.length} | ${count(rs, 'passed')} |`)
}
lines.push('')

const file = path.join(root, 'test', 'INVENTARIO-TESTS.md')
fs.writeFileSync(file, lines.join('\n'))
console.log(
  `[inventario] ${report.numPassedTests} pasan, ${report.numFailedTests} fallan, ${report.numPendingTests} omitidos → ${norm(file)}`
)
if (warnings.length)
  console.warn(`[inventario] NO VERIFICADO en este SO:\n  - ${warnings.join('\n  - ')}`)
if (problems.length) {
  console.error(`[inventario] PROBLEMAS:\n  - ${problems.join('\n  - ')}`)
  if (check) process.exit(1)
} else {
  console.log(
    '[inventario] OK: todos los tests exigidos por 11.1 y 11.2 existen, ejecutan casos y pasan'
  )
}

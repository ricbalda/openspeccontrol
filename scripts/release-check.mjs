// Fase 10 (tarea 10.3): puerta previa del workflow de release.
//
//   node scripts/release-check.mjs --tag "$GITHUB_REF_NAME"   # etiqueta == versión
//   node scripts/release-check.mjs --signing                   # secretos de firma presentes
//   node scripts/release-check.mjs --tag v0.2.0 --signing      # ambas
//
// Sale con código 1 (y anotaciones `::error::` para GitHub Actions) si algo falla.
// Nunca imprime el valor de un secreto, solo el nombre de los que faltan.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSigningEnv, checkTagVersion } from './release-check-lib.mjs'

const argv = process.argv.slice(2)
const problems = []

const tagAt = argv.indexOf('--tag')
if (tagAt >= 0) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const problem = checkTagVersion(argv[tagAt + 1], pkg.version)
  if (problem) problems.push(problem)
}
if (argv.includes('--signing')) problems.push(...checkSigningEnv(process.env))
if (tagAt < 0 && !argv.includes('--signing')) {
  problems.push('uso: release-check.mjs [--tag <etiqueta>] [--signing]')
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error title=Release::${p}`)
  console.error('[release-check] FALLA: el release no se construye ni se publica.')
  process.exit(1)
}
console.log('[release-check] OK')

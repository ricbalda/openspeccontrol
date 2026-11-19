// Fase 8 (tarea 8.6): envoltorio de electron-builder para `npm run dist*`.
// Pasa los argumentos tal cual y, si están las variables AZURE_SIGN_*, añade
// la configuración de Azure Trusted Signing (ver scripts/dist-args.mjs).
//
//   node scripts/dist.mjs --win      # NSIS (x64 + arm64)
//   node scripts/dist.mjs --mac      # dmg + zip universales (solo en macOS)
//   node scripts/dist.mjs --linux    # AppImage + deb (x64 + arm64)
//   node scripts/dist.mjs --dir      # carpeta sin empaquetar (release/<version>)

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { electronBuilderArgs } from './dist-args.mjs'

const require = createRequire(import.meta.url)
const cli = require.resolve('electron-builder/cli.js')
const args = electronBuilderArgs(process.argv.slice(2))
const azure = args.some((a) => a.startsWith('-c.win.azureSignOptions.'))
console.log(`[dist] electron-builder ${args.filter((a) => !a.startsWith('-c.')).join(' ')}`.trim())
if (azure) console.log('[dist] firma de Windows: Azure Trusted Signing (variables AZURE_SIGN_*)')

const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)

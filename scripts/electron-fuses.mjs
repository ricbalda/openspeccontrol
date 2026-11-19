// electron-builder afterPack hook (Fase 7, tarea 7.5): flips the security
// fuses of the packaged binary right after the app dir is assembled and
// before it is signed / squashed into a target. Wired from electron-builder.yml:
//
//   afterPack: scripts/electron-fuses.mjs
//
// Fuses (the plan's Fase 7): RunAsNode, NODE_OPTIONS and the inspector
// switches are disabled; asar integrity validation and OnlyLoadAppFromAsar
// are enabled. OpenSpecControl never uses ELECTRON_RUN_AS_NODE: agents are
// launched with the system node/npx, not with the app's Electron.
//
// Verify a package with: npx @electron/fuses read --app <binary>.

import fs from 'node:fs'
import path from 'node:path'
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'

const FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true
}

/** Where the packaged Electron binary lives, whatever the platform names it. */
function binaryOf(context) {
  const name = context.packager.appInfo.productFilename
  const platform = context.electronPlatformName
  const candidates =
    platform === 'darwin'
      ? [path.join(context.appOutDir, `${name}.app`, 'Contents', 'MacOS', name)]
      : platform === 'win32'
        ? [
            path.join(context.appOutDir, `${name}.exe`),
            path.join(context.appOutDir, 'openspeccontrol.exe')
          ]
        : [path.join(context.appOutDir, name), path.join(context.appOutDir, name.toLowerCase())]
  const known = candidates.find((p) => fs.existsSync(p))
  if (known) return known
  // Fallback: the executable is the biggest regular file of appOutDir (the
  // binary is ~200 MB; resources, locales and paks are far smaller).
  return fs
    .readdirSync(context.appOutDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const p = path.join(context.appOutDir, e.name)
      return { p, size: fs.statSync(p).size }
    })
    .sort((a, b) => b.size - a.size)[0]?.p
}

export default async function afterPack(context) {
  const binary = binaryOf(context)
  if (!binary) throw new Error(`[electron-fuses] no binary found in ${context.appOutDir}`)
  console.log(`[electron-fuses] flipping fuses on ${binary}`)
  await flipFuses(binary, {
    version: FuseVersion.V1,
    ...FUSES,
    // the flip breaks the ad-hoc signature macOS adds; signing comes later
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin'
  })
  console.log('[electron-fuses] done')
}

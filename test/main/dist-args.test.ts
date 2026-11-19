// Fase 8 (8.2, 8.3, 8.5, 8.6): la configuración de empaquetado cumple lo
// pedido (appId, sin permisos sobrantes en macOS, sin snap, sin secretos) y
// scripts/dist-args.mjs solo inyecta Azure Trusted Signing con las cuatro
// variables AZURE_SIGN_* presentes.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  azureSignOverrides,
  electronBuilderArgs,
  targetsWindows
} from '../../scripts/dist-args.mjs'

const root = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)
// js-yaml llega como dependencia de electron-builder (no es dependencia directa)
const yaml = require('js-yaml') as { load: (text: string) => Record<string, any> }
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
const cfg = yaml.load(read('electron-builder.yml'))
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

describe('electron-builder.yml', () => {
  it('identidad, salida y contenido del paquete', () => {
    expect(cfg.appId).toBe('io.github.ricbalda.openspeccontrol')
    expect(cfg.productName).toBe('OpenSpecControl')
    expect(cfg.win.executableName).toBe('openspeccontrol')
    expect(cfg.directories.output).toBe('release/${version}')
    expect(cfg.asar).toBe(true)
    expect(cfg.asarUnpack).toEqual(['resources/**'])
    expect(cfg.files).toEqual(['out/**', 'package.json', 'LICENSE', 'NOTICE'])
    expect(cfg.afterPack).toBe('scripts/electron-fuses.mjs')
    expect(cfg.publish).toEqual({ provider: 'github', owner: 'ricbalda', repo: 'openspeccontrol' })
  })

  it('Windows: NSIS por usuario x64 + arm64 y nombre visible', () => {
    expect(cfg.win.target).toEqual([{ target: 'nsis', arch: ['x64', 'arm64'] }])
    expect(cfg.nsis.oneClick).toBe(true)
    expect(cfg.nsis.perMachine).toBe(false)
    expect(cfg.nsis.buildUniversalInstaller).toBe(false)
    expect(cfg.nsis.artifactName).toBe('${productName}-${version}-${arch}-setup.${ext}')
  })

  it('macOS: dmg + zip universales, hardened runtime y sin permisos sobrantes', () => {
    expect(cfg.mac.target).toEqual([
      { target: 'dmg', arch: 'universal' },
      { target: 'zip', arch: 'universal' }
    ])
    expect(cfg.mac.hardenedRuntime).toBe(true)
    expect(cfg.mac.entitlements).toBe('build/entitlements.mac.plist')
    expect(cfg.dmg.artifactName).toBe('${productName}-${version}.${ext}')
    expect(JSON.stringify(cfg.mac.extendInfo ?? [])).not.toMatch(
      /Camera|Microphone|Documents|Downloads/
    )
    expect(fs.existsSync(path.join(root, 'build/entitlements.mac.plist'))).toBe(true)
  })

  it('Linux: AppImage + deb x64 + arm64, sin snap y con maintainer real', () => {
    const targets = cfg.linux.target.map((t: { target: string }) => t.target)
    expect(targets).toEqual(['AppImage', 'deb'])
    for (const t of cfg.linux.target) expect(t.arch).toEqual(['x64', 'arm64'])
    expect(cfg.linux.category).toBe('Development')
    expect(cfg.linux.maintainer).toMatch(/^Ricardo Balda <.+@.+>$/)
    expect(cfg.linux.maintainer).not.toMatch(/electronjs\.org/)
    expect(JSON.stringify(cfg)).not.toMatch(/snap/i)
  })

  it('no incluye secretos ni credenciales de firma', () => {
    const text = read('electron-builder.yml')
    expect(text).not.toMatch(/^\s*(cscLink|cscKeyPassword|certificatePassword|password)\s*:/m)
    expect(cfg.win.azureSignOptions).toBeUndefined()
  })

  it('los iconos existen y son de 1024x1024', () => {
    for (const rel of ['build/icon.png', 'resources/icon.png']) {
      const png = fs.readFileSync(path.join(root, rel))
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024])
    }
  })
})

describe('scripts de package.json (8.6)', () => {
  it('define dist, dist:win, dist:mac, dist:linux y dist:dir y retira los build:*', () => {
    for (const name of ['dist', 'dist:win', 'dist:mac', 'dist:linux', 'dist:dir'])
      expect(pkg.scripts[name]).toContain('scripts/dist.mjs')
    for (const name of ['build:win', 'build:mac', 'build:linux', 'build:unpack'])
      expect(pkg.scripts[name]).toBeUndefined()
  })
})

describe('dist-args (firma de Windows por variables de entorno)', () => {
  const azure = {
    AZURE_SIGN_ENDPOINT: 'https://eus.codesigning.azure.net',
    AZURE_SIGN_ACCOUNT: 'cuenta',
    AZURE_SIGN_PROFILE: 'perfil',
    AZURE_SIGN_PUBLISHER: 'Ricardo Balda'
  }

  it('sin variables no añade nada (instalador sin firmar o firma por CSC_LINK)', () => {
    expect(electronBuilderArgs(['--win'], {}, 'win32')).toEqual(['--win'])
    expect(azureSignOverrides({ ...azure, AZURE_SIGN_PROFILE: '' })).toEqual([])
  })

  it('con las cuatro variables añade azureSignOptions al build de Windows', () => {
    const args = electronBuilderArgs(['--win'], azure, 'linux')
    expect(args).toContain('-c.win.azureSignOptions.endpoint=https://eus.codesigning.azure.net')
    expect(args).toContain('-c.win.azureSignOptions.codeSigningAccountName=cuenta')
    expect(args).toContain('-c.win.azureSignOptions.certificateProfileName=perfil')
    expect(args).toContain('-c.win.azureSignOptions.publisherName=Ricardo Balda')
  })

  it('no las añade a builds de otras plataformas ni a --dir', () => {
    expect(electronBuilderArgs(['--mac'], azure, 'win32')).toEqual(['--mac'])
    expect(electronBuilderArgs(['--linux'], azure, 'win32')).toEqual(['--linux'])
    expect(electronBuilderArgs(['--dir'], azure, 'win32')).toEqual(['--dir'])
  })

  it('sin plataforma explícita decide por el SO actual', () => {
    expect(targetsWindows([], 'win32')).toBe(true)
    expect(targetsWindows([], 'darwin')).toBe(false)
  })
})

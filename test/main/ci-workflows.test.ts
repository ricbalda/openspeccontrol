// Fase 10 (tareas 10.1 a 10.4): los workflows de GitHub Actions son YAML válido,
// tienen la forma pedida (matriz, orden de pasos, xvfb en Linux, tags v*, release
// en borrador con latest*.yml), solo invocan scripts y archivos que existen, no
// llevan secretos en claro y el README documenta los nombres de secretos.
//
// Los workflows solo pueden EJECUTARse en GitHub: esta prueba cubre lo estático.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  MAC_CERT,
  NOTARIZE_API_KEY,
  NOTARIZE_APPLE_ID,
  WINDOWS_AZURE,
  WINDOWS_CERT
} from '../../scripts/release-check-lib.mjs'

const root = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)
// js-yaml llega como dependencia de electron-builder (no es dependencia directa)
const yaml = require('js-yaml') as { load: (text: string) => any }
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
const load = (rel: string): any => yaml.load(read(rel))

const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
const ci = load('.github/workflows/ci.yml')
const release = load('.github/workflows/release.yml')

/** `on` es booleano en YAML 1.1; js-yaml 4 lo deja como texto, aceptamos ambos */
const triggers = (doc: any): any => doc.on ?? doc['true']

/** Todos los pasos `run` de un workflow, en orden */
const runs = (doc: any): string[] =>
  Object.values<any>(doc.jobs)
    .flatMap((j) => j.steps ?? [])
    .map((s: any) => s.run)
    .filter((r): r is string => typeof r === 'string')

describe('sintaxis y referencias (ci.yml y release.yml)', () => {
  for (const [name, doc] of [
    ['ci.yml', ci],
    ['release.yml', release]
  ] as const) {
    it(`${name}: define nombre, disparadores y trabajos con pasos`, () => {
      expect(typeof doc.name).toBe('string')
      expect(triggers(doc)).toBeTruthy()
      for (const job of Object.values<any>(doc.jobs)) {
        expect(job['runs-on']).toBeTruthy()
        expect(job.steps.length).toBeGreaterThan(0)
      }
    })

    it(`${name}: cada \`npm run <script>\` existe en package.json`, () => {
      const used = runs(doc).flatMap((r) => [...r.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]))
      expect(used.length).toBeGreaterThan(0)
      for (const script of used) expect(pkg.scripts, `script ${script}`).toHaveProperty(script)
    })

    it(`${name}: cada \`node scripts/*.mjs\` existe y las acciones llevan versión`, () => {
      const files = runs(doc).flatMap((r) =>
        [...r.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1])
      )
      for (const f of files) expect(fs.existsSync(path.join(root, f)), f).toBe(true)
      for (const job of Object.values<any>(doc.jobs)) {
        for (const step of job.steps) {
          if (step.uses) expect(step.uses, step.uses).toMatch(/^[\w.-]+\/[\w.-]+@v\d+/)
        }
      }
    })

    it(`${name}: ningún secreto se interpola dentro de un \`run\` (solo vía env)`, () => {
      for (const r of runs(doc)) expect(r).not.toMatch(/\$\{\{\s*secrets\./)
    })
  }
})

describe('ci.yml (10.1 y 10.2)', () => {
  const job = ci.jobs.ci

  it('se ejecuta en PR y en push a main', () => {
    expect(triggers(ci)).toHaveProperty('pull_request')
    expect(triggers(ci).push.branches).toContain('main')
  })

  it('matriz: ubuntu, windows y macos × Node 22 y 24, sin cortar el resto si una falla', () => {
    expect(job.strategy.matrix.os).toEqual(['ubuntu-latest', 'windows-latest', 'macos-latest'])
    expect(job.strategy.matrix.node).toEqual([22, 24])
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job['runs-on']).toBe('${{ matrix.os }}')
  })

  it('ejecuta los pasos en orden: ci → lint → typecheck → test → build → arranque → dist:dir', () => {
    const cmds: string[] = job.steps.map((s: any) => s.run).filter(Boolean)
    const at = (needle: string): number => cmds.findIndex((c) => c.includes(needle))
    const order = [
      'npm ci',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npx electron-vite build',
      'scripts/ci-smoke.mjs',
      'npm run dist:dir'
    ].map(at)
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('en Linux el arranque de prueba va bajo xvfb-run; en el resto, directo', () => {
    const smoke = job.steps.filter((s: any) => s.run?.includes('ci-smoke.mjs'))
    expect(smoke).toHaveLength(2)
    const linux = smoke.find((s: any) => s.if === "runner.os == 'Linux'")
    const other = smoke.find((s: any) => s.if === "runner.os != 'Linux'")
    expect(linux.run).toMatch(/^xvfb-run -a node scripts\/ci-smoke\.mjs/)
    expect(other.run).toBe('node scripts/ci-smoke.mjs')
  })

  it('no firma ni recibe secretos', () => {
    expect(job.env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    expect(read('.github/workflows/ci.yml')).not.toMatch(/secrets\./)
  })
})

describe('ci-smoke.mjs (10.2)', () => {
  const smoke = read('scripts/ci-smoke.mjs')

  it('usa --remote-debugging-port y comprueba #root y errores de consola', () => {
    expect(smoke).toContain('--remote-debugging-port')
    expect(smoke).toContain('ROOT_PROBE')
    expect(smoke).toContain('describeConsoleError')
  })

  it('aísla datos y perfil en un directorio temporal', () => {
    expect(smoke).toContain('OSC_DATA')
    expect(smoke).toContain('--user-data-dir')
  })
})

describe('release.yml (10.3)', () => {
  const jobs = release.jobs

  it('solo se dispara con etiquetas v*', () => {
    expect(triggers(release).push.tags).toEqual(['v*'])
    expect(triggers(release).push.branches).toBeUndefined()
  })

  it('verify comprueba etiqueta y secretos antes de construir; build y release esperan', () => {
    expect(jobs.verify.steps.some((s: any) => s.run?.includes('release-check.mjs --tag'))).toBe(
      true
    )
    expect(jobs.verify.steps.some((s: any) => s.run?.includes('--signing'))).toBe(true)
    expect(jobs.build.needs).toBe('verify')
    expect(jobs.release.needs).toBe('build')
  })

  it('construye Windows, macOS y Linux con los scripts dist* y sin que electron-builder publique', () => {
    const oss = jobs.build.strategy.matrix.include.map((i: any) => i.os)
    expect(oss).toEqual(['windows-latest', 'macos-latest', 'ubuntu-latest'])
    const all = runs(release).join('\n')
    for (const s of ['dist:win', 'dist:mac', 'dist:linux']) {
      expect(all).toMatch(new RegExp(`npm run ${s} -- --publish never`))
    }
  })

  it('sube instaladores, blockmap y latest*.yml; falla si no hay archivos', () => {
    const up = jobs.build.steps.find((s: any) => s.uses?.startsWith('actions/upload-artifact'))
    expect(up.with['if-no-files-found']).toBe('error')
    const paths = String(up.with.path)
    for (const ext of [
      '*.exe',
      '*.dmg',
      '*.zip',
      '*.AppImage',
      '*.deb',
      '*.blockmap',
      'latest*.yml'
    ]) {
      expect(paths).toContain(`release/*/${ext}`)
    }
  })

  it('el release se crea en BORRADOR, solo con permiso de escritura en ese trabajo', () => {
    const create = jobs.release.steps.map((s: any) => s.run ?? '').join('\n')
    expect(create).toContain('gh release create')
    expect(create).toContain('--draft')
    expect(create).toContain('--verify-tag')
    expect(release.permissions).toEqual({ contents: 'read' })
    expect(jobs.release.permissions).toEqual({ contents: 'write' })
  })

  const expected = [
    ...WINDOWS_CERT,
    ...WINDOWS_AZURE,
    ...MAC_CERT,
    ...NOTARIZE_API_KEY,
    ...NOTARIZE_APPLE_ID
  ]
  const used = [
    ...new Set(
      [...read('.github/workflows/release.yml').matchAll(/secrets\.(\w+)/g)].map((m) => m[1])
    )
  ]

  it('los secretos del workflow son exactamente los que exige release-check', () => {
    expect([...used].sort()).toEqual([...expected].sort())
  })

  it('no hay valores en claro: cada secreto se lee de `secrets.*` y nunca se asigna un literal', () => {
    const text = read('.github/workflows/release.yml')
    for (const name of expected) {
      const assigned = [...text.matchAll(new RegExp(`^\\s+${name}:\\s*(.*)$`, 'gm'))].map(
        (m) => m[1]
      )
      for (const value of assigned)
        expect(value, name).toMatch(/^\$\{\{ (secrets\.\w+|env\.\w+) \}\}$/)
    }
  })

  it('cada secreto está documentado por nombre en la cabecera del workflow y en el README', () => {
    const header = read('.github/workflows/release.yml').split('\njobs:')[0]
    const readme = read('README.md')
    for (const name of expected) {
      expect(header, `cabecera: ${name}`).toContain(name)
      expect(readme, `README: ${name}`).toContain(name)
    }
  })
})

describe('README: Development → Crear un release (10.4)', () => {
  const readme = read('README.md')
  const section = readme.slice(readme.indexOf('### Crear un release'))

  it('existe la sección bajo Development', () => {
    expect(readme).toMatch(/^## Development\r?$/m)
    expect(readme).toMatch(/^### Crear un release\r?$/m)
    expect(readme.indexOf('## Development')).toBeLessThan(readme.indexOf('### Crear un release'))
  })

  it('usa los scripts dist* que existen y el nombre de instalador por arquitectura', () => {
    for (const s of ['dist:win', 'dist:mac', 'dist:linux', 'dist:dir']) {
      expect(section).toContain(`npm run ${s}`)
      expect(pkg.scripts).toHaveProperty(s)
    }
    expect(section).toContain('OpenSpecControl-<version>-<arch>-setup.exe')
    // coincide con la plantilla real de electron-builder.yml
    expect(read('electron-builder.yml')).toContain(
      'artifactName: ${productName}-${version}-${arch}-setup.${ext}'
    )
  })

  it('menciona las etiquetas v*, el borrador y los latest*.yml', () => {
    expect(section).toMatch(/git tag v/)
    expect(section).toMatch(/borrador/i)
    expect(section).toContain('latest.yml')
  })
})

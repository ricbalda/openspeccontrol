// shell-env (tarea 6.1): parsing the login shell's env dump between markers,
// merging it without overwriting what the process already has, the timeout
// that gives up on a hanging shell, and the fallback to known PATH locations.
// Everything runs against the pure helpers and an injected runner, so no real
// shell is spawned here (macOS/Linux behavior verified on the real platform in
// tarea 6.6, documented as not verifiable on this Windows machine).

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyShellEnv,
  ENV_BEGIN,
  ENV_END,
  fallbackPaths,
  KNOWN_PATHS,
  mergeShellEnv,
  parseEnvDump,
  readLoginShellEnv,
  SHELL_ENV_TIMEOUT_MS,
  unionPath
} from '../../src/main/desktop/shell-env.ts'

const D = path.delimiter

describe('parseEnvDump (tarea 6.1: parseo con delimitadores)', () => {
  it('keeps only what is between the markers, skipping banners and junk lines', () => {
    const out = [
      'Welcome to zsh 5.9', // rc-file banner before the first marker
      ENV_BEGIN,
      'PATH=/usr/bin:/bin',
      'https_proxy=http://proxy:3128',
      'WEIRD VALUE WITHOUT EQUALS',
      '=starts-with-equals',
      '9INVALID=1',
      'TOKEN=a=b=c', // values may hold more '='
      ENV_END,
      'some goodbye message' // noise after the last marker
    ].join('\n')
    expect(parseEnvDump(out)).toEqual({
      PATH: '/usr/bin:/bin',
      https_proxy: 'http://proxy:3128',
      TOKEN: 'a=b=c'
    })
  })

  it('returns null when the markers are missing (unparseable output)', () => {
    expect(parseEnvDump('PATH=/usr/bin')).toBeNull()
    expect(parseEnvDump(`${ENV_END} before ${ENV_BEGIN}`)).toBeNull()
    expect(parseEnvDump('')).toBeNull()
  })
})

describe('mergeShellEnv', () => {
  it('unions PATH with the login shell entries first, without duplicates', () => {
    const merged = mergeShellEnv(
      { PATH: `/bin${D}/usr/bin${D}/extra` },
      { PATH: `/opt/homebrew/bin${D}/usr/bin` }
    )
    expect(merged.PATH).toBe(`/opt/homebrew/bin${D}/usr/bin${D}/bin${D}/extra`)
  })

  it('takes proxy and OSC_*/OPENSPEC_*/REPOS_ROOT/DEFAULT_AGENT only when missing', () => {
    const merged = mergeShellEnv(
      { PATH: '/bin', REPOS_ROOT: '/mine', EDITOR: 'vi' },
      {
        no_proxy: 'localhost',
        HTTP_PROXY: 'http://p:1',
        OSC_DATA: '/from-shell',
        OPENSPEC_BIN: '/custom/openspec',
        REPOS_ROOT: '/from-shell', // process wins
        DEFAULT_AGENT: 'codex',
        EDITOR: 'nano' // not ours: ignored
      }
    )
    expect(merged.no_proxy).toBe('localhost')
    expect(merged.HTTP_PROXY).toBe('http://p:1')
    expect(merged.OSC_DATA).toBe('/from-shell')
    expect(merged.OPENSPEC_BIN).toBe('/custom/openspec')
    expect(merged.REPOS_ROOT).toBe('/mine')
    expect(merged.DEFAULT_AGENT).toBe('codex')
    expect(merged.EDITOR).toBe('vi')
  })

  it('never overwrites a variable the process already has', () => {
    const merged = mergeShellEnv({ PATH: '/bin', OSC_DB: ':memory:' }, { OSC_DB: '/other' })
    expect(merged.OSC_DB).toBe(':memory:')
  })
})

describe('applyShellEnv fallback (el shell de login no responde)', () => {
  it('prepends the known locations that exist when the shell env is null', () => {
    const home = path.join(path.sep, 'home', 'dev')
    const exists = (p: string) => p === '/opt/homebrew/bin' || p === path.join(home, '.volta/bin')
    const env: Record<string, string | undefined> = { PATH: `/usr/bin${D}/bin` }
    const outcome = applyShellEnv(env, null, { home, exists })
    expect(outcome.source).toBe('fallback')
    expect(outcome.added).toEqual(['PATH'])
    expect(env.PATH).toBe(
      ['/opt/homebrew/bin', path.join(home, '.volta/bin'), `/usr/bin${D}/bin`].join(D)
    )
  })

  it('covers the four known locations (~ expands against home)', () => {
    const home = path.join(path.sep, 'home', 'dev')
    const all = fallbackPaths(home, () => true)
    expect(all).toEqual([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(home, '.volta/bin'),
      path.join(home, '.local/bin')
    ])
    expect(KNOWN_PATHS).toHaveLength(4)
  })

  it('reports what the login shell contributed', () => {
    const env: Record<string, string | undefined> = { PATH: '/bin' }
    const outcome = applyShellEnv(env, { PATH: '/bin', DEFAULT_AGENT: 'opencode' })
    expect(outcome).toEqual({ skipped: false, source: 'login-shell', added: ['DEFAULT_AGENT'] })
    expect(env.DEFAULT_AGENT).toBe('opencode')
  })
})

describe('readLoginShellEnv (timeout y ejecución)', () => {
  it('parses the env the runner returns between the markers', async () => {
    const run = async (_sh: string, args: string[]) => ({
      ok: true,
      stdout: `noise\n${args.join(' ')}\n${ENV_BEGIN}\nPATH=/shell/bin\nOSC_DATA=/d\n${ENV_END}\n`,
      stderr: ''
    })
    expect(await readLoginShellEnv({ run, timeoutMs: 1000 })).toEqual({
      PATH: '/shell/bin',
      OSC_DATA: '/d'
    })
  })

  it('gives up when the login shell hangs (timeout) and answers null', async () => {
    const run = () => new Promise<never>(() => {}) // a shell waiting for a tty, forever
    const started = Date.now()
    expect(await readLoginShellEnv({ run, timeoutMs: 30 })).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('answers null when the shell fails (non-zero exit)', async () => {
    const run = async () => ({ ok: false, stdout: '', stderr: 'fish: unknown option -i' })
    expect(await readLoginShellEnv({ run, timeoutMs: 100 })).toBeNull()
  })

  it('uses a ~5 s timeout by default', () => {
    expect(SHELL_ENV_TIMEOUT_MS).toBe(5000)
  })
})

describe('unionPath', () => {
  it('deduplicates keeping the first occurrence of each entry', () => {
    expect(unionPath(`a${D}b${D}c`, `b${D}d`)).toBe(`a${D}b${D}c${D}d`)
    expect(unionPath('', `x${D}x`)).toBe('x')
  })
})

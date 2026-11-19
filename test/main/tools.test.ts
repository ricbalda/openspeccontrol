// tools (tarea 6.3): the dependency check behind config().tools — node, npx,
// openspec (OPENSPEC_BIN) and git, probed with `<cmd> --version` and located
// with where/which. The fake runner covers present and absent tools without
// touching the real PATH; one real probe sanity-checks the default runner.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectTools, INSTALL_HINTS, TOOL_IDS } from '../../src/main/desktop/tools.ts'

/** Route --version and where/which probes from a { cmd: { version, path } } table. */
function fakeRunner(map: Record<string, { version?: string; path?: string }>) {
  return async (cmd: string, args: string[]) => {
    // version probes run <cmd> --version; location probes run where/which <cmd>
    const t = map[args[0] === '--version' ? cmd : args[0]]
    if (args[0] === '--version')
      return t?.version !== undefined
        ? { ok: true, stdout: `${t.version}\n`, stderr: '' }
        : { ok: false, stdout: '', stderr: `not found: ${cmd}` }
    return t?.path
      ? { ok: true, stdout: `${t.path}\r\n/usr/bin/${args[0]}\n`, stderr: '' } // first line wins
      : { ok: false, stdout: '', stderr: '' }
  }
}

const ALL_PRESENT = {
  node: { version: 'v24.22.3', path: '/usr/local/bin/node' },
  npx: { version: '12.2.3', path: '/usr/local/bin/npx' },
  openspec: { version: '2.0.0', path: '/usr/local/bin/openspec' },
  git: { version: 'git version 2.51.0', path: '/usr/bin/git' }
}

afterEach(() => vi.unstubAllEnvs())

describe('detectTools (tarea 6.3)', () => {
  it('reports the four tools in order when they are installed', async () => {
    const tools = await detectTools(fakeRunner(ALL_PRESENT))
    expect(tools.map((t) => t.id)).toEqual(TOOL_IDS)
    expect(tools).toEqual([
      { id: 'node', found: true, version: 'v24.22.3', path: '/usr/local/bin/node' },
      { id: 'npx', found: true, version: '12.2.3', path: '/usr/local/bin/npx' },
      { id: 'openspec', found: true, version: '2.0.0', path: '/usr/local/bin/openspec' },
      { id: 'git', found: true, version: 'git version 2.51.0', path: '/usr/bin/git' }
    ])
  })

  it('marks a missing tool with its install hint (openspec carries the command)', async () => {
    const { openspec: _missing, ...present } = ALL_PRESENT
    const tools = await detectTools(fakeRunner(present))
    const osc = tools.find((t) => t.id === 'openspec')!
    expect(osc.found).toBe(false)
    expect(osc.version).toBeUndefined()
    expect(osc.path).toBeUndefined()
    expect(osc.hint).toBe('npm install -g @fission-ai/openspec')
    expect(tools.find((t) => t.id === 'node')!.found).toBe(true)
  })

  it('answers found with no hint for every missing tool', async () => {
    const tools = await detectTools(fakeRunner({}))
    expect(tools).toHaveLength(4)
    for (const t of tools) {
      expect(t.found).toBe(false)
      expect(t.hint).toBe(INSTALL_HINTS[t.id])
    }
    expect(INSTALL_HINTS.openspec).toBe('npm install -g @fission-ai/openspec')
  })

  it('honors OPENSPEC_BIN: probes that binary and reports it as its own path', async () => {
    vi.stubEnv('OPENSPEC_BIN', '/custom/openspec')
    const tools = await detectTools(
      fakeRunner({ '/custom/openspec': { version: '2.1.0' }, node: ALL_PRESENT.node })
    )
    const osc = tools.find((t) => t.id === 'openspec')!
    expect(osc).toEqual({ id: 'openspec', found: true, version: '2.1.0', path: '/custom/openspec' })
  })

  it('the real runner finds node (the process running these tests)', async () => {
    const tools = await detectTools()
    const node = tools.find((t) => t.id === 'node')!
    expect(node.found).toBe(true)
    expect(node.version).toMatch(/^v\d+/)
    expect(node.path).toBeTruthy()
  }, 15_000)
})

// WSL as a network folder (tarea 6.5): the app runs native on Windows and
// repos inside a distro are reached through `\\wsl$\…` / `\\wsl.localhost\…`
// UNC paths — ordinary folders for the workspace code, with the CLIs on the
// Windows side. This adds a repo over UNC, lists it (discovery) and, when the
// openspec CLI is installed, lists its changes. Skipped where no WSL distro is
// reachable (CI, macOS, Linux).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// the data dir (config.json with the roots) — only created when the suite runs
const DATA = path.join(os.tmpdir(), `osc-wsl-data-${process.pid}`)
process.env.OSC_DATA = DATA
delete process.env.REPOS_ROOT

const ws = await import('../../src/main/core/workspace.ts')
const { initDataDir } = await import('../../src/main/core/repos.ts')

/** First reachable distro share, trying both aliases (\\wsl.localhost first). */
function firstWslShare(): string | null {
  if (process.platform !== 'win32') return null
  for (const share of ['\\\\wsl.localhost\\', '\\\\wsl$\\']) {
    try {
      const distro = fs.readdirSync(share)[0]
      if (distro) return path.join(share, distro)
    } catch {
      /* host not reachable on this machine */
    }
  }
  return null
}

const share = firstWslShare()
// the repo lives inside the distro's filesystem, reached as a network folder
const base = share ? path.join(share, 'tmp', `osc-wsl-${process.pid}`) : null

beforeAll(() => {
  initDataDir(DATA)
  ws.loadWorkspaceConfig()
  const change = path.join(base!, 'repo-a', 'openspec', 'changes', 'add-demo')
  fs.mkdirSync(change, { recursive: true })
  fs.writeFileSync(path.join(change, 'proposal.md'), '# add-demo\n\n## Why\nVerify WSL.\n')
  fs.writeFileSync(path.join(change, 'tasks.md'), '# Tasks\n\n- [ ] 1. do it\n')
}, 120_000)

afterAll(() => {
  fs.rmSync(DATA, { recursive: true, force: true })
  if (base) fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
}, 120_000)

;(share ? describe : describe.skip)('WSL as a network folder (tarea 6.5)', () => {
  it('adds a repo through \\\\wsl.localhost\\… and lists it', async () => {
    const added = ws.addRoot(base!)
    expect(added.toLowerCase().startsWith('\\\\wsl')).toBe(true) // realpath may switch the alias
    const repos = (await ws.findRepos(true)).repos
    const repo = repos.find((r) => r.name === 'repo-a')
    expect(repo).toBeTruthy()
    expect(repo!.id.toLowerCase().startsWith('\\\\wsl')).toBe(true)
    // repoPath maps the UNC id back to the folder inside our roots
    expect(ws.repoPath(repo!.id)).toBeTruthy()
  }, 120_000)

  it('lists the changes of a repo inside WSL (openspec CLI on the Windows side)', async () => {
    const openspec = await import('../../src/main/core/openspec.ts')
    const repo = (await ws.findRepos()).repos.find((r) => r.name === 'repo-a')!
    const probe = await openspec.run(['--version'], repo.id, 10_000)
    if (!probe.ok) {
      console.warn('openspec CLI not installed; change listing over UNC not verified here')
      return
    }
    const changes = await openspec.listChanges(repo.id, () => [])
    expect(changes.map((c) => c.name)).toContain('add-demo')
  }, 120_000)
})

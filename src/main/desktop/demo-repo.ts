// Fase 5.7: the demo repo creator, ported from scripts/demo-repo.mjs to fully
// async IO (fs/promises + runCmd) so running it from the app never blocks the
// main process. The file tree is shared with the script through
// scripts/demo-repo-files.mjs.
//
// Not wired to the menu yet (the menu belongs to Fase 4); the intended wiring
// for Ayuda → "Create demo repository…" is:
//
//   const picked = await dialog.showOpenDialog(win, {
//     title: 'Create demo repository', properties: ['openDirectory', 'createDirectory']
//   })
//   if (picked.canceled) return
//   const r = await createDemoRepo({ root: picked.filePaths[0], tools: agentId })
//   await core.addRoot({ path: dirname(r.repo) })   // or r.repo itself
//   // …then select r.repo in the renderer (the menu's ServerMsg, Fase 4): the
//   // change r.change ('add-hello-endpoint') is waiting in "In review".

import fs from 'node:fs/promises'
import path from 'node:path'
import { runCmd } from '../core/proc.ts'
import * as openspec from '../core/openspec.ts'
import { DEMO_CHANGE, DEMO_REPO_NAME, demoFiles } from '../../../scripts/demo-repo-files.mjs'

/** The external commands createDemoRepo runs; tests stub them. */
export interface DemoRunners {
  git(args: string[], cwd: string): Promise<{ ok: boolean; stderr: string }>
  openspecInit(repo: string, tool: string): Promise<{ ok: boolean; out: string }>
}

const defaultRunners: DemoRunners = {
  // cross-spawn through runCmd: handles the .cmd shims of npm CLIs on Windows
  git: (args, cwd) => runCmd('git', args, { cwd, timeout: 60_000 }),
  openspecInit: (repo, tool) => openspec.init(repo, tool)
}

export interface CreateDemoRepoOptions {
  /** Folder that will hold hello-app (created when missing). */
  root: string
  /** Run `openspec init --tools <id>` (an agent's openspecTool id); skip when null. */
  tools?: string | null
  /** Clock for the change's `created:` date (tests pin it). */
  now?: Date
  /** Command stubs for tests. */
  runners?: Partial<DemoRunners>
}

export interface DemoRepoResult {
  /** Absolute path of the demo repo: what the UI selects when it's added. */
  repo: string
  /** The active change ('add-hello-endpoint'), already in "In review". */
  change: string
  /** false when --tools was requested but the openspec CLI failed or is missing. */
  openspecOk: boolean
  /** false when git is missing: the repo is still found via its openspec/ folder. */
  gitOk: boolean
  /** What happened, for a toast or the menu action's result dialog. */
  warnings: string[]
}

/**
 * (Re)create <root>/hello-app: a git repo with a zero-dependency Node app, one
 * main spec and the add-hello-endpoint change, all written. Running it again
 * resets the demo, exactly like the dev script.
 */
export async function createDemoRepo(opts: CreateDemoRepoOptions): Promise<DemoRepoResult> {
  const runners = { ...defaultRunners, ...opts.runners }
  const repo = path.join(path.resolve(opts.root), DEMO_REPO_NAME)
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10)
  const warnings: string[] = []

  await fs.rm(repo, { recursive: true, force: true })
  for (const [rel, text] of Object.entries(demoFiles(today))) {
    const f = path.join(repo, rel)
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, text)
  }

  let openspecOk = true
  if (opts.tools) {
    const r = await runners.openspecInit(repo, opts.tools)
    openspecOk = r.ok
    if (!r.ok)
      warnings.push(
        `openspec init failed (is the OpenSpec CLI installed? npm i -g @fission-ai/openspec)\n${r.out.trim()}`
      )
  }

  // a git repo is what the folder scan looks for (an openspec/ folder also counts)
  let gitOk = false
  const git = async (args: string[]) => (await runners.git(args, repo)).ok
  if (await git(['init', '-q'])) {
    if (
      (await git(['add', '-A'])) &&
      (await git([
        '-c',
        'user.name=demo',
        '-c',
        'user.email=demo@example.com',
        'commit',
        '-qm',
        'demo repo'
      ]))
    )
      gitOk = true
  }
  if (!gitOk) warnings.push('git not found: created the files without a git repo')

  return { repo, change: DEMO_CHANGE, openspecOk, gitOk, warnings }
}

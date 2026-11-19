// Fase 6 (tarea 6.3): which external CLIs the app relies on are actually
// reachable — node, npx, openspec and git. `config()` ships the result as
// `tools` so the renderer can warn (Set up OpenSpec, agent panel) and the
// Ayuda → Diagnóstico de dependencias dialog can show the table. Node.js and
// the CLIs stay external on purpose (design D9): the app detects them and
// explains how to install them.

import os from 'node:os'
import { isWindows, runCmd } from '../core/proc.ts'
import type { ToolId, ToolStatus } from '@shared/ipc.ts'

/** The openspec binary: an explicit OPENSPEC_BIN wins (custom installs, tests). */
const openspecCmd = () => process.env.OPENSPEC_BIN || 'openspec'

export const TOOL_IDS: ToolId[] = ['node', 'npx', 'openspec', 'git']

/** What the diagnostics show when a tool is missing (the openspec one is the install command). */
export const INSTALL_HINTS: Record<ToolId, string> = {
  node: 'Install Node.js from https://nodejs.org (the agents and npx need it)',
  npx: 'Comes with Node.js, install it from https://nodejs.org',
  openspec: 'npm install -g @fission-ai/openspec',
  git: 'Install git from https://git-scm.com'
}

/** The slice of a command runner detectTools needs (tests fake this). */
export type ToolRun = (
  cmd: string,
  args: string[],
  timeoutMs: number
) => Promise<{ ok: boolean; stdout: string; stderr: string }>

const defaultRun: ToolRun = (cmd, args, timeoutMs) =>
  runCmd(cmd, args, { cwd: os.homedir(), timeout: timeoutMs })

const firstLine = (s: string): string | undefined => {
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[0] : undefined
}

/** Probe one tool: `<cmd> --version` (short timeout); found means it ran fine. */
async function probe(runner: ToolRun, cmd: string, timeoutMs: number) {
  const r = await runner(cmd, ['--version'], timeoutMs)
  return { found: r.ok, version: r.ok ? firstLine(r.stdout) : undefined }
}

/** Where a command lives (`where` on Windows, `which` elsewhere); null when not on PATH. */
async function locate(
  runner: ToolRun,
  cmd: string,
  timeoutMs: number
): Promise<string | undefined> {
  const r = await runner(isWindows ? 'where' : 'which', [cmd], timeoutMs)
  return r.ok ? firstLine(r.stdout) : undefined
}

/**
 * Detect the four external tools, in parallel. `found` follows the --version
 * probe (a tool may be found yet have no resolvable path, e.g. a shell
 * function); a missing tool carries its install hint.
 */
export async function detectTools(
  runner: ToolRun = defaultRun,
  timeoutMs = 5000
): Promise<ToolStatus[]> {
  const cmds: Record<ToolId, string> = {
    node: 'node',
    npx: 'npx',
    openspec: openspecCmd(),
    git: 'git'
  }
  return Promise.all(
    TOOL_IDS.map(async (id): Promise<ToolStatus> => {
      const { found, version } = await probe(runner, cmds[id], timeoutMs)
      const status: ToolStatus = { id, found, ...(version ? { version } : {}) }
      if (found) {
        // an explicit path (OPENSPEC_BIN=/custom/openspec) is its own location
        const p = /[\\/]/.test(cmds[id]) ? cmds[id] : await locate(runner, cmds[id], timeoutMs)
        if (p) status.path = p
      } else {
        status.hint = INSTALL_HINTS[id]
      }
      return status
    })
  )
}

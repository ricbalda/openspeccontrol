// tarea 11.5: the core's changes() paints with what it already knows (cache,
// persisted snapshot or local inference) and confirms a stale view in the
// background, notifying subscribers with `changes_updated`. The fake CLI sleeps
// so a blocking answer would be caught by the timing assertion.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerMsg } from '@shared/protocol.ts'
import type { OscCore, Subscriber } from '../../src/main/core/osc-core.ts'

// fake openspec CLI: 600 ms, and its answer differs from the local inference
// (isPlanningComplete: true, a validation error) so tests can tell them apart.
// Each invocation drops one marker file: parallel appends to a single counter
// hit Windows sharing violations.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-core-changes-'))
const counts = path.join(dir, 'runs')
fs.mkdirSync(counts, { recursive: true })
const cliJs = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const [cmd] = process.argv.slice(2)',
  `fs.writeFileSync(path.join(${JSON.stringify(counts)}, process.pid + '-' + Date.now() + '-' + cmd + '.txt'), '')`,
  'await new Promise((r) => setTimeout(r, 600))',
  "if (fs.existsSync('fail-marker')) {",
  "  console.error('boom')",
  '  process.exit(3)',
  '}',
  "if (cmd === 'list') {",
  "  console.log(JSON.stringify({ changes: [{ name: 'c1', completedTasks: 0, totalTasks: 1, lastModified: '2026-01-01T00:00:00.000Z', status: 'in-progress' }] }))",
  "} else if (cmd === 'validate') {",
  "  console.log(JSON.stringify({ items: [{ id: 'c1', type: 'change', valid: false, issues: [{ level: 'ERROR', path: 'c/spec.md', message: 'must include at least one scenario' }] }] }))",
  '  process.exit(1)',
  '} else {',
  "  console.log(JSON.stringify({ changes: [{ changeName: 'c1', artifacts: [{ id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] }], isPlanningComplete: true, isComplete: false }] }))",
  '}'
].join('\n')
fs.writeFileSync(path.join(dir, 'cli.mjs'), cliJs)
if (process.platform === 'win32')
  fs.writeFileSync(path.join(dir, 'openspec.cmd'), '@node "%~dp0cli.mjs" %*\r\n')
else
  fs.writeFileSync(
    path.join(dir, 'openspec'),
    '#!/bin/sh\nexec node "$(dirname "$0")/cli.mjs" "$@"\n',
    { mode: 0o755 }
  )
// BEFORE importing the core: openspec.ts reads OPENSPEC_BIN at import time
process.env.OPENSPEC_BIN = path.join(
  dir,
  process.platform === 'win32' ? 'openspec.cmd' : 'openspec'
)
const { cliViews, closeDb } = await import('../../src/main/core/db.ts')
const { createOscCore } = await import('../../src/main/core/osc-core.ts')
const { openspecSignature, setRefreshRetryMs, refreshView } =
  await import('../../src/main/core/openspec.ts')

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-core-changes-data-'))
delete process.env.REPOS_ROOT

const WORK = path.join(dir, 'work')
const APP = path.join(WORK, 'app')
fs.mkdirSync(path.join(APP, 'openspec', 'changes', 'c1'), { recursive: true })
fs.writeFileSync(path.join(APP, 'openspec', 'changes', 'c1', 'proposal.md'), '# Proposal\n')
fs.writeFileSync(path.join(APP, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.1 do it\n')

let core: OscCore
const got: ServerMsg[] = []
const sub: Subscriber = { id: 1, send: (m) => got.push(m) }
const runs = () => fs.readdirSync(counts).length

beforeAll(async () => {
  core = createOscCore({ dataDir: DATA, fromStudio: path.join(dir, 'no-studio') })
  await core.addRoot({ path: WORK })
  core.subscribe(sub, APP)
})

afterAll(async () => {
  await core.shutdown()
})

describe('changes(): paint now, confirm in the background (tarea 11.5)', () => {
  it('answers before the CLI finishes, then changes_updated delivers the confirmed view', async () => {
    const t0 = Date.now()
    const first = await core.changes(APP)
    const elapsed = Date.now() - t0
    // the fake CLI sleeps 600 ms: a blocking answer cannot be this fast
    expect(elapsed).toBeLessThan(450)
    expect(first.stale).toBe(true)
    expect(first.active).toHaveLength(1)
    expect(first.active[0]).toMatchObject({ name: 'c1', totalTasks: 1 })
    expect(first.active[0].validation).toBeNull() // inferred: no validation yet
    expect(first.active[0].stage).toBe('draft') // proposal+tasks only, specs/design missing

    // the confirmed view replaces it
    const deadline = Date.now() + 20_000
    while (!got.some((m) => m.type === 'changes_updated' && m.repo === APP)) {
      if (Date.now() > deadline) throw new Error('changes_updated never arrived')
      await new Promise((r) => setTimeout(r, 20))
    }
    const second = await core.changes(APP)
    expect(second.stale).toBe(false)
    expect(second.active[0].validation).toMatchObject({ valid: false })
    expect(second.active[0].isPlanningComplete).toBe(true) // the CLI's graph
    expect(second.active[0].artifacts).toHaveLength(1)
  })

  it('rapid repeated calls share one CLI run (no process storm)', async () => {
    const before = runs()
    fs.appendFileSync(path.join(APP, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.2 x\n')
    const [a, b, c] = await Promise.all([core.changes(APP), core.changes(APP), core.changes(APP)])
    for (const r of [a, b, c]) {
      expect(r.stale).toBe(true) // the edit invalidated the confirmed view
      expect(r.active[0].totalTasks).toBe(2) // but the fresh disk state painted at once
    }
    // let the background refresh settle
    const seen = got.filter((m) => m.type === 'changes_updated' && m.repo === APP).length
    const deadline = Date.now() + 20_000
    while (got.filter((m) => m.type === 'changes_updated' && m.repo === APP).length === seen) {
      if (Date.now() > deadline) throw new Error('second changes_updated never arrived')
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(runs()).toBe(before + 3) // exactly one list+status+validate triple
    expect(await core.changes(APP)).toMatchObject({ stale: false })
  })

  it('the confirmed view is persisted and survives a restart of the core', async () => {
    const saved = cliViews.get(APP)
    expect(saved).not.toBeNull()
    expect(saved!.sig).toBe(openspecSignature(APP))
    expect(saved!.view.list.changes).toHaveLength(1)
    await core.shutdown()
    closeDb()

    // a restarted process adopts the snapshot when the signature still matches:
    // no CLI run, fresh answer
    const before = runs()
    core = createOscCore({ dataDir: DATA, fromStudio: path.join(dir, 'no-studio') })
    core.subscribe(sub, APP) // the new core has no subscribers yet
    const afterRestart = await core.changes(APP)
    expect(afterRestart.stale).toBe(false)
    expect(runs()).toBe(before)
    expect(afterRestart.active[0].validation).toMatchObject({ valid: false })
  })

  it('a repo without openspec/changes answers empty and fresh, without the CLI', async () => {
    const NOT_OPENSPEC = path.join(WORK, 'plain')
    fs.mkdirSync(path.join(NOT_OPENSPEC, '.git'), { recursive: true })
    const before = runs()
    const r = await core.changes(NOT_OPENSPEC)
    expect(r).toMatchObject({ active: [], archived: [], stale: false })
    expect(runs()).toBe(before)
  })

  it('a broken CLI does not spin: backoff stops the refresh loop', async () => {
    fs.writeFileSync(path.join(APP, 'fail-marker'), '')
    fs.appendFileSync(path.join(APP, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.3 y\n')
    const first = await core.changes(APP)
    expect(first.stale).toBe(true)
    expect(first.refreshError).toBeNull() // nothing failed yet

    // the failing refresh still notifies (the UI swaps spinner → warning)
    const seen = got.filter((m) => m.type === 'changes_updated' && m.repo === APP).length
    const deadline = Date.now() + 20_000
    while (got.filter((m) => m.type === 'changes_updated' && m.repo === APP).length === seen) {
      if (Date.now() > deadline) throw new Error('failure changes_updated never arrived')
      await new Promise((r) => setTimeout(r, 20))
    }
    const second = await core.changes(APP)
    expect(second.stale).toBe(true)
    expect(second.refreshError).toBeTruthy()

    // the refetches that message causes (and any other changes() call) must not
    // respawn the CLI for the same content: no process storm while broken
    const n = runs()
    for (let i = 0; i < 5; i++) await core.changes(APP)
    await new Promise((r) => setTimeout(r, 700)) // longer than the CLI's sleep
    expect(runs()).toBe(n)

    // recovery: with the backoff off, one refresh confirms again
    fs.rmSync(path.join(APP, 'fail-marker'))
    setRefreshRetryMs(0)
    try {
      await expect(refreshView(APP)).resolves.toBe('fresh')
      expect(await core.changes(APP)).toMatchObject({ stale: false })
    } finally {
      setRefreshRetryMs(15_000)
    }
  }, 30_000)
})

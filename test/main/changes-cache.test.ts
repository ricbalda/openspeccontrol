import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '@shared/protocol.ts'

// A fake openspec CLI that counts its runs (one marker file each: parallel
// appends to a single counter hit Windows sharing violations — the old #!/bin/sh
// version skipped the whole file on Windows, tarea 11.5 covers it here too).
// A `fail-marker` file in the repo makes every call fail, for the no-answer path.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-cli-'))
const counts = path.join(dir, 'runs')
fs.mkdirSync(counts, { recursive: true })
const cliJs = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const [cmd] = process.argv.slice(2)',
  `fs.writeFileSync(path.join(${JSON.stringify(counts)}, process.pid + '-' + Date.now() + '-' + cmd + '.txt'), '')`,
  "if (fs.existsSync('fail-marker')) {",
  "  console.error('boom')",
  '  process.exit(3)',
  '}',
  "if (cmd === 'list') {",
  "  console.log(JSON.stringify({ changes: [{ name: 'c1', completedTasks: 0, totalTasks: 1, lastModified: 'x', status: 'in-progress' }] }))",
  "} else if (cmd === 'validate') {",
  "  console.log(JSON.stringify({ items: [{ id: 'c1', type: 'change', valid: false, issues: [{ level: 'ERROR', path: 'x/spec.md', message: 'must include at least one scenario' }] }] }))",
  '  process.exit(1)',
  '} else {',
  "  console.log(JSON.stringify({ changes: [{ changeName: 'c1', artifacts: [], isPlanningComplete: true, isComplete: false }] }))",
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
process.env.OPENSPEC_BIN = path.join(
  dir,
  process.platform === 'win32' ? 'openspec.cmd' : 'openspec'
)
const openspec = await import('../../src/main/core/openspec.ts')
const { listChanges, currentView, refreshView, setRefreshRetryMs } = openspec

const runs = () => fs.readdirSync(counts).length
const mkRepo = (name: string) => {
  const repo = path.join(dir, name)
  fs.mkdirSync(path.join(repo, 'openspec', 'changes', 'c1'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.1 do it\n')
  return repo
}
const repo = mkRepo('repo')
const comment = (status: ReviewComment['status']) => ({ status }) as ReviewComment

describe('change list CLI cache', () => {
  it('runs the CLI again only when files under openspec/ change (blocking callers get the confirmed view)', async () => {
    let comments = [comment('addressed')]
    const first = await listChanges(repo, () => comments)
    expect(first[0]).toMatchObject({ name: 'c1', openComments: 1, stage: 'review' })
    // validate exits 1 when something is invalid; its report is still used
    expect(first[0].validation).toEqual({
      valid: false,
      issues: [{ level: 'ERROR', path: 'x/spec.md', message: 'must include at least one scenario' }]
    })
    expect(runs()).toBe(3) // list + status + validate

    // resolving the last comment: no file changed, so no CLI run, but the stage follows at once
    comments = [comment('resolved')]
    const second = await listChanges(repo, () => comments)
    expect(second[0]).toMatchObject({ openComments: 0, stage: 'ready' })
    expect(runs()).toBe(3)

    // OpenSpecControl writing the review history into the change folder is not a reason to ask the CLI again
    fs.writeFileSync(
      path.join(repo, 'openspec', 'changes', 'c1', '.openspeccontrol-review.json'),
      '{}'
    )
    await listChanges(repo, () => comments)
    expect(runs()).toBe(3)

    // the agent edits an artifact: the CLI runs again
    fs.writeFileSync(
      path.join(repo, 'openspec', 'changes', 'c1', 'tasks.md'),
      '- [x] 1.1 do it\n- [ ] 1.2 more\n'
    )
    await listChanges(repo, () => comments)
    expect(runs()).toBe(6)
  })

  it('answers at once with an inferred view and the background refresh replaces it (tarea 11.5)', async () => {
    const repo2 = mkRepo('repo2')
    // the full default layout: the inference can derive the artifact graph
    fs.mkdirSync(path.join(repo2, 'openspec', 'changes', 'c1', 'specs', 'c'), { recursive: true })
    fs.writeFileSync(path.join(repo2, 'openspec', 'changes', 'c1', 'proposal.md'), '# Proposal\n')
    fs.writeFileSync(path.join(repo2, 'openspec', 'changes', 'c1', 'design.md'), '# Design\n')
    fs.writeFileSync(
      path.join(repo2, 'openspec', 'changes', 'c1', 'specs', 'c', 'spec.md'),
      '# c\n'
    )
    const resolved = [comment('resolved')]
    const before = runs()

    // cold: no cache, nothing persisted → local inference, marked stale
    const cold = currentView(repo2)
    expect(cold.stale).toBe(true)
    expect(cold.refreshError).toBeNull()
    const painted = await listChanges(repo2, () => [], {
      view: cold.view,
      provisional: cold.stale
    })
    expect(runs()).toBe(before) // painting spawned no process
    expect(painted[0]).toMatchObject({ name: 'c1', totalTasks: 1, status: 'in-progress' })
    expect(painted[0].validation).toBeNull() // only the CLI validates
    expect(painted[0].isPlanningComplete).toBe(true) // all four artifacts exist on disk

    // the refresh confirms: validation and the CLI's own graph arrive
    await expect(refreshView(repo2)).resolves.toBe('fresh')
    expect(runs()).toBe(before + 3)
    const warm = currentView(repo2)
    expect(warm.stale).toBe(false)
    const confirmed = await listChanges(repo2, () => resolved, { view: warm.view })
    expect(confirmed[0].validation).toMatchObject({ valid: false })
    expect(confirmed[0].isPlanningComplete).toBe(true) // the fake status says so
    expect(confirmed[0].stage).toBe('ready') // reviewed, planning complete, CLI-confirmed

    // an inferred view must not show that: 'ready' waits for the CLI
    const clamped = await listChanges(repo2, () => resolved, { view: cold.view, provisional: true })
    expect(clamped[0].stage).toBe('review')
  })

  it('a failed CLI run keeps the inferred view, reports why and backs off (tarea 11.5)', async () => {
    const repo3 = mkRepo('repo3')
    await refreshView(repo3) // confirm once
    fs.writeFileSync(path.join(repo3, 'fail-marker'), '')
    fs.appendFileSync(path.join(repo3, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.2 more\n')

    const stale = currentView(repo3)
    expect(stale.stale).toBe(true)
    await expect(refreshView(repo3)).resolves.toBe('failed')
    const failed = currentView(repo3)
    expect(failed.stale).toBe(true)
    expect(failed.refreshError).toBeTruthy()

    // same content again right away: backoff, not another run (a broken CLI
    // must not spin changes_updated → refetch → refresh forever)
    const before = runs()
    await expect(refreshView(repo3)).resolves.toBe('backoff')
    expect(runs()).toBe(before)

    // the CLI recovers: with the backoff off (tests) the retry goes through
    fs.rmSync(path.join(repo3, 'fail-marker'))
    setRefreshRetryMs(0)
    try {
      await expect(refreshView(repo3)).resolves.toBe('fresh')
      expect(currentView(repo3).stale).toBe(false)
    } finally {
      setRefreshRetryMs(15_000)
    }
  })

  it('a persisted snapshot with the current signature answers without running the CLI (restart)', async () => {
    const repo4 = mkRepo('repo4')
    await refreshView(repo4)
    const saved = { sig: openspec.openspecSignature(repo4), view: currentView(repo4).view }
    expect(saved.view.list.changes).toHaveLength(1)

    // a fresh module instance (what a restarted process is): memory empty, the
    // persisted store carries the CLI's last confirmed answer
    const store = new Map<string, { sig: string; view: typeof saved.view }>()
    store.set(repo4, saved)
    const fresh = (await import(
      /* @vite-ignore */ `../../src/main/core/openspec.ts?restart=${Date.now()}`
    )) as typeof openspec
    fresh.bindViewStore({
      get: (r) => store.get(r) ?? null,
      put: (r, sig, view) => store.set(r, { sig, view })
    })
    const before = runs()
    const restored = fresh.currentView(repo4)
    expect(restored.stale).toBe(false)
    expect(restored.view).toEqual(saved.view)
    expect(runs()).toBe(before) // no process ran

    // files changed since the snapshot: not fresh any more
    fs.appendFileSync(path.join(repo4, 'openspec', 'changes', 'c1', 'tasks.md'), '- [ ] 1.2 x\n')
    expect(fresh.currentView(repo4).stale).toBe(true)
    fresh.bindViewStore(null)
  })
})

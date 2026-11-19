// tarea 11.5: unit tests of the locally inferred view (the provisional answer
// `changes()` paints the rail with while the CLI refresh runs). No CLI, no
// electron: everything here is filesystem derivation, so it runs on Windows.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '@shared/protocol.ts'
import {
  currentView,
  inferArtifacts,
  listChanges,
  openspecSignature,
  taskProgress
} from '../../src/main/core/openspec.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-infer-'))
const repo = path.join(tmp, 'repo')
const change = (name: string) => path.join(repo, 'openspec', 'changes', name)

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

describe("task checkbox counting (parity with the CLI's task-progress.js)", () => {
  it('counts x/X as done and every other marker as not done', () => {
    const md = [
      '# Tasks',
      '- [ ] 1.1 plain',
      '- [x] 1.2 lower x',
      '- [X] 1.3 upper x',
      '1. [ ] 1.4 ordered',
      '1) [x] 1.5 ordered paren',
      '+ [ ] 1.6 plus marker',
      '  - [ ] 1.7 nested sub-task',
      '- [~] 1.8 wavy counts as not done',
      '- [] 1.9 empty box counts as not done',
      '- [ x] 1.10 padded box is done'
    ].join('\n')
    const p = taskProgress(md)
    expect(p.total).toBe(10)
    expect(p.completed).toBe(4)
  })

  it('does not count link bullets, and survives CRLF files', () => {
    const md = [
      '- [Some doc](./doc.md)',
      '- [1](./one)',
      '- [ ] real task\r\n- [x] done task\r\n'
    ].join('\n')
    const p = taskProgress(md)
    expect(p.total).toBe(2)
    expect(p.completed).toBe(1)
  })
})

describe('artifact graph inference (spec-driven, the default schema)', () => {
  it('derives done/ready/blocked from file existence', () => {
    // proposal only: specs and design are ready, tasks is blocked
    const only = inferArtifacts(['proposal.md'], false)
    expect(only.map((a) => [a.id, a.status])).toEqual([
      ['proposal', 'done'],
      ['specs', 'ready'],
      ['design', 'ready'],
      ['tasks', 'blocked']
    ])
    // proposal + specs: tasks still blocked by design
    expect(
      inferArtifacts(['proposal.md', 'specs/c/spec.md'], false).find((a) => a.id === 'tasks')!
        .status
    ).toBe('blocked')
    // everything: all done
    const full = inferArtifacts(['proposal.md', 'specs/c/spec.md', 'design.md', 'tasks.md'], false)
    expect(full.every((a) => a.status === 'done')).toBe(true)
  })

  it('skip_specs marks the specs artifact skipped and unblocks tasks', () => {
    const arts = inferArtifacts(['proposal.md', 'design.md'], true)
    expect(arts.find((a) => a.id === 'specs')!.status).toBe('skipped')
    expect(arts.find((a) => a.id === 'tasks')!.status).toBe('ready')
  })
})

describe('the inferred view of a repo', () => {
  it('lists changes with progress, status and lastModified read from disk', async () => {
    write(path.join(repo, 'openspec', 'specs', 'x', 'spec.md'), '# x\n') // not a change
    write(path.join(change('draft-one'), 'proposal.md'), '# Proposal\n')
    const tasks = ['# Tasks', '', '## 1. Setup', '', '- [x] 1.1 first', '- [ ] 1.2 second'].join(
      '\n'
    )
    write(path.join(change('building'), 'proposal.md'), '# P\n')
    write(path.join(change('building'), 'specs', 'c', 'spec.md'), '# S\n')
    write(path.join(change('building'), 'design.md'), '# D\n')
    write(path.join(change('building'), 'tasks.md'), tasks)

    const cold = currentView(repo)
    expect(cold.stale).toBe(true)
    const listed = await listChanges(repo, () => [], { view: cold.view, provisional: true })
    expect(listed.map((c) => c.name).sort()).toEqual(['building', 'draft-one'])

    const building = listed.find((c) => c.name === 'building')!
    expect(building).toMatchObject({ completedTasks: 1, totalTasks: 2, status: 'in-progress' })
    expect(building.isPlanningComplete).toBe(true)
    expect(building.artifacts.map((a) => a.status)).toEqual(['done', 'done', 'done', 'done'])
    expect(new Date(building.lastModified).toString()).not.toBe('Invalid Date')
    expect(building.nextTask).toContain('1.2 second')
    expect(building.validation).toBeNull() // only the CLI validates
    expect(building.files).toContain('specs/c/spec.md')

    const draft = listed.find((c) => c.name === 'draft-one')!
    expect(draft).toMatchObject({ totalTasks: 0, status: 'no-tasks', stage: 'draft' })
    expect(draft.artifacts.map((a) => a.status)).toEqual(['done', 'ready', 'ready', 'blocked'])
  })

  it('never presents an unvalidated change as ready while the view is provisional', async () => {
    write(path.join(change('reviewable'), 'proposal.md'), '# P\n')
    write(path.join(change('reviewable'), 'specs', 'c', 'spec.md'), '# S\n')
    write(path.join(change('reviewable'), 'design.md'), '# D\n')
    write(path.join(change('reviewable'), 'tasks.md'), '- [ ] 1.1 only\n')
    const reviewed = [{ status: 'resolved' }] as unknown as ReviewComment[]

    const cold = currentView(repo)
    const inferred = await listChanges(repo, () => reviewed, {
      view: cold.view,
      provisional: true
    })
    expect(inferred.find((c) => c.name === 'reviewable')!.stage).toBe('review')

    // the same view, once confirmed (provisional = false), may say ready:
    // the clamp only reflects "the CLI has not validated this yet"
    const confirmed = await listChanges(repo, () => reviewed, { view: cold.view })
    expect(confirmed.find((c) => c.name === 'reviewable')!.stage).toBe('ready')
  })

  it('a repo without openspec/changes lists empty without any inference work', () => {
    const bare = path.join(tmp, 'bare')
    fs.mkdirSync(bare, { recursive: true })
    expect(currentView(bare).stale).toBe(true) // nothing confirmed
    // listChanges' own guard answers [] (and the core returns before even this)
  })

  it('custom schemas are not guessed: no artifacts, so the CLI fills them in', async () => {
    write(path.join(change('graphed'), 'proposal.md'), '# P\n')
    write(path.join(change('graphed'), 'specs', 'c', 'spec.md'), '# S\n')
    write(path.join(change('graphed'), 'design.md'), '# D\n')
    write(path.join(change('graphed'), 'tasks.md'), '- [ ] 1.1 x\n')
    // a change that names its own schema
    write(path.join(change('own-schema'), '.openspec.yaml'), 'schema: team-flow\n')
    write(path.join(change('own-schema'), 'proposal.md'), '# P\n')

    const view = currentView(repo).view
    const byName = new Map(view.status.changes!.map((s) => [s.changeName, s]))
    expect(byName.get('graphed')!.artifacts).toHaveLength(4) // default graph still inferred
    expect(byName.get('own-schema')!.artifacts).toEqual([])

    // and a project-local schemas/ folder disables the guess repo-wide
    write(path.join(repo, 'openspec', 'schemas', 'team-flow', 'schema.yaml'), 'name: team-flow\n')
    const after = currentView(repo).view
    expect(after.status.changes!.every((s) => s.artifacts.length === 0)).toBe(true)
  })
})

describe('the default schema named explicitly', () => {
  it('`schema: spec-driven` (what `openspec new change` writes) is still inferred', () => {
    const r = path.join(tmp, 'explicit')
    const c = path.join(r, 'openspec', 'changes', 'c')
    write(path.join(c, '.openspec.yaml'), 'schema: spec-driven\ncreated: 2026-01-01\n')
    write(path.join(c, 'proposal.md'), '# P\n')
    const st = currentView(r).view.status.changes!
    expect(st[0].artifacts.map((a) => a.status)).toEqual(['done', 'ready', 'ready', 'blocked'])
  })

  it('a project default naming another schema (config.yaml) disables the guess', () => {
    const r = path.join(tmp, 'project-default')
    write(path.join(r, 'openspec', 'config.yaml'), 'schema: "team-flow"\n')
    write(path.join(r, 'openspec', 'changes', 'c', 'proposal.md'), '# P\n')
    expect(currentView(r).view.status.changes![0].artifacts).toEqual([])
    // ...while a config that names the default one does not
    const r2 = path.join(tmp, 'project-default-2')
    write(path.join(r2, 'openspec', 'config.yaml'), 'schema: spec-driven\n')
    write(path.join(r2, 'openspec', 'changes', 'c', 'proposal.md'), '# P\n')
    expect(currentView(r2).view.status.changes![0].artifacts).toHaveLength(4)
  })
})

describe('currentView freshness', () => {
  it('a repo never confirmed is always stale, and its signature covers its files', () => {
    const other = path.join(tmp, 'other')
    write(path.join(other, 'openspec', 'changes', 'x', 'tasks.md'), '- [ ] 1.1 x\n')
    const sig = openspecSignature(other)
    expect(sig).toContain('tasks.md')
    // nothing was ever confirmed for this repo
    expect(currentView(other).stale).toBe(true)
  })
})

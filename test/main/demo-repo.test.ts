// Fase 5.7: the async demo repo creator. Same file tree as the dev script
// (shared through scripts/demo-repo-files.mjs), fully async IO, running it
// again resets the demo, and a missing openspec CLI or git degrades to a
// warning instead of failing the whole action.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDemoRepo } from '../../src/main/desktop/demo-repo.ts'
import { DEMO_CHANGE, DEMO_REPO_NAME } from '../../scripts/demo-repo-files.mjs'

const NOW = new Date('2026-11-18T12:00:00.000Z')

const fakeGit = (ok = true) => ({
  git: async () => ({ ok, stderr: ok ? '' : 'git: not found' })
})
const fakeOpenspec = (ok = true) => ({
  openspecInit: async (repo: string, tool: string) => {
    calls.push({ repo, tool })
    return { ok, out: ok ? 'installed' : 'command not found' }
  }
})
const calls: { repo: string; tool: string }[] = []

describe('createDemoRepo (tarea 5.7)', () => {
  it('writes the shared file tree with the change ready for review', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-repo-'))
    const r = await createDemoRepo({ root, now: NOW, runners: fakeGit() })
    expect(r.repo).toBe(path.join(root, DEMO_REPO_NAME))
    expect(r.change).toBe(DEMO_CHANGE)
    expect(r.gitOk).toBe(true)
    for (const f of [
      'package.json',
      'src/app.js',
      `openspec/changes/${DEMO_CHANGE}/proposal.md`,
      `openspec/changes/${DEMO_CHANGE}/tasks.md`,
      'openspec/specs/health/spec.md'
    ])
      expect(fs.existsSync(path.join(r.repo, f)), f).toBe(true)
    const yaml = fs.readFileSync(
      path.join(r.repo, `openspec/changes/${DEMO_CHANGE}/.openspec.yaml`),
      'utf8'
    )
    expect(yaml).toContain('created: 2026-11-18')
  })

  it('running it again resets the demo', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-repo-'))
    await createDemoRepo({ root, now: NOW, runners: fakeGit() })
    const stray = path.join(root, DEMO_REPO_NAME, 'stray.txt')
    fs.writeFileSync(stray, 'leftover from a previous demo')
    await createDemoRepo({ root, now: NOW, runners: fakeGit() })
    expect(fs.existsSync(stray)).toBe(false)
  })

  it('openspec init --tools runs in the repo with the agent id', async () => {
    calls.length = 0
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-repo-'))
    const r = await createDemoRepo({
      root,
      now: NOW,
      tools: 'claude',
      runners: { ...fakeGit(), ...fakeOpenspec(true) }
    })
    expect(r.openspecOk).toBe(true)
    expect(r.warnings).toEqual([])
    expect(calls).toEqual([{ repo: path.join(root, DEMO_REPO_NAME), tool: 'claude' }])
  })

  it('a failing or missing openspec CLI degrades to a warning', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-repo-'))
    const r = await createDemoRepo({
      root,
      now: NOW,
      tools: 'codex',
      runners: { ...fakeGit(), ...fakeOpenspec(false) }
    })
    expect(r.openspecOk).toBe(false)
    expect(r.warnings[0]).toMatch(/openspec init failed/)
    expect(fs.existsSync(path.join(r.repo, 'package.json'))).toBe(true) // files stay
  })

  it('without git the repo is still created, with a warning', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-repo-'))
    const r = await createDemoRepo({ root, now: NOW, runners: fakeGit(false) })
    expect(r.gitOk).toBe(false)
    expect(r.warnings).toContain('git not found: created the files without a git repo')
    expect(fs.existsSync(path.join(r.repo, 'openspec/config.yaml'))).toBe(true)
  })

  it('the real git default runner makes an actual repo', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-repo-'))
    const r = await createDemoRepo({ root, now: NOW }) // no stubs: default runners
    expect(r.gitOk).toBe(true)
    expect(fs.existsSync(path.join(r.repo, '.git'))).toBe(true)
  })
})

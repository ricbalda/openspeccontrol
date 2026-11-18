import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerMsg } from '@shared/protocol.ts'
import { createOscCore, type OscCore, type Subscriber } from '../../src/main/core/osc-core.ts'

// isolated data dir; fromStudio points at a folder that does not exist so the
// (possibly real) ~/.openspec-studio of the developer is never imported here
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-core-data-'))
delete process.env.REPOS_ROOT

let core: OscCore
let WORK: string, APP: string, OUTSIDE: string

beforeAll(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'osc-core-')))
  WORK = path.join(base, 'work')
  APP = path.join(WORK, 'app')
  fs.mkdirSync(path.join(APP, 'openspec', 'changes', 'add-x'), { recursive: true })
  fs.writeFileSync(
    path.join(APP, 'openspec', 'changes', 'add-x', 'proposal.md'),
    '# Proposal\nAdd a hello endpoint.\n'
  )
  OUTSIDE = path.join(base, 'secret')
  fs.mkdirSync(OUTSIDE, { recursive: true })

  // a fake agent: a plain node process that stays alive but never speaks ACP,
  // so the session exists and the handshake just never completes
  fs.writeFileSync(
    path.join(DATA, 'agents.json'),
    JSON.stringify([
      {
        id: 'sleeper',
        label: 'Sleeper',
        cmd: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 60000)']
      }
    ])
  )

  core = createOscCore({ dataDir: DATA, fromStudio: path.join(base, 'no-studio') })
  await core.addRoot({ path: WORK })
})

afterAll(async () => {
  await core.shutdown()
})

const sub = (id: number) => {
  const got: ServerMsg[] = []
  return { sub: { id, send: (m: ServerMsg) => got.push(m) } as Subscriber, got }
}

describe('OscCore operations (error codes, task 2.2)', () => {
  it('a comment on a change that does not exist is invalid', async () => {
    await expect(
      core.addComment({ repo: APP, change: 'nope', body: 'x', file: null, anchor: null })
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('sendReview without an agent connected is a conflict', async () => {
    await expect(core.sendReview({ repo: APP, change: 'add-x' })).rejects.toMatchObject({
      code: 'conflict'
    })
  })

  it('an action on a repo outside the workspace folders is not_found', async () => {
    await expect(
      core.action({ repo: OUTSIDE, action: 'propose', text: 'add a greeting' })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a file larger than MAX_DOC_BYTES is too_large', async () => {
    const file = path.join(APP, 'openspec', 'changes', 'add-x', 'big.md')
    fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1))
    try {
      expect(() => core.file(APP, 'changes/add-x/big.md')).toThrow(
        expect.objectContaining({ code: 'too_large' })
      )
    } finally {
      fs.rmSync(file)
    }
  })

  it('comments round-trip through the core', async () => {
    const cm = await core.addComment({
      repo: APP,
      change: 'add-x',
      body: 'make it clearer',
      kind: 'comment',
      file: 'proposal.md',
      anchor: null
    })
    expect(cm.status).toBe('draft')
    const r = await core.review(APP, 'add-x')
    expect(r.comments.map((c) => c.id)).toContain(cm.id)
    const next = await core.patchComment(cm.id, { status: 'resolved' })
    expect(next.status).toBe('resolved')
    await core.deleteComment(cm.id)
    await expect(core.review(APP, 'add-x')).resolves.toMatchObject({ comments: [] })
  })
})

describe('realtime fan-out (task 2.3)', () => {
  it('subscribe answers with session and replay', async () => {
    const { sub: s, got } = sub(1)
    await core.handleClientMsg(s, { type: 'subscribe', repo: APP })
    expect(got.map((m) => m.type)).toEqual(['session', 'replay'])
    expect(got[0]).toMatchObject({ type: 'session', repo: APP, session: null })
    expect(got[1]).toMatchObject({ type: 'replay', repo: APP, entries: [] })

    core.unsubscribe(s)
    await core.handleClientMsg(s, { type: 'subscribe', repo: APP })
    expect(got).toHaveLength(4) // a new subscribe sends both again
    core.unsubscribe(s)
  })

  it('a message for a repo outside the folders is an error, not a throw', async () => {
    const { sub: s, got } = sub(2)
    await core.handleClientMsg(s, { type: 'subscribe', repo: OUTSIDE })
    expect(got).toEqual([{ type: 'error', message: 'repo not found' }])
  })
})

describe('removeRoot stops agents in unreachable repos (task 2.1)', () => {
  it('stops the session of a repo whose folder went away', async () => {
    const { sub: s } = sub(3)
    // the handshake never completes: fire and forget, the session registers synchronously
    const starting = core.handleClientMsg(s, { type: 'start', repo: APP, agent: 'sleeper' })
    starting.catch(() => {})
    await new Promise((r) => setTimeout(r, 100))
    expect(core.sessionStates().map((x) => x.repo)).toContain(APP)

    await core.removeRoot({ path: WORK })
    expect(core.sessionStates().map((x) => x.repo)).not.toContain(APP)
    core.unsubscribe(s)
  })
})

describe('shutdown (task 2.5)', () => {
  it('closes watchers, sessions and checkpoints the WAL', async () => {
    await core.addRoot({ path: WORK }) // removed by the previous test
    const cm = await core.addComment({ repo: APP, change: 'add-x', body: 'survives' })
    const { sub: s } = sub(4)
    core.subscribe(s, APP)
    expect(core.activeWatchers).toBe(1)

    await core.shutdown()
    expect(core.activeWatchers).toBe(0)
    expect(core.sessionStates()).toHaveLength(0)

    // the WAL has no pending checkpoint: either gone or empty
    const wal = `${path.join(DATA, 'openspeccontrol.db')}-wal`
    expect(fs.existsSync(wal) ? fs.statSync(wal).size : 0).toBe(0)

    // and the data written before shutdown is in the main db file
    const db = new DatabaseSync(path.join(DATA, 'openspeccontrol.db'), { readOnly: true })
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ?').get(cm.id) as any).n
    ).toBe(1)
    db.close()
  })
})

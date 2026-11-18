import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReviewComment, ReviewRound } from '@shared/protocol.ts'
import {
  LEGACY_REVIEW_FILE,
  readReviewFile,
  REVIEW_FILE,
  writeReviewFile
} from '../../src/main/core/review/repoFile.ts'

const REPO = '/home/me/secret/path/app'
const cm = {
  id: 'c1',
  repo: REPO,
  change: 'add-x',
  file: 'proposal.md',
  anchor: null,
  kind: 'change',
  body: 'b',
  status: 'addressed',
  agentNote: 'ok',
  roundId: 'r1',
  orphaned: false,
  createdAt: '2026-01-01T00:00:00Z'
} as ReviewComment
const done = {
  id: 'r1',
  repo: REPO,
  change: 'add-x',
  status: 'done',
  createdAt: '2026-01-01T00:01:00Z',
  commentIds: ['c1'],
  resultParsed: true,
  stopReason: 'end_turn',
  diffs: []
} as ReviewRound
const running = { ...done, id: 'r2', status: 'running' } as ReviewRound

describe('review history file', () => {
  it('round-trips without the machine-specific repo path, and skips running rounds', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    expect(writeReviewFile(dir, 'add-x', [cm], [done, running])).toBe(true)
    const raw = fs.readFileSync(path.join(dir, REVIEW_FILE), 'utf8')
    expect(raw).not.toContain(REPO)
    const back = readReviewFile(dir, '/other/clone/app')!
    expect(back.change).toBe('add-x')
    expect(back.comments).toEqual([{ ...cm, repo: '/other/clone/app' }])
    expect(back.rounds.map((r) => r.id)).toEqual(['r1'])
  })

  it('does not touch the file when nothing changed, nor create one for an unreviewed change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    expect(writeReviewFile(dir, 'add-x', [], [])).toBe(false)
    expect(fs.existsSync(path.join(dir, REVIEW_FILE))).toBe(false)
    writeReviewFile(dir, 'add-x', [cm], [done])
    expect(writeReviewFile(dir, 'add-x', [cm], [done])).toBe(false)
    expect(writeReviewFile(dir, 'add-x', [{ ...cm, status: 'resolved' }], [done])).toBe(true)
  })

  it('ignores files that are not ours', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    fs.writeFileSync(path.join(dir, REVIEW_FILE), '{"hello":1}')
    expect(readReviewFile(dir, REPO)).toBeNull()
    expect(readReviewFile(path.join(dir, 'missing'), REPO)).toBeNull()
  })
})

describe('legacy .studio-review.json (Studio 0.3.x)', () => {
  const legacyFile = (dir: string, over: Record<string, unknown> = {}) =>
    fs.writeFileSync(
      path.join(dir, LEGACY_REVIEW_FILE),
      JSON.stringify({
        format: 'openspec-studio-review',
        version: 1,
        change: 'add-x',
        comments: [cm],
        rounds: [done],
        ...over
      })
    )

  it('is read as a fallback when the new file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    legacyFile(dir)
    const back = readReviewFile(dir, '/other/clone/app')!
    expect(back.change).toBe('add-x')
    expect(back.comments).toEqual([{ ...cm, repo: '/other/clone/app' }])
    expect(back.rounds.map((r) => r.id)).toEqual(['r1'])
  })

  it('loses to the new file when both exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    legacyFile(dir)
    writeReviewFile(dir, 'add-x', [{ ...cm, id: 'new1', body: 'ours' }], [])
    const back = readReviewFile(dir, REPO)!
    expect(back.comments.map((c) => c.id)).toEqual(['new1'])
  })

  it('a legacy file with the wrong format is not ours', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    fs.writeFileSync(path.join(dir, LEGACY_REVIEW_FILE), '{"format": "something-else"}')
    expect(readReviewFile(dir, REPO)).toBeNull()
  })

  it('exports write only the new name and never touch the legacy file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-rf-'))
    legacyFile(dir)
    const before = fs.readFileSync(path.join(dir, LEGACY_REVIEW_FILE), 'utf8')
    expect(writeReviewFile(dir, 'add-x', [cm], [done])).toBe(true)
    expect(fs.existsSync(path.join(dir, REVIEW_FILE))).toBe(true)
    expect(fs.readFileSync(path.join(dir, LEGACY_REVIEW_FILE), 'utf8')).toBe(before)
    // a second export updates the new file only
    writeReviewFile(dir, 'add-x', [{ ...cm, body: 'edited' }], [done])
    expect(fs.readFileSync(path.join(dir, LEGACY_REVIEW_FILE), 'utf8')).toBe(before)
    expect(fs.readFileSync(path.join(dir, REVIEW_FILE), 'utf8')).toContain('edited')
  })
})

describe('importRecords', async () => {
  const { importRecords } = await import('../../src/main/core/review/repoFile.ts')
  it('keeps ids that are free and renames taken ones, links included', () => {
    let n = 0
    const rec = importRecords(
      { comments: [cm, { ...cm, id: 'c2', roundId: null }], rounds: [done] },
      'add-copy',
      { comment: (id) => id === 'c1', round: (id) => id === 'r1' },
      () => `new${++n}`
    )
    expect(rec.comments.map((c) => [c.id, c.change, c.roundId])).toEqual([
      ['new1', 'add-copy', 'new2'],
      ['c2', 'add-copy', null]
    ])
    expect(rec.rounds.map((r) => [r.id, r.change, r.commentIds])).toEqual([
      ['new2', 'add-copy', ['new1']]
    ])
  })
})

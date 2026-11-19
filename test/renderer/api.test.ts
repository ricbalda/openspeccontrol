// @vitest-environment jsdom
// api.ts over window.osc (tareas 3.6 y 3.10): each method delegates to the
// bridge with identical arguments, and a bridge failure surfaces as a rejected
// promise carrying the core's message (the preload unfolded the envelope).

import { beforeEach, describe, expect, it } from 'vitest'
import type { CommentCreateBody } from '@shared/ipc.ts'
import { api } from '../../src/renderer/src/lib/api.ts'

const calls: Record<string, unknown[][]> = {}
const record =
  (name: string) =>
  (...args: unknown[]) => {
    ;(calls[name] ??= []).push(args)
    return Promise.resolve({ ok: true })
  }

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k]
  const mock: Record<string, unknown> = {
    config: record('config'),
    updateState: record('updateState'),
    repos: record('repos'),
    addRoot: record('addRoot'),
    removeRoot: record('removeRoot'),
    init: record('init'),
    changes: record('changes'),
    archived: record('archived'),
    settings: record('settings'),
    file: record('file'),
    action: record('action'),
    review: record('review'),
    addComment: record('addComment'),
    patchComment: record('patchComment'),
    deleteComment: record('deleteComment'),
    sendReview: record('sendReview'),
    closeRound: record('closeRound'),
    git: record('git'),
    gitBranch: record('gitBranch'),
    gitCommit: record('gitCommit'),
    drafts: record('drafts'),
    draft: record('draft'),
    createDraft: record('createDraft'),
    saveDraft: record('saveDraft'),
    duplicateDraft: record('duplicateDraft'),
    deleteDraft: record('deleteDraft'),
    sendDraft: record('sendDraft'),
    checkForUpdates: record('checkForUpdates'),
    installUpdate: record('installUpdate')
  }
  window.osc = mock as unknown as typeof window.osc
})

describe('api delegates to window.osc', () => {
  it('passes every argument through, position by position', async () => {
    await api.repos(true)
    expect(calls['repos']).toEqual([[true]])

    await api.git('C:/r', { change: 'add-x' })
    await api.git('C:/r')
    expect(calls['git']).toEqual([
      ['C:/r', { change: 'add-x' }],
      ['C:/r', {}]
    ])

    await api.action('C:/r', 'propose', undefined, 'add a greeting')
    expect(calls['action']).toEqual([['C:/r', 'propose', undefined, 'add a greeting']])

    await api.init('C:/r', 'opencode')
    expect(calls['init']).toEqual([['C:/r', 'opencode']])

    await api.archived('C:/r', '2026-01-01-add-x')
    expect(calls['archived']).toEqual([['C:/r', '2026-01-01-add-x']])

    await api.file('C:/r', 'changes/add-x/proposal.md')
    expect(calls['file']).toEqual([['C:/r', 'changes/add-x/proposal.md']])

    await api.updateState()
    await api.checkForUpdates()
    await api.installUpdate()
    expect(calls['updateState']).toEqual([[]])
    expect(calls['checkForUpdates']).toEqual([[]])
    expect(calls['installUpdate']).toEqual([[]])
  })

  it('passes the body objects of the review and git calls untouched', async () => {
    const comment: CommentCreateBody = {
      repo: 'C:/r',
      change: 'add-x',
      file: 'proposal.md',
      anchor: null,
      kind: 'comment',
      body: 'make it clearer'
    }
    await api.addComment(comment)
    expect(calls['addComment']).toEqual([[comment]])

    await api.patchComment('id1', { status: 'resolved' })
    expect(calls['patchComment']).toEqual([['id1', { status: 'resolved' }]])

    const commit = { repo: 'C:/r', change: 'add-x', files: ['proposal.md'], message: 'm' }
    await api.gitCommit(commit)
    expect(calls['gitCommit']).toEqual([[commit]])
  })

  it('surfaces a bridge failure as a rejected promise with its message', async () => {
    window.osc = {
      ...window.osc,
      config: () => Promise.reject(new Error('invalid request: repo: Required'))
    }
    await expect(api.config()).rejects.toThrow('invalid request: repo: Required')
  })
})

describe('api delegates the draft methods to window.osc (add-proposal-drafts, tarea 2.3)', () => {
  it('passes every argument through, position by position', async () => {
    await api.drafts('C:/r', 'export')
    await api.drafts('C:/r')
    expect(calls['drafts']).toEqual([
      ['C:/r', 'export'],
      ['C:/r', undefined]
    ])

    await api.draft('d1')
    expect(calls['draft']).toEqual([['d1']])

    await api.createDraft('C:/r')
    expect(calls['createDraft']).toEqual([['C:/r']])

    const patch = { title: 'Exportación CSV', body: 'Añadir exportación a CSV' }
    await api.saveDraft('d1', patch)
    expect(calls['saveDraft']).toEqual([['d1', patch]])

    await api.duplicateDraft('d1')
    expect(calls['duplicateDraft']).toEqual([['d1']])

    await api.deleteDraft('d1')
    expect(calls['deleteDraft']).toEqual([['d1']])

    await api.sendDraft('d1', 'propose')
    await api.sendDraft('d2', 'explore')
    expect(calls['sendDraft']).toEqual([
      ['d1', 'propose'],
      ['d2', 'explore']
    ])
  })

  it('surfaces a draft bridge failure as a rejected promise with its message', async () => {
    window.osc = {
      ...window.osc,
      saveDraft: () => Promise.reject(new Error('text is too long: title: Too big'))
    }
    await expect(api.saveDraft('d1', { title: 'x'.repeat(201) })).rejects.toThrow(
      'text is too long'
    )
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_ACTION_TEXT } from '@shared/ipc.ts'
import {
  actionBody,
  clientMsg,
  commentCreate,
  commentPatch,
  createDraftBody,
  draftIdBody,
  draftsBody,
  parseDraftOrThrow,
  parseOrThrow,
  saveDraftBody,
  sendDraftBody
} from '../../src/main/core/schemas.ts'

describe('request schemas', () => {
  it('accepts what the web client sends', () => {
    expect(actionBody.parse({ repo: '/r', action: 'apply', change: 'c1' })).toMatchObject({
      action: 'apply'
    })
    expect(
      commentCreate.parse({
        repo: '/r',
        change: 'c1',
        file: null,
        anchor: null,
        kind: 'change',
        body: 'x'
      })
    ).toMatchObject({ kind: 'change' })
    expect(
      clientMsg.parse({ type: 'permission', repo: '/r', id: 'p1', optionId: null })
    ).toMatchObject({ type: 'permission' })
  })

  it('cuts over-long text instead of rejecting it', () => {
    expect(commentPatch.parse({ body: 'a'.repeat(9000) }).body).toHaveLength(8000)
    const m = clientMsg.parse({ type: 'prompt', repo: '/r', text: 'a'.repeat(30000) })
    expect(m.type === 'prompt' && m.text.length).toBe(20000)
  })

  it('rejects wrong shapes with an "invalid" error', () => {
    expect(() => parseOrThrow(actionBody, { repo: '/r', action: 'rm -rf' })).toThrow(
      /invalid request: action/
    )
    expect(() => parseOrThrow(commentPatch, { status: 'sent' })).toThrow(
      expect.objectContaining({ code: 'invalid' })
    )
    expect(clientMsg.safeParse({ type: 'prompt', repo: '/r', text: 42 }).success).toBe(false)
    expect(clientMsg.safeParse({ type: 'nope', repo: '/r' }).success).toBe(false)
  })

  it('accepts unsubscribe with a repo and rejects it without one (multi-repo-rail, tarea 1.1)', () => {
    expect(clientMsg.parse({ type: 'unsubscribe', repo: '/r' })).toEqual({
      type: 'unsubscribe',
      repo: '/r'
    })
    expect(clientMsg.safeParse({ type: 'unsubscribe' }).success).toBe(false)
    expect(clientMsg.safeParse({ type: 'unsubscribe', repo: '' }).success).toBe(false)
  })
})

describe('draft schemas (add-proposal-drafts, tareas 2.1 y 2.2)', () => {
  it('actionBody still cuts the text at MAX_ACTION_TEXT (4000), as before', () => {
    expect(MAX_ACTION_TEXT).toBe(4000)
    const b = actionBody.parse({ repo: '/r', action: 'propose', text: 'a'.repeat(4500) })
    expect(b.text).toHaveLength(4000)
  })

  it('accepts what the draft methods send', () => {
    expect(draftsBody.parse({ repo: '/r' })).toEqual({ repo: '/r' })
    expect(draftsBody.parse({ repo: '/r', query: 'busqueda' })).toEqual({
      repo: '/r',
      query: 'busqueda'
    })
    expect(draftIdBody.parse({ id: 'd1' })).toEqual({ id: 'd1' })
    expect(createDraftBody.parse({ repo: '/r' })).toEqual({ repo: '/r' })
    expect(saveDraftBody.parse(['d1', { title: 'T', body: 'B' }])).toEqual([
      'd1',
      { title: 'T', body: 'B' }
    ])
    expect(saveDraftBody.parse(['d1', {}])).toEqual(['d1', {}])
    expect(sendDraftBody.parse(['d1', 'explore'])).toEqual(['d1', 'explore'])
  })

  it('rejects over-limit text with too_large, never cutting it (design D-4)', () => {
    const tooLarge = (fn: () => unknown) =>
      expect(fn).toThrow(expect.objectContaining({ code: 'too_large' }))
    tooLarge(() => parseDraftOrThrow(draftsBody, { repo: '/r', query: 'q'.repeat(201) }))
    tooLarge(() => parseDraftOrThrow(saveDraftBody, ['d1', { title: 't'.repeat(201) }]))
    tooLarge(() => parseDraftOrThrow(saveDraftBody, ['d1', { body: 'b'.repeat(100001) }]))
    // justo en el tope pasa: 200 / 100 000 / 200
    expect(() =>
      parseDraftOrThrow(draftsBody, { repo: '/r', query: 'q'.repeat(200) })
    ).not.toThrow()
    expect(() => parseDraftOrThrow(saveDraftBody, ['d1', { title: 't'.repeat(200) }])).not.toThrow()
    expect(() =>
      parseDraftOrThrow(saveDraftBody, ['d1', { body: 'b'.repeat(100000) }])
    ).not.toThrow()
  })

  it('keeps rejecting wrong shapes with an "invalid" error', () => {
    const invalid = (fn: () => unknown) =>
      expect(fn).toThrow(expect.objectContaining({ code: 'invalid' }))
    invalid(() => parseDraftOrThrow(draftIdBody, { id: '' }))
    invalid(() => parseDraftOrThrow(draftIdBody, { id: 42 }))
    invalid(() => parseDraftOrThrow(createDraftBody, { repo: '' }))
    invalid(() => parseDraftOrThrow(draftsBody, { repo: '/r', query: 42 }))
    invalid(() => parseDraftOrThrow(saveDraftBody, ['d1', 'nope']))
    invalid(() => parseDraftOrThrow(sendDraftBody, ['d1', 'send'])) // mode fuera del enum
    invalid(() => parseDraftOrThrow(sendDraftBody, ['d1'])) // falta el mode
  })
})

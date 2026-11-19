import { describe, expect, it } from 'vitest'
import {
  actionBody,
  clientMsg,
  commentCreate,
  commentPatch,
  parseOrThrow
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

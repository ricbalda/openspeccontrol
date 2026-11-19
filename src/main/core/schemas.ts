// Shapes of what the renderer may send: IPC arguments and client messages.
// Anything else is rejected with an "invalid" error instead of being cast and
// trusted. Over-long text is cut, not rejected, as before.

import { z } from 'zod'
import type { ClientMsg } from '@shared/protocol.ts'
import { OscError } from './errors.ts'

const capped = (max: number) => z.string().transform((s) => s.slice(0, max))
const repo = z.string().min(1)

export const LIFECYCLE = [
  'propose',
  'explore',
  'update',
  'apply',
  'verify',
  'sync',
  'archive'
] as const
export const COMMENT_KINDS = ['comment', 'change', 'remove', 'question', 'ok'] as const

export const rootBody = z.object({ path: z.string().default('') })
export const initBody = z.object({ repo, agent: z.string() })
export const actionBody = z.object({
  repo,
  action: z.enum(LIFECYCLE),
  change: z.string().optional(),
  text: capped(4000).optional()
})
export const changeBody = z.object({ repo, change: z.string() })
export const gitBranchBody = z.object({ repo, change: z.string() })
/** an active change, or an archived one (its folder name under changes/archive) */
export const gitCommitBody = z.object({
  repo,
  change: z.string().optional(),
  archived: z.string().optional(),
  files: z.array(z.string()).min(1).max(2000),
  message: z.string().trim().min(1).max(5000)
})
export const settingsBody = z.object({ repo, reviewInRepo: z.boolean() })

const anchor = z.object({
  exact: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  headingPath: z.array(z.string()).optional(),
  lineHint: z.number().optional()
})
export const commentCreate = changeBody.extend({
  file: z.string().nullish(),
  kind: z.enum(COMMENT_KINDS).optional(),
  body: capped(8000).optional(),
  anchor: anchor.nullish()
})
export const commentPatch = z.object({
  body: capped(8000).optional(),
  kind: z.enum(COMMENT_KINDS).optional(),
  status: z.enum(['resolved', 'draft']).optional()
})

export const clientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), repo }),
  z.object({ type: z.literal('unsubscribe'), repo }),
  z.object({ type: z.literal('start'), repo, agent: z.string(), resume: z.boolean().optional() }),
  z.object({ type: z.literal('stop'), repo }),
  z.object({ type: z.literal('prompt'), repo, text: capped(20000) }),
  z.object({ type: z.literal('cancel'), repo }),
  z.object({
    type: z.literal('permission'),
    repo,
    id: z.string(),
    optionId: z.string().nullable(),
    label: z.string().optional()
  }),
  z.object({
    type: z.literal('elicitation'),
    repo,
    id: z.string(),
    action: z.enum(['accept', 'decline', 'cancel']),
    content: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    type: z.literal('set_config'),
    repo,
    configId: z.string(),
    value: z.union([z.string(), z.boolean()])
  })
]) satisfies z.ZodType<ClientMsg>

/** One-line, user-facing summary of what was wrong. */
export const describeIssues = (e: z.ZodError) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')

/** Parse or throw an OscError the IPC layer reports as code "invalid". */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data)
  if (!r.success) throw new OscError('invalid', `invalid request: ${describeIssues(r.error)}`)
  return r.data
}

// The IPC bridge (Fase 3): one ipcMain.handle per OscApi method plus the
// realtime 'osc:client-msg' fan-in, replacing Studio's HTTP routes and
// WebSocket. Every handler first checks the sender (only the main window's
// main frame, on the origin we loaded), validates the arguments with the zod
// schemas of the core and answers inside an IpcResult envelope: failures cross
// the bridge as data because Electron rewrites the message of a thrown error.

import { ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { ServerMsg } from '@shared/protocol.ts'
import {
  CLIENT_MSG_CHANNEL,
  SERVER_MSG_CHANNEL,
  methodChannel,
  type IpcResult
} from '@shared/ipc.ts'
import type { OscCore, Subscriber } from './core/osc-core.ts'
import { OscError } from './core/errors.ts'
import {
  actionBody,
  changeBody,
  clientMsg,
  commentCreate,
  commentPatch,
  describeIssues,
  gitBranchBody,
  gitCommitBody,
  initBody,
  parseOrThrow,
  rootBody,
  settingsBody
} from './core/schemas.ts'
import { detectTools } from './desktop/tools.ts'

// ---- trusted sender --------------------------------------------------------------

/** The slice of Electron's WebFrameMain the trusted-sender check needs. */
export interface FrameRef {
  url: string
}

/** The slice of a WebContents the bridge talks to (tests fake these two). */
export interface WebContentsRef {
  id: number
  mainFrame: FrameRef
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
  on(event: string, listener: () => void): void
}

/** The window a frame must belong to; null before it exists. */
export type WindowRef = { webContents: WebContentsRef } | null

/** The URL of the packaged index.html, what loadFile() serves in production. */
export function packagedIndexUrl(): string {
  return pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
}

/** The URL the renderer was loaded from: the dev server, or the packaged index.html. */
function frameUrlOk(url: string): boolean {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) {
    try {
      return new URL(url).origin === new URL(dev).origin
    } catch {
      return false
    }
  }
  return url === packagedIndexUrl()
}

/**
 * Only the given window's main frame, on the origin we loaded. An iframe (a
 * different frame, even with our URL), another webContents or a navigated
 * frame is rejected without running anything.
 */
export function makeTrustedSender(getWindow: () => WindowRef) {
  return (frame: FrameRef | null | undefined): boolean => {
    const wc = getWindow()?.webContents
    if (!wc || !frame || frame !== wc.mainFrame) return false
    return frameUrlOk(frame.url)
  }
}

// ---- argument validation -----------------------------------------------------------

/** zod check that fails as code "invalid" (what parseOrThrow does, for raw args). */
function check<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data)
  if (!r.success) throw new OscError('invalid', `invalid arguments: ${describeIssues(r.error)}`)
  return r.data
}

// ---- the bridge ---------------------------------------------------------------------

export interface IpcBridge {
  /**
   * Drop a window's subscriptions when its renderer goes away: reload
   * (did-start-navigation), destruction and renderer crash each stop the
   * repo watchers that only that page kept alive.
   */
  attachWindow(win: { webContents: WebContentsRef }): void
}

export function registerIpc(opts: { core: OscCore; window: () => WindowRef }): IpcBridge {
  const { core } = opts
  const isTrusted = makeTrustedSender(opts.window)

  // one Subscriber per webContents: it forwards core broadcasts over the
  // 'osc:server-msg' channel, and only while the contents is alive
  const subscribers = new Map<WebContentsRef, Subscriber>()
  const subscriberOf = (wc: WebContentsRef): Subscriber => {
    let sub = subscribers.get(wc)
    if (!sub) {
      sub = {
        id: wc.id,
        send: (m: ServerMsg) => {
          if (!wc.isDestroyed()) wc.send(SERVER_MSG_CHANNEL, m)
        }
      }
      subscribers.set(wc, sub)
    }
    return sub
  }
  const drop = (wc: WebContentsRef) => {
    const sub = subscribers.get(wc)
    if (sub) {
      core.unsubscribe(sub) // also syncs the watchers of the repos it left
      subscribers.delete(wc)
    }
  }

  const untrusted = <T>(): IpcResult<T> => ({
    ok: false,
    error: { code: 'invalid', message: 'untrusted sender' }
  })
  const failure = (e: unknown): IpcResult<never> => {
    if (e instanceof OscError) return { ok: false, error: { code: e.code, message: e.message } }
    console.error('ipc handler failed:', e)
    return { ok: false, error: { code: 'internal', message: String((e as Error)?.message || e) } }
  }

  /** Register `osc:<method>`: envelope in, envelope out, never throws. */
  const handle = <T>(method: string, fn: (args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(methodChannel(method), async (event, ...args): Promise<IpcResult<T>> => {
      if (!isTrusted(event.senderFrame)) return untrusted()
      try {
        return { ok: true, data: await fn(args) }
      } catch (e) {
        return failure(e)
      }
    })
  }

  // workspace
  // Fase 6: config() carries the dependency check (node, npx, openspec, git)
  handle('config', async () => ({ ...(await core.config()), tools: await detectTools() }))
  handle('repos', (a) => core.repos(check(z.boolean(), a[0] ?? false)))
  handle('addRoot', (a) => core.addRoot(parseOrThrow(rootBody, { path: a[0] })))
  handle('removeRoot', (a) => core.removeRoot(parseOrThrow(rootBody, { path: a[0] })))
  handle('init', (a) => core.init(parseOrThrow(initBody, { repo: a[0], agent: a[1] })))

  // openspec
  handle('changes', (a) => core.changes(check(z.string().min(1), a[0])))
  handle('archived', (a) => core.archived(check(z.string().min(1), a[0]), check(z.string(), a[1])))
  handle('file', (a) => core.file(check(z.string().min(1), a[0]), check(z.string(), a[1])))
  handle('action', (a) =>
    core.action(parseOrThrow(actionBody, { repo: a[0], action: a[1], change: a[2], text: a[3] }))
  )
  handle('settings', (a) =>
    core.settings(parseOrThrow(settingsBody, { repo: a[0], reviewInRepo: a[1] }))
  )

  // review
  const changeOf = (a: unknown[]) => parseOrThrow(changeBody, { repo: a[0], change: a[1] })
  handle('review', (a) => {
    const b = changeOf(a)
    return core.review(b.repo, b.change)
  })
  handle('addComment', (a) => core.addComment(parseOrThrow(commentCreate, a[0])))
  handle('patchComment', (a) => {
    const [id, patch] = check(z.tuple([z.string(), commentPatch]), a)
    return core.patchComment(id, patch)
  })
  handle('deleteComment', (a) => core.deleteComment(check(z.string(), a[0])))
  handle('sendReview', (a) => core.sendReview(changeOf(a)))
  handle('closeRound', (a) => core.closeRoundOf(changeOf(a)))

  // git
  handle('git', (a) => {
    const [repo, scope] = check(
      z.tuple([
        z.string().min(1),
        z.object({ change: z.string().optional(), archived: z.string().optional() }).optional()
      ]),
      a
    )
    return core.git(repo, scope ?? {})
  })
  handle('gitBranch', (a) =>
    core.gitBranch(parseOrThrow(gitBranchBody, { repo: a[0], change: a[1] }))
  )
  handle('gitCommit', (a) => core.gitCommit(parseOrThrow(gitCommitBody, a[0])))

  // realtime in: validate with the same clientMsg schema, then hand the message
  // to the core tied to this webContents' subscriber
  ipcMain.on(CLIENT_MSG_CHANNEL, (event, msg) => {
    if (!isTrusted(event.senderFrame)) return
    const sub = subscriberOf(event.sender as WebContentsRef)
    const parsed = clientMsg.safeParse(msg)
    if (!parsed.success) {
      sub.send({ type: 'error', message: `invalid message: ${describeIssues(parsed.error)}` })
      return
    }
    core.handleClientMsg(sub, parsed.data).catch(() => {})
  })

  return {
    attachWindow(win) {
      const wc = win.webContents
      // a reload builds a fresh page: whatever the old one subscribed to must go
      wc.on('did-start-navigation', () => drop(wc))
      wc.on('destroyed', () => drop(wc))
      wc.on('render-process-gone', () => drop(wc))
    }
  }
}

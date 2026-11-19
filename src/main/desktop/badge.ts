// Fase 5.4: the pending-decisions counter. When the sum of every repo's
// pendingInteractions changes, macOS/Linux get app.setBadgeCount (dock / Unity
// launcher) and Windows gets a taskbar overlay icon (win.setOverlayIcon) drawn
// by badge-icon.ts. The sum lives in the main: it is fed by every session
// state change the core reports, plus one snapshot when tracking starts.

import { app, nativeImage, type NativeImage } from 'electron'
import type { SessionState } from '@shared/protocol.ts'
import type { OscCore } from '../core/osc-core.ts'
import { countOverlayPng } from './badge-icon.ts'

/** The slice of a BrowserWindow the badge needs (tests fake it). */
export interface BadgeWindow {
  isDestroyed(): boolean
  setOverlayIcon(overlay: NativeImage | null, description: string): void
}

/** One repo's session state, the part the counter reads. */
export type SessionLike = Pick<SessionState, 'pendingInteractions'> | null

/** Apply a pending count to the app (macOS/Linux) or the window (Windows). */
export function applyPendingCount(win: BadgeWindow | null, n: number): void {
  const count = Math.max(0, Math.floor(n))
  if (process.platform === 'win32') {
    if (!win || win.isDestroyed()) return // no taskbar entry to decorate yet
    win.setOverlayIcon(
      count > 0 ? nativeImage.createFromBuffer(countOverlayPng(count)) : null,
      count > 0 ? `${count} pending decision${count === 1 ? '' : 's'}` : ''
    )
  } else {
    app.setBadgeCount(count)
  }
}

/** The per-repo counts and their sum; pure logic, fed by session changes. */
export function createPendingCounter(onCount: (n: number) => void) {
  const counts = new Map<string, number>()
  const recompute = () => onCount([...counts.values()].reduce((a, b) => a + b, 0))
  return {
    /** A repo's session changed (null = the session is gone). */
    observe(repo: string, session: SessionLike): void {
      const p = session?.pendingInteractions ?? 0
      if (p > 0) counts.set(repo, p)
      else counts.delete(repo)
      recompute()
    },
    /** Replace everything with a workspace snapshot (start / rescan): one apply. */
    snapshot(repos: { id: string; session: SessionLike }[]): void {
      counts.clear()
      for (const r of repos) {
        const p = r.session?.pendingInteractions ?? 0
        if (p > 0) counts.set(r.id, p)
      }
      recompute()
    },
    /** The current sum (a newly created window starts with it). */
    current(): number {
      return [...counts.values()].reduce((a, b) => a + b, 0)
    }
  }
}

/**
 * Wire the counter to the core: every session change updates the badge, the
 * first snapshot comes from core.repos(), and each window created later (the
 * macOS activate flow recreates the window) gets the current count reapplied.
 */
export function trackPendingInteractions(opts: {
  core: OscCore
  getWin: () => BadgeWindow | null
}): void {
  const apply = (n: number) => applyPendingCount(opts.getWin(), n)
  const counter = createPendingCounter(apply)
  opts.core.onSessionChange((repo, session) => counter.observe(repo, session))
  void opts.core
    .repos()
    .then((w) => counter.snapshot(w.repos))
    .catch(() => {}) // starting with no badge is fine
  // the macOS activate flow recreates the window: it starts with the count
  app.on('browser-window-created', (_e, win) => applyPendingCount(win, counter.current()))
}

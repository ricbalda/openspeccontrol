// Fase 5.4: the pending-decisions counter. The sum over all repos updates on
// every session change and drops to zero when a session goes away; Windows
// gets the overlay icon (null at zero), macOS/Linux get setBadgeCount; a
// window created later starts with the current count.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionState } from '@shared/protocol.ts'
import type { OscCore } from '../../src/main/core/osc-core.ts'
import {
  applyPendingCount,
  createPendingCounter,
  trackPendingInteractions,
  type BadgeWindow
} from '../../src/main/desktop/badge.ts'

const state = vi.hoisted(() => ({
  badgeCount: -1,
  overlays: [] as { icon: unknown; description: string }[],
  windowListeners: [] as ((event: unknown, win: unknown) => void)[]
}))
vi.mock('electron', () => ({
  app: {
    setBadgeCount: (n: number) => {
      state.badgeCount = n
      return true
    },
    on: (ev: string, fn: (event: unknown, win: unknown) => void) => {
      if (ev === 'browser-window-created') state.windowListeners.push(fn)
    }
  },
  nativeImage: {
    // keep the buffer so the test can check it is a PNG
    createFromBuffer: (buf: Buffer) => ({ buf })
  }
}))

const fakeWindow = (destroyed = false): BadgeWindow & { log: unknown[] } => {
  const log: unknown[] = []
  return {
    log,
    isDestroyed: () => destroyed,
    setOverlayIcon: (icon, description) => {
      log.push({ icon, description })
      state.overlays.push({ icon, description })
    }
  }
}

const PLATFORM = process.platform
const setPlatform = (p: string) =>
  Object.defineProperty(process, 'platform', { value: p, configurable: true })

beforeEach(() => {
  state.badgeCount = -1
  state.overlays.length = 0
  state.windowListeners.length = 0
})
afterEach(() => setPlatform(PLATFORM))

const session = (pendingInteractions: number) => ({ pendingInteractions }) as SessionState

describe('createPendingCounter', () => {
  it('sums across repos and back to zero', () => {
    const out: number[] = []
    const c = createPendingCounter((n) => out.push(n))
    c.observe('a', session(2))
    c.observe('b', session(1))
    c.observe('a', session(0)) // a's decisions were answered
    c.observe('b', null) // b's session ended
    expect(out).toEqual([2, 3, 1, 0])
    expect(c.current()).toBe(0)
  })

  it('a snapshot replaces everything (start / rescan)', () => {
    const out: number[] = []
    const c = createPendingCounter((n) => out.push(n))
    c.observe('old', session(5))
    c.snapshot([
      { id: 'a', session: session(1) },
      { id: 'b', session: null }
    ])
    expect(c.current()).toBe(1)
    expect(out.at(-1)).toBe(1)
  })
})

describe('applyPendingCount', () => {
  it('windows: the overlay carries the count and clears at zero', () => {
    setPlatform('win32')
    const win = fakeWindow()
    applyPendingCount(win, 3)
    applyPendingCount(win, 0)
    expect(win.log.length).toBe(2)
    expect(win.log[0]).toMatchObject({ description: '3 pending decisions' })
    expect((win.log[0] as any).icon.buf.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(win.log[1]).toMatchObject({ icon: null, description: '' })
  })

  it('macOS/Linux: the app badge count follows the sum', () => {
    setPlatform('darwin')
    applyPendingCount(null, 4) // no window needed
    expect(state.badgeCount).toBe(4)
    setPlatform('linux')
    applyPendingCount(null, 0)
    expect(state.badgeCount).toBe(0)
  })
})

describe('trackPendingInteractions', () => {
  it('feeds session changes to the current window and to later windows', async () => {
    setPlatform('win32')
    const observers: ((repo: string, s: SessionState | null) => void)[] = []
    const core = {
      onSessionChange: (cb: (repo: string, s: SessionState | null) => void) => {
        observers.push(cb)
        return () => {}
      },
      repos: async () => ({
        roots: [],
        repos: [
          { id: 'r1', session: session(1) },
          { id: 'r2', session: null }
        ]
      })
    } as unknown as OscCore
    const win = fakeWindow()
    trackPendingInteractions({ core, getWin: () => win })
    // the startup snapshot lands
    await vi.waitFor(() => expect(win.log.length).toBe(1))
    expect((win.log[0] as any).description).toBe('1 pending decision')
    // a live change: one more decision pending in r2
    observers[0]('r2', session(1))
    expect((win.log[1] as any).description).toBe('2 pending decisions')
    // a window created later (macOS activate) starts with the current count
    const win2 = fakeWindow()
    state.windowListeners[0]({} as never, win2) // (event, window)
    expect((win2.log[0] as any).description).toBe('2 pending decisions')
  })
})

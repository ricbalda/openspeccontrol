// Fase 5.3: OS notifications. Shown only while the window is unfocused, a
// click restores and focuses the window, `attention` also flashes the taskbar
// entry until the next focus, and a system without notifications still gets
// the flash.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showAppNotification, type NotifyWindow } from '../../src/main/desktop/notifications.ts'

const state = vi.hoisted(() => ({
  supported: true,
  shown: 0,
  opts: null as any,
  clicks: [] as (() => void)[]
}))
vi.mock('electron', () => ({
  Notification: class {
    static isSupported() {
      return state.supported
    }
    constructor(opts: unknown) {
      state.opts = opts
    }
    on(_ev: string, fn: () => void) {
      state.clicks.push(fn)
    }
    show() {
      state.shown++
    }
  }
}))

const fakeWindow = (focused: boolean): NotifyWindow & { log: string[] } => {
  const log: string[] = []
  return {
    log,
    isFocused: () => focused,
    isDestroyed: () => false,
    show: () => log.push('show'),
    focus: () => log.push('focus'),
    flashFrame: (f: boolean) => log.push(`flash:${f}`),
    once: (ev, fn) => {
      if (ev === 'focus') {
        log.push(`once:${ev}`)
        ;(log as any).focusFn = fn
      }
    }
  }
}

beforeEach(() => {
  state.supported = true
  state.shown = 0
  state.opts = null
  state.clicks.length = 0
})

describe('showAppNotification (tarea 5.3)', () => {
  it('shows nothing while the window has focus', () => {
    showAppNotification({ title: 't' }, fakeWindow(true))
    expect(state.shown).toBe(0)
  })

  it('shows a notification for an unfocused window', () => {
    showAppNotification({ title: 'Done', body: 'the build' }, fakeWindow(false))
    expect(state.shown).toBe(1)
    expect(state.opts).toEqual({ title: 'Done', body: 'the build' })
  })

  it('a click restores and focuses the window', () => {
    const win = fakeWindow(false)
    showAppNotification({ title: 't' }, win)
    state.clicks[0]()
    expect(win.log).toContain('show')
    expect(win.log).toContain('focus')
  })

  it('attention flashes the taskbar until the window is focused', () => {
    const win = fakeWindow(false)
    showAppNotification({ title: 't', kind: 'attention' }, win)
    expect(win.log).toContain('flash:true')
    ;(win.log as any).focusFn() // the window got the user back
    expect(win.log).toContain('flash:false')
  })

  it('without Notification support the flash still happens', () => {
    state.supported = false
    const win = fakeWindow(false)
    showAppNotification({ title: 't', kind: 'attention' }, win)
    expect(state.shown).toBe(0)
    expect(win.log).toContain('flash:true')
  })

  it('works without a window at all (the notification still shows)', () => {
    showAppNotification({ title: 't' }, null)
    expect(state.shown).toBe(1)
  })
})

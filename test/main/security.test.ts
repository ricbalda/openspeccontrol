// Fase 7 hardening (tareas 7.1 y 7.3): the fixed webPreferences, the
// deny-by-default permission handlers (only clipboard-sanitized-write) and
// the window blocks (webview, window.open, navigation). Everything is
// injected, so the rules run here against fakes without electron.

import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_PERMISSION,
  applySessionSecurity,
  applyWindowSecurity,
  permissionAllowed,
  secureWebPreferences,
  type SessionRef,
  type WindowContentsRef
} from '../../src/main/desktop/security.ts'

/** A session that captures the two handlers for the test to drive. */
function fakeSession() {
  let request: ((wc: unknown, permission: string, cb: (granted: boolean) => void) => void) | null =
    null
  let check: ((wc: unknown, permission: string, origin: string) => boolean) | null = null
  const s: SessionRef = {
    setPermissionRequestHandler: (h) => (request = h),
    setPermissionCheckHandler: (h) => (check = h)
  }
  return {
    s,
    request: (...a: Parameters<NonNullable<typeof request>>) => request!(...a),
    check: (...a: Parameters<NonNullable<typeof check>>) => check!(...a)
  }
}

describe('secureWebPreferences (tarea 7.1)', () => {
  it('fixes the six hardening switches', () => {
    expect({ ...secureWebPreferences }).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      navigateOnDragDrop: false
    })
  })

  it('is frozen: nobody can loosen it at runtime', () => {
    expect(Object.isFrozen(secureWebPreferences)).toBe(true)
  })
})

describe('permission handlers (tarea 7.3)', () => {
  it('grants only clipboard-sanitized-write, denies every other permission', () => {
    const { s, request, check } = fakeSession()
    applySessionSecurity(s)

    const granted: boolean[] = []
    request(null, ALLOWED_PERMISSION, (g) => granted.push(g))
    for (const p of [
      'clipboard-read',
      'clipboard-read-text',
      'notifications',
      'media',
      'mediaKeySystem',
      'geolocation',
      'fullscreen',
      'pointerLock',
      'display-capture',
      'openExternal',
      'unknown-future-permission'
    ]) {
      request(null, p, (g) => granted.push(g))
    }
    expect(granted).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false
    ])

    // the synchronous check agrees with the request handler
    expect(check(null, ALLOWED_PERMISSION, 'dev://')).toBe(true)
    expect(check(null, 'notifications', 'dev://')).toBe(false)
    expect(check(null, 'media', 'dev://')).toBe(false)
  })

  it('is deny-by-default for permissions that do not exist yet', () => {
    expect(permissionAllowed('whatever-comes-next')).toBe(false)
  })
})

describe('window blocks (tarea 7.3)', () => {
  function fakeContents() {
    const handlers = {
      windowOpen: null as ((d: { url: string }) => { action: 'deny' }) | null,
      webview: null as ((e: { preventDefault(): void }) => void) | null,
      navigate: null as ((e: { preventDefault(): void }, url: string) => void) | null
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c: WindowContentsRef = {
      setWindowOpenHandler: (h) => (handlers.windowOpen = h),
      on: (event, listener) => {
        if (event === 'will-attach-webview') handlers.webview = listener as never
        if (event === 'will-navigate') handlers.navigate = listener as never
      }
    }
    applyWindowSecurity(c)
    return { handlers, warn }
  }

  it('denies every window.open, whatever the url', () => {
    const { handlers } = fakeContents()
    expect(handlers.windowOpen!({ url: 'https://evil.example' })).toEqual({ action: 'deny' })
    expect(handlers.windowOpen!({ url: 'about:blank' })).toEqual({ action: 'deny' })
  })

  it('prevents a <webview> from attaching at all', () => {
    const { handlers } = fakeContents()
    const preventDefault = vi.fn()
    handlers.webview!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('prevents any in-page navigation away from the app page', () => {
    const { handlers } = fakeContents()
    const preventDefault = vi.fn()
    handlers.navigate!({ preventDefault }, 'https://evil.example')
    handlers.navigate!({ preventDefault }, 'file:///etc/passwd')
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })
})

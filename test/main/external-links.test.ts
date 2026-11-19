// Fase 5.5: external links. Only http:, https: and mailto: ever leave the app;
// the window-open backstop denies everything (allowed links go to the OS
// browser instead) and will-navigate is cancelled for anything that is not the
// app's own page — so file:, javascript: and dropped navigations do nothing.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  installLinkGuard,
  isAllowedLink,
  isAppUrl,
  openExternalLink,
  type GuardContents
} from '../../src/main/desktop/external-links.ts'

const state = vi.hoisted(() => ({ opened: [] as string[] }))
vi.mock('electron', () => ({
  shell: {
    openExternal: async (url: string) => {
      state.opened.push(url)
    }
  },
  ipcMain: { handle: () => {}, on: () => {} } // pulled in through src/main/ipc.ts
}))

const fakeContents = (): GuardContents & {
  openHandler: (d: { url: string }) => { action: string }
  navHandlers: ((e: { prevented: boolean; preventDefault(): void }, url: string) => void)[]
} => {
  let openHandler: (d: { url: string }) => { action: string } = () => ({ action: 'allow' })
  const navHandlers: ((e: { prevented: boolean; preventDefault(): void }, url: string) => void)[] =
    []
  return {
    openHandler: (d) => openHandler(d),
    navHandlers,
    setWindowOpenHandler: (h) => {
      openHandler = h
    },
    on: (_ev, fn) => navHandlers.push(fn)
  }
}

beforeAll(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('link schemes (tarea 5.5)', () => {
  it('accepts http, https and mailto only', () => {
    expect(isAllowedLink('https://example.com/x?y=1')).toBe(true)
    expect(isAllowedLink('http://127.0.0.1:3000/')).toBe(true)
    expect(isAllowedLink('mailto:someone@example.com')).toBe(true)
    expect(isAllowedLink('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isAllowedLink('javascript:alert(1)')).toBe(false)
    expect(isAllowedLink('not a url')).toBe(false)
  })

  it('openExternalLink opens allowed links and reports refused ones', async () => {
    await expect(openExternalLink('https://example.com')).resolves.toEqual({ opened: true })
    await expect(openExternalLink('file:///etc/passwd')).resolves.toEqual({ opened: false })
    expect(state.opened).toEqual(['https://example.com'])
  })
})

describe('the window guard', () => {
  it('denies every window open; allowed links still reach the browser', () => {
    const wc = fakeContents()
    installLinkGuard(wc)
    expect(wc.openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(wc.openHandler({ url: 'file:///C:/x' })).toEqual({ action: 'deny' })
    expect(state.opened).toContain('https://example.com') // opened by the handler
  })

  it('cancels navigation away from the app, allows the app itself', () => {
    const wc = fakeContents()
    installLinkGuard(wc)
    const run = (url: string) => {
      const e = {
        prevented: false,
        preventDefault() {
          this.prevented = true
        }
      }
      wc.navHandlers[0](e, url)
      return e.prevented
    }
    expect(run('https://evil.example')).toBe(true)
    expect(run('file:///C:/x.html')).toBe(true)
    expect(run('http://localhost:5173/changes/add-x')).toBe(false) // the dev page (HMR)
    expect(isAppUrl('http://localhost:5173/')).toBe(true)
    expect(isAppUrl('http://localhost:9999/')).toBe(false)
  })
})

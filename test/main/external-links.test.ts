// Fase 5.5: external links. Only http:, https: and mailto: ever leave the app.
// The window-open/will-navigate blocks belong to Fase 7's security.ts
// (applyWindowSecurity, installed once per window); these tests cover the
// allow-list and the OS hand-off the markdown anchors and the IPC channel use.

import { describe, expect, it, vi } from 'vitest'
import { isAllowedLink, openExternalLink } from '../../src/main/desktop/external-links.ts'

const state = vi.hoisted(() => ({ opened: [] as string[] }))
vi.mock('electron', () => ({
  shell: {
    openExternal: async (url: string) => {
      state.opened.push(url)
    }
  }
}))

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

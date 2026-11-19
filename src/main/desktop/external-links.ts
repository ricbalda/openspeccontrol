// Fase 5.5: links. Markdown documents (proposals, specs, agent replies) can
// carry links, but the app window must never navigate away from itself. Links
// go to the OS browser via window.osc.openExternal — and only http:, https:
// and mailto: pass. As a backstop, every new window is denied (target=_blank
// opens externally instead) and will-navigate is cancelled for anything that
// is not the app's own page, so file:, javascript: and any dropped navigation
// do nothing.

import { shell } from 'electron'
import { packagedIndexUrl } from '../ipc.ts'

/** The schemes the app is willing to hand to the OS. */
export const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Only http(s) and mailto URLs, and only ones that actually parse. */
export function isAllowedLink(url: string): boolean {
  try {
    return ALLOWED_LINK_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** The URLs that ARE the app: the dev server (HMR reloads) or the packaged page. */
export function isAppUrl(url: string): boolean {
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

/** Open a link in the system browser if its scheme is allowed. */
export async function openExternalLink(url: string): Promise<{ opened: boolean }> {
  if (!isAllowedLink(url)) return { opened: false }
  await shell.openExternal(url)
  return { opened: true }
}

/** The slice of webContents the guard needs (tests fake it). */
export interface GuardContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): void
}

/**
 * Install the backstops on a window: no new windows ever (allowed links go to
 * the browser instead), and no navigation away from the app's own page.
 */
export function installLinkGuard(wc: GuardContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    // target=_blank / window.open: never a new Electron window, but a link
    // the markdown didn't catch still reaches the OS browser
    if (isAllowedLink(url)) void openExternalLink(url).catch(() => {})
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
}

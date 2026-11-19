// Fase 5.5: external links. Markdown documents (proposals, specs, agent
// replies) can carry links; they open in the OS browser through
// window.osc.openExternal, and only http:, https: and mailto: ever pass — so
// file:, javascript: and anything else do nothing at all.
//
// The window-side blocking (no window.open, no navigation away from the app
// page, no <webview>) is Fase 7's security.ts applyWindowSecurity(), installed
// once per window in index.ts; this module deliberately installs no handlers
// so the two never conflict. The markdown anchors (renderer) call preventDefault
// and route through openExternal before Electron's deny-all backstop is needed.

import { shell } from 'electron'

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

/** Open a link in the system browser if its scheme is allowed. */
export async function openExternalLink(url: string): Promise<{ opened: boolean }> {
  if (!isAllowedLink(url)) return { opened: false }
  await shell.openExternal(url)
  return { opened: true }
}

// Fase 5.5: links inside rendered markdown. The window must never navigate,
// so an anchor hands its URL to the OS browser through window.osc.openExternal
// and always cancels the default navigation. Only http:, https: and mailto:
// are even attempted (the main re-validates); file:, javascript: and anything
// else do nothing at all.

import type { AnchorHTMLAttributes } from 'react'

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  node?: unknown
}

/** The same allow-list the main process enforces for openExternal. */
const OPENABLE = /^(https?|mailto):/i

/** `a` for react-markdown components maps: same look, OS-browser navigation. */
export function ExternalAnchor({ node: _node, href, children, ...rest }: AnchorProps) {
  const open = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault() // the window itself never navigates
    if (!href || !OPENABLE.test(href)) return
    try {
      window.osc.openExternal(href).catch(() => {})
    } catch {
      /* preload missing: stay put */
    }
  }
  return (
    <a {...rest} href={href} target="_blank" rel="noreferrer" onClick={open}>
      {children}
    </a>
  )
}

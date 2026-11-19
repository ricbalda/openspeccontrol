import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'

const STEP = 16

/**
 * A focusable window splitter (WAI-ARIA) on one vertical edge of a panel. Drag it to widen or
 * narrow the panel; ←/→ do the same from the keyboard (16 px, 64 px with Shift) and a
 * double-click restores the default. It does not know which panel it serves: the limits come in
 * as `clamp` and `max`, so the rail and the agent column share it.
 *
 * `edge` is the side of the panel the handle sits on: on the `left` edge moving left widens the
 * panel (the agent column); on the `right` edge moving right widens it (the rail).
 */
export function PanelResizer({
  edge,
  width,
  min,
  max,
  clamp,
  label,
  title,
  onChange,
  onReset
}: {
  edge: 'left' | 'right'
  width: number
  min: number
  /** the widest the panel can be right now (for assistive technology) */
  max: () => number
  /** keeps a width inside the limits of this window */
  clamp: (w: number) => number
  label: string
  title: string
  onChange: (w: number) => void
  onReset: () => void
}): React.JSX.Element {
  const drag = useRef<{ x: number; w: number } | null>(null)
  const frame = useRef<number | null>(null)
  const pending = useRef(width)
  // +1 when moving right widens the panel, -1 when moving left does
  const sign = edge === 'right' ? 1 : -1

  // dragging: the document must not select text, and the cursor stays a resize cursor
  const endDrag = () => {
    drag.current = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }
  // unmounting mid-drag must not leave the page without text selection or with a resize cursor
  useEffect(
    () => () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width }
    pending.current = width
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    pending.current = clamp(d.w + sign * (e.clientX - d.x))
    if (frame.current === null) {
      // one layout update per frame: the document re-lays out (and its comments move) on each change
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        onChange(pending.current)
      })
    }
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    endDrag()
    onChange(pending.current)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.shiftKey ? STEP * 4 : STEP
    onChange(clamp(width + (e.key === 'ArrowRight' ? sign * step : -sign * step)))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max()}
      tabIndex={0}
      title={title}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}
      className={`group absolute inset-y-0 z-20 w-3 cursor-col-resize touch-none outline-none ${
        edge === 'left' ? '-left-1.5' : '-right-1.5'
      }`}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  )
}

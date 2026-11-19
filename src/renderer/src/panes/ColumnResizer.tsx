import { PanelResizer } from './PanelResizer.tsx'

/** The agent column's width: at least this wide, and at most AGENT_MAX. */
export const AGENT_MIN = 300
export const AGENT_MAX = 900
/** The rail's width (repositories and changes): at least RAIL_MIN, at most RAIL_MAX. */
export const RAIL_MIN = 200
export const RAIL_MAX = 480
/** The middle pane (the document) keeps at least this much room. */
export const CENTER_MIN = 480
const AGENT_KEY = 'agent-width'
const RAIL_KEY = 'rail-width'

/** Keep a width inside the limits, and leave the document its room in this window. */
export function clampAgentWidth(w: number, viewport: number, railWidth: number): number {
  const max = Math.max(AGENT_MIN, Math.min(AGENT_MAX, viewport - railWidth - CENTER_MIN))
  return Math.round(Math.min(max, Math.max(AGENT_MIN, w)))
}

/** Same for the rail: what the agent column takes is not available to it. */
export function clampRailWidth(w: number, viewport: number, agentWidth: number): number {
  const max = Math.max(RAIL_MIN, Math.min(RAIL_MAX, viewport - agentWidth - CENTER_MIN))
  return Math.round(Math.min(max, Math.max(RAIL_MIN, w)))
}

/**
 * The widths in effect for the rail and the chat in this window. `pref*` is what the user chose
 * (null: the layout's default, `def*`). The chat gives way first when the window shrinks, then
 * the rail; a window that grows again brings the chosen widths back, because the preferences are
 * kept as chosen. `rail` and `agent` are numbers to lay out with; `railInline` / `agentInline`
 * say whether they must override the CSS defaults.
 */
export function resolveWidths(o: {
  viewport: number
  prefRail: number | null
  prefAgent: number | null
  defRail: number
  defAgent: number
}): { rail: number; agent: number; railInline: boolean; agentInline: boolean } {
  const rail0 = o.prefRail === null ? o.defRail : Math.min(RAIL_MAX, Math.max(RAIL_MIN, o.prefRail))
  const agent = clampAgentWidth(o.prefAgent ?? o.defAgent, o.viewport, rail0)
  const rail = o.prefRail === null ? o.defRail : clampRailWidth(rail0, o.viewport, agent)
  return {
    rail,
    agent,
    railInline: o.prefRail !== null,
    // the default chat only needs an override when a wider rail leaves it less room
    agentInline: o.prefAgent !== null || (o.prefRail !== null && agent !== o.defAgent)
  }
}

/** A stored width, or null when there is none (or it is not a width). */
function readWidth(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

function saveWidth(key: string, w: number | null) {
  try {
    if (w === null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(w))
  } catch {
    /* private mode */
  }
}

/** The width the user chose, or null for the layout's default. */
export const readAgentWidth = (): number | null => readWidth(AGENT_KEY)
export const saveAgentWidth = (w: number | null): void => saveWidth(AGENT_KEY, w)
export const readRailWidth = (): number | null => readWidth(RAIL_KEY)
export const saveRailWidth = (w: number | null): void => saveWidth(RAIL_KEY, w)

/**
 * The handle on the agent column's left edge. Drag it to widen or narrow the
 * chat; arrow keys do the same from the keyboard, double-click restores the default.
 */
export function ColumnResizer({
  width,
  onChange,
  onReset,
  railWidth
}: {
  width: number
  onChange: (w: number) => void
  onReset: () => void
  railWidth: () => number
}): React.JSX.Element {
  return (
    <PanelResizer
      edge="left"
      width={width}
      min={AGENT_MIN}
      max={() => clampAgentWidth(AGENT_MAX, window.innerWidth, railWidth())}
      clamp={(w) => clampAgentWidth(w, window.innerWidth, railWidth())}
      label="Resize the chat panel"
      title="Drag to resize the chat · double-click to reset"
      onChange={onChange}
      onReset={onReset}
    />
  )
}

/**
 * The handle on the rail's right edge: the same behaviour, for the repository and changes
 * column. The chat keeps the width it has; the rail only takes what the document can spare.
 */
export function RailResizer({
  width,
  onChange,
  onReset,
  agentWidth
}: {
  width: number
  onChange: (w: number) => void
  onReset: () => void
  agentWidth: () => number
}): React.JSX.Element {
  return (
    <PanelResizer
      edge="right"
      width={width}
      min={RAIL_MIN}
      max={() => clampRailWidth(RAIL_MAX, window.innerWidth, agentWidth())}
      clamp={(w) => clampRailWidth(w, window.innerWidth, agentWidth())}
      label="Resize the repositories panel"
      title="Drag to resize the panel · double-click to reset"
      onChange={onChange}
      onReset={onReset}
    />
  )
}

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { boot, initialTheme, setTheme, useStore } from './store.ts'
import { UpdatePill } from './UpdatePill.tsx'
import { cx, IconButton } from './lib/ui.tsx'
import { RepoRail } from './panes/RepoRail.tsx'
import { DocReview } from './panes/DocReview.tsx'
import { AgentPanel } from './panes/AgentPanel.tsx'
import { AddFolderDialog } from './panes/Folders.tsx'
import { ToolsDialog } from './panes/ToolsDialog.tsx'
import { DemoRepoDialog } from './panes/DemoRepoDialog.tsx'
import { ErrorBoundary } from './lib/ErrorBoundary.tsx'
import {
  ColumnResizer,
  RailResizer,
  readAgentWidth,
  readRailWidth,
  resolveWidths,
  saveAgentWidth,
  saveRailWidth
} from './panes/ColumnResizer.tsx'

/** a layout width the breakpoints set in index.css (--agent-w, --rail-w), in px */
const cssWidth = (name: string, fallback: number) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback
/** the rail's width at this window width when the CSS cannot say (the breakpoints in index.css) */
const railFor = (vw: number) => (vw < 1024 ? 210 : vw < 1280 ? 230 : 272)

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto max-w-lg rounded-xl px-4 py-2 text-[13px] shadow-pop',
            t.level === 'error' ? 'bg-bad text-white' : 'bg-fg text-bg'
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

function ThemeToggle() {
  const [t, setT] = useState(initialTheme)
  const next = { system: 'light', light: 'dark', dark: 'system' } as const
  const Icon = t === 'light' ? Sun : t === 'dark' ? Moon : Monitor
  return (
    <IconButton
      title={`Theme: ${t}`}
      onClick={() => {
        const n = next[t]
        setTheme(n)
        setT(n)
      }}
    >
      <Icon size={15} />
    </IconButton>
  )
}

export function App() {
  const repo = useStore((s) => s.repo)
  const change = useStore((s) => s.change)
  // the widths the user dragged to (kept as chosen); null keeps the layout's default
  const [preferred, setPreferred] = useState<number | null>(readAgentWidth)
  const [preferredRail, setPreferredRail] = useState<number | null>(readRailWidth)
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    setTheme(initialTheme())
    boot()
  }, [])
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // the widths in effect: the chosen ones, kept inside what this window leaves the document (each
  // limit counts the other column's width); a window that gets wider again brings them back
  const w = resolveWidths({
    viewport: vw,
    prefRail: preferredRail,
    prefAgent: preferred,
    defRail: cssWidth('--rail-w', railFor(vw)),
    defAgent: cssWidth('--agent-w', 400)
  })
  const chooseWidth = (v: number | null) => {
    setPreferred(v)
    saveAgentWidth(v)
  }
  const chooseRailWidth = (v: number | null) => {
    setPreferredRail(v)
    saveRailWidth(v)
  }
  const widths = {
    ...(w.railInline && { '--rail-w': `${w.rail}px` }),
    ...(w.agentInline && { '--agent-w': `${w.agent}px` })
  } as React.CSSProperties
  return (
    <div
      className="grid h-full grid-cols-[var(--rail-w)_minmax(0,1fr)_var(--agent-w)]"
      style={widths}
    >
      <div className="relative h-full min-h-0 min-w-0">
        <ErrorBoundary name="Repositories">
          <RepoRail />
        </ErrorBoundary>
        <RailResizer
          width={w.rail}
          onChange={(v) => chooseRailWidth(v)}
          onReset={() => chooseRailWidth(null)}
          agentWidth={() => w.agent}
        />
      </div>
      <ErrorBoundary name="Review" resetKey={`${repo}|${change}`}>
        <DocReview />
      </ErrorBoundary>
      {/* h-full + min-h-0: the chat scrolls inside its column; a long transcript must not grow the grid row */}
      <div className="relative h-full min-h-0 min-w-0">
        <ErrorBoundary name="Agent panel" resetKey={repo}>
          <AgentPanel />
        </ErrorBoundary>
        <ColumnResizer
          width={w.agent}
          onChange={(v) => chooseWidth(v)}
          onReset={() => chooseWidth(null)}
          railWidth={() => w.rail}
        />
      </div>
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-1">
        <ThemeToggle />
        <UpdatePill />
      </div>
      <Toasts />
      <AddFolderDialog />
      <ToolsDialog />
      <DemoRepoDialog />
    </div>
  )
}

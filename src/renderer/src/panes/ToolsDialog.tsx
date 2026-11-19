// Fase 6 (tarea 6.4): the dependency diagnostics — node, npx, openspec and git
// with version, path and, when missing, the install command (openspec:
// `npm install -g @fission-ai/openspec`). MissingToolsNote is the warning the
// "Set up OpenSpec" screen and the agent panel show when openspec or node is
// not installed. The Ayuda → Diagnóstico de dependencias menu entry calls
// openDiagnostics(); the native menu itself is wired by the orchestrator
// (Fase 4 owns desktop/menu.ts).

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, Wrench, X } from 'lucide-react'
import type { ToolStatus } from '@shared/ipc.ts'
import { api } from '../lib/api.ts'
import { openDiagnostics, toast, useStore } from '../store.ts'
import { Badge, Button, Dialog, IconButton, Spinner } from '../lib/ui.tsx'

const LABELS: Record<ToolStatus['id'], string> = {
  node: 'Node.js',
  npx: 'npx',
  openspec: 'OpenSpec CLI',
  git: 'git'
}

/** The tools the spec calls out in the warnings (tarea 6.4): openspec and node. */
const missingCritical = (tools: ToolStatus[]) =>
  tools.filter((t) => !t.found && (t.id === 'openspec' || t.id === 'node'))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`Copied: ${text}`)
  } catch {
    toast(text)
  }
}

/** Ayuda → Diagnóstico de dependencias: the table of external CLIs. */
export function ToolsDialog() {
  const open = useStore((s) => s.diagOpen)
  const tools = useStore((s) => s.tools)
  const [checking, setChecking] = useState(false)

  // re-check on open: the user may have installed something since boot
  useEffect(() => {
    if (!open) return
    let alive = true
    setChecking(true)
    api
      .config()
      .then((cfg) => {
        if (alive) useStore.setState({ tools: cfg.tools ?? [] })
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  const recheck = async () => {
    setChecking(true)
    const cfg = await api.config().catch(() => null)
    if (cfg) useStore.setState({ tools: cfg.tools ?? [] })
    setChecking(false)
  }

  const missing = tools.filter((t) => !t.found)

  return (
    <Dialog
      open={open}
      onClose={() => openDiagnostics(false)}
      wide
      title={
        <span className="flex items-center gap-2">
          <Wrench size={15} className="text-accent" /> Dependency diagnostics
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => openDiagnostics(false)}>
            Close
          </Button>
          <Button variant="secondary" disabled={checking} onClick={recheck}>
            {checking ? <Spinner className="h-3 w-3" /> : null} Re-check
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">
        OpenSpecControl runs these tools outside the app to talk to your repos and the agents. When
        one is missing, install it in a terminal and restart OpenSpecControl.
      </p>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Path</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tools.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 font-medium">{LABELS[t.id]}</td>
                <td className="px-3 py-2">
                  {t.found ? (
                    <Badge tone="ok">
                      <Check size={11} /> Found
                    </Badge>
                  ) : (
                    <Badge tone="bad">
                      <X size={11} /> Missing
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px]">{t.version ?? '—'}</td>
                <td
                  className="max-w-64 truncate px-3 py-2 font-mono text-[11.5px] text-muted"
                  title={t.path}
                >
                  {t.path ?? ''}
                </td>
              </tr>
            ))}
            {!tools.length && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-muted">
                  {checking ? 'Checking…' : 'No data'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {missing.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={t.hint}>
                {t.hint}
              </span>
              <IconButton title="Copy" className="h-5 w-5 shrink-0" onClick={() => copy(t.hint!)}>
                <Copy size={11} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}

/**
 * The missing-tools warning (tarea 6.4): shown in the "Set up OpenSpec" screen
 * and in the agent panel when openspec or node is not installed, with the
 * install command and a link to the full diagnostics.
 */
export function MissingToolsNote() {
  const tools = useStore((s) => s.tools)
  const missing = missingCritical(tools)
  if (!missing.length) return null
  return (
    <div className="w-full max-w-sm rounded-xl border border-warn/40 bg-warn-soft/40 px-3 py-2.5 text-left">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-warn">
        <AlertTriangle size={13} /> External tools missing
      </div>
      {missing.map((t) => (
        <div key={t.id} className="mt-1.5 text-xs text-fg-2">
          {t.id === 'openspec'
            ? 'The OpenSpec CLI is not installed. Install it with:'
            : 'Node.js is not installed (the agents and npx need it).'}
          {t.hint && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-bg px-2 py-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px]" title={t.hint}>
                {t.hint}
              </code>
              <IconButton title="Copy" className="h-5 w-5 shrink-0" onClick={() => copy(t.hint!)}>
                <Copy size={11} />
              </IconButton>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => openDiagnostics()}
        className="mt-2 text-[11px] text-accent hover:underline"
      >
        Open diagnostics
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { createDemo, openDemoRepo, useStore } from '../store.ts'
import { Button, Dialog, Spinner } from '../lib/ui.tsx'

/**
 * Ayuda → Crear repositorio de demostración (Fase 5.7): elegir el agente y luego
 * la carpeta con el selector nativo. La creación corre en el proceso main de forma
 * asíncrona; aquí solo se muestra un spinner, así que la UI no se bloquea.
 */
export function DemoRepoDialog(): React.JSX.Element {
  const open = useStore((s) => s.demoOpen)
  const agents = useStore((s) => s.agents)
  const current = useStore((s) => s.agent)
  const defaultAgent = useStore((s) => s.defaultAgent)
  const [agent, setAgent] = useState('')
  const [busy, setBusy] = useState(false)

  // al abrir, proponer el agente activo (o el predeterminado)
  useEffect(() => {
    if (open) setAgent(current || defaultAgent)
  }, [open, current, defaultAgent])

  const close = (): void => openDemoRepo(false)
  const chosen = agents.find((a) => a.id === agent)

  const create = async (): Promise<void> => {
    setBusy(true)
    const ok = await createDemo(chosen ? chosen.id : null) // false: cancelado o con error (toast)
    setBusy(false)
    if (ok) close()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create demo repository"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={create}>
            {busy ? <Spinner className="h-3 w-3" /> : <FolderOpen size={13} />} Choose folder…
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">
        Creates <span className="font-mono">hello-app</span> inside the folder you pick: a small git
        repo with a spec and the <span className="font-mono">add-hello-endpoint</span> change
        waiting in review. Running it again resets the demo.
      </p>
      <label className="flex flex-col gap-1 text-[10.5px] uppercase tracking-wide text-muted">
        Agent
        <select
          value={agent}
          disabled={busy}
          onChange={(e) => setAgent(e.target.value)}
          className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-[12.5px] normal-case tracking-normal text-fg outline-none hover:border-line-strong"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {chosen && !chosen.openspecTool && (
        <p className="mt-2 text-[12px] text-muted">
          This agent has no OpenSpec integration: the demo is created without{' '}
          <span className="font-mono">openspec init</span>.
        </p>
      )}
    </Dialog>
  )
}

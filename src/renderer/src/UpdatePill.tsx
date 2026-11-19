// La píldora de actualización (Fase 9, tarea 9.3): "Descargando x.y.z (n %)" mientras
// electron-updater descarga y "Reiniciar para actualizar a x.y.z" cuando termina. El clic
// pide a main que reinicie: con un agente trabajando o decisiones pendientes main muestra
// primero la confirmación de cierre seguro (Cancelar lo deja todo como está). El aspa
// la oculta hasta la próxima versión, como hacía el aviso de Studio.

import { useState } from 'react'
import { ArrowUpCircle, Download, X } from 'lucide-react'
import { pillLabel } from './lib/update-text.ts'
import { installUpdate, useStore } from './store.ts'

const DISMISS_KEY = 'update-dismissed'
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode */
  }
}

/** "Reiniciar para actualizar a x.y.z": se oculta por versión, no para siempre. */
export function UpdatePill(): React.JSX.Element | null {
  const u = useStore((s) => s.update)
  const [hidden, setHidden] = useState<string | null>(() => lsGet(DISMISS_KEY))
  const [busy, setBusy] = useState(false)
  const label = pillLabel(u)
  if (!u || !label || !u.latest || hidden === u.latest) return null
  const ready = u.status === 'downloaded'
  const restart = async () => {
    setBusy(true)
    try {
      await installUpdate()
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex items-center rounded-full bg-accent-soft text-[11px] text-accent">
      {ready ? (
        <button
          type="button"
          onClick={restart}
          disabled={busy}
          className="flex items-center gap-1 py-0.5 pl-2 pr-1 hover:underline disabled:opacity-60"
          title={`Tienes la ${u.current}. Cierra y abre la ${u.latest}; si hay un agente trabajando, se pide confirmación antes.`}
        >
          <ArrowUpCircle size={12} /> {label}
        </button>
      ) : (
        <span
          className="flex items-center gap-1 py-0.5 pl-2 pr-1"
          title={`Tienes la ${u.current}. La ${u.latest} se descarga en segundo plano.`}
        >
          <Download size={12} /> {label}
        </span>
      )}
      <button
        type="button"
        title="Ocultar hasta la próxima versión"
        onClick={() => {
          lsSet(DISMISS_KEY, u.latest!)
          setHidden(u.latest!)
        }}
        className="rounded-full py-0.5 pl-0.5 pr-1.5 opacity-70 hover:opacity-100"
      >
        <X size={11} />
      </button>
    </span>
  )
}

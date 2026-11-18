import { useEffect, useState } from 'react'
import { addRoot, openAddFolder, useStore } from '../store.ts'
import { Button, Dialog } from '../lib/ui.tsx'

/**
 * Add a workspace folder by typing its path (Fase 3). Studio's own folder
 * browser went away with the HTTP transport; Fase 5 replaces most of this
 * typing with the native folder picker (`pickFolder()`), keeping the written
 * path for network or WSL locations.
 */
export function AddFolderDialog() {
  const open = useStore((s) => s.addFolderOpen)
  const platform = useStore((s) => s.platform)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setInput('')
  }, [open])

  const close = () => openAddFolder(false)
  const target = input.trim()
  const add = async () => {
    setBusy(true)
    const ok = await addRoot(target) // failures surface as a toast (store.guard)
    setBusy(false)
    if (ok) close()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title="Add a folder"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!target || busy} onClick={add}>
            Add this folder
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">
        Enter the folder that holds your repos (or a single repo). OpenSpecControl lists every git
        or OpenSpec repo up to 4 levels inside it. The system folder picker arrives with the native
        integrations; until then, type or paste the full path (~ works).
      </p>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && target && !busy) add()
        }}
        placeholder={platform === 'win32' ? 'C:\\Users\\you\\repos' : '~/repos'}
        spellCheck={false}
        autoFocus
        className="h-8 w-full rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-[12.5px] outline-none focus:border-accent"
      />
    </Dialog>
  )
}

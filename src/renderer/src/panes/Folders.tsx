import { useEffect, useState } from 'react'
import { addRoot, browseRoot, openAddFolder, useStore } from '../store.ts'
import { Button, Dialog } from '../lib/ui.tsx'
import { FolderOpen } from 'lucide-react'

/**
 * Add a workspace folder. The native folder picker (Fase 5.2) does the normal
 * work: pick a folder, it is added at once. Typing or pasting a path stays as
 * the compact alternative for network shares or WSL locations the dialog
 * cannot reach comfortably.
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

  // the OS folder picker: the folder is added (and this dialog closed) in one go
  const browse = async () => {
    setBusy(true)
    const ok = await browseRoot() // false on cancel; failures surface as a toast
    setBusy(false)
    if (ok) close()
  }

  // the typed path, kept for network / WSL locations
  const add = async () => {
    setBusy(true)
    const ok = await addRoot(target)
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
          <Button variant="secondary" disabled={busy} onClick={browse}>
            <FolderOpen size={13} /> Browse…
          </Button>
          <Button variant="primary" disabled={!target || busy} onClick={add}>
            Add this folder
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">
        Enter the folder that holds your repos (or a single repo). OpenSpecControl lists every git
        or OpenSpec repo up to 4 levels inside it. Prefer the system folder picker; the written path
        stays for network shares or WSL (~ works).
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

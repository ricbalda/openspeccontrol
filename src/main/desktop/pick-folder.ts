// Fase 5.1: the native folder picker that replaces Studio's web-based folder
// browser. A modal showOpenDialog on the app's window, then the same
// core.addRoot() the typed path uses — so every validation (folder exists, not
// the whole drive, not a duplicate) keeps working and its message reaches the
// renderer as a toast through the usual error envelope.

import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { Workspace } from '@shared/protocol.ts'
import type { OscCore } from '../core/osc-core.ts'

/** The minimal window showOpenDialog needs (tests fake it; null = no parent). */
export type DialogParent = BrowserWindow | null

/**
 * Open the OS folder picker and add the chosen folder as a workspace root.
 * Returns the refreshed Workspace, or null when the user cancelled the dialog.
 * Throws OscError('invalid', …) when addRoot rejects the choice (e.g. the
 * drive root, or a folder that disappeared between picking and adding).
 */
export async function pickFolder(core: OscCore, parent: DialogParent): Promise<Workspace | null> {
  const opts: OpenDialogOptions = {
    title: 'Add a folder',
    buttonLabel: 'Add folder',
    properties: ['openDirectory', 'createDirectory']
  }
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts) // no window yet: still usable, just not modal
  const picked = r.canceled ? null : r.filePaths[0]
  if (!picked) return null // cancelled: the renderer keeps its dialog open
  return core.addRoot({ path: picked })
}

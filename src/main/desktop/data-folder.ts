// Fase 5.8: "Abrir carpeta de datos" and "Mostrar en el explorador". Data
// actions the menu (Fase 4) and the repo header call; both go through the
// core's own validation — only added repos can be revealed, never an
// arbitrary path the renderer sends.

import { shell } from 'electron'
import { dataDir } from '../core/repos.ts'
import { repoPath } from '../core/workspace.ts'
import { OscError } from '../core/errors.ts'

/**
 * Open the data folder (~/.openspeccontrol) in the OS file manager. Fase 4
 * wires this as Ayuda → Abrir carpeta de datos.
 */
export async function openDataFolder(): Promise<void> {
  const err = await shell.openPath(dataDir())
  if (err) throw new OscError('internal', `could not open the data folder: ${err}`)
}

/**
 * Reveal an added repo in the OS file manager (the repo header button). Only
 * repo ids the workspace knows are accepted; anything else is not_found.
 */
export function showRepoInExplorer(repo: string): void {
  const abs = repoPath(repo)
  if (!abs) throw new OscError('not_found', 'repo not found')
  shell.showItemInFolder(abs)
}

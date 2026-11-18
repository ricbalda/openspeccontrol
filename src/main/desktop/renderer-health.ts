// desktop/renderer-health.ts (Fase 4, tarea 4.7): a renderer that dies or
// hangs is recoverable — all state lives in the main process, so reloading
// resubscribes and gets the session replay back. The reason is logged and the
// user is offered the reload ("Cerrar" goes through the safe close of 4.4).

import { dialog } from 'electron'

/** The slice of Electron's RenderProcessGoneDetails the message needs. */
export interface GoneDetails {
  reason: string
  exitCode: number
}

/**
 * The slice of BrowserWindow this module talks to (tests fake it; the real
 * one satisfies it structurally).
 */
export interface HealthWindow {
  isDestroyed(): boolean
  close(): void
  webContents: {
    on(event: string, listener: (...args: never[]) => void): unknown
    reload(): void
  }
}

/** One line naming the reason, for the log and the dialog. */
export function goneMessage(d: GoneDetails): string {
  return `El proceso de la interfaz terminó (${d.reason}, código ${d.exitCode}).`
}

/** Register the crash / hang handlers on a window (index.ts calls it right after creating it). */
export function attachRendererHealth(win: HealthWindow): void {
  win.webContents.on('render-process-gone', (_e: unknown, details: GoneDetails): void => {
    console.error(goneMessage(details))
    void offerReload(win, goneMessage(details))
  })
  win.webContents.on('unresponsive', (_e: unknown): void => {
    console.warn('El proceso de la interfaz no responde.')
    void offerReload(win, 'El proceso de la interfaz no responde.')
  })
}

async function offerReload(win: HealthWindow, cause: string): Promise<void> {
  if (win.isDestroyed()) return
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Recargar OpenSpecControl',
    message: '¿Recargar la ventana?',
    detail: `${cause}\nEl estado está a salvo: al recargar, la sesión y su transcript se recuperan.`,
    buttons: ['Recargar', 'Cerrar'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  // el diálogo es async: la ventana pudo morir mientras tanto
  if (win.isDestroyed()) return
  if (response === 0) win.webContents.reload()
  else win.close()
}

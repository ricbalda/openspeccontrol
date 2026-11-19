// Fase 5.3: OS notifications. Studio asked the browser for permission and used
// window.Notification; the desktop app owns the OS notification directly. The
// main process only shows one while the window is unfocused (a focused window
// already shows everything in-app), a click restores and focuses the window,
// and `attention` also flashes the taskbar entry until the user comes back.

import { Notification } from 'electron'
import type { NotifyInput } from '@shared/ipc.ts'

/** The slice of a BrowserWindow notifications need (tests fake it). */
export interface NotifyWindow {
  isFocused(): boolean
  isDestroyed(): boolean
  show(): void
  focus(): void
  flashFrame(flash: boolean): void
  once(event: 'focus', listener: () => void): void
}

// one focus listener clears the flash; don't stack one per notification
const flashing = new WeakSet<NotifyWindow>()

/**
 * Show a notification for an unfocused window. Synchronous on purpose: the IPC
 * handler answers immediately and the notification keeps living in the OS.
 */
export function showAppNotification(n: NotifyInput, win: NotifyWindow | null): void {
  if (win?.isFocused()) return // the user is looking at the app: no toast needed
  if (win && n.kind === 'attention' && !flashing.has(win)) {
    win.flashFrame(true)
    flashing.add(win)
    win.once('focus', () => {
      flashing.delete(win)
      win.flashFrame(false)
    })
  }
  if (!Notification.isSupported()) return
  const note = new Notification({ title: n.title, body: n.body ?? '' })
  note.on('click', () => {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })
  note.show()
}

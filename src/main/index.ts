import { app, BrowserWindow, nativeTheme, screen, session } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { SERVER_MSG_CHANNEL } from '@shared/ipc.ts'
import type { ServerMsg } from '@shared/protocol.ts'
import { createOscCore, type OscCore } from './core/osc-core.ts'
import { registerIpc, type IpcBridge } from './ipc.ts'
import { registerNativeIpc } from './desktop/ipc-native.ts'
import { trackPendingInteractions } from './desktop/badge.ts'
import { APP_NAME, APP_USER_MODEL_ID, installAppMenu } from './desktop/menu.ts'
import { confirmQuit, liveWork } from './desktop/safe-close.ts'
import { registerUpdater } from './desktop/updater-ipc.ts'
import { attachRendererHealth } from './desktop/renderer-health.ts'
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  readWindowState,
  restoreWindowOptions,
  saveWindowState,
  windowStateFile
} from './desktop/window-state.ts'
import { ensureShellEnv } from './desktop/shell-env.ts'
import {
  applySessionSecurity,
  applyWindowSecurity,
  secureWebPreferences
} from './desktop/security.ts'

// Fase 2: the core is created at startup (data dir, Studio import, db) and shut
// down on quit (agents, watchers, WAL checkpoint). Fase 3 registers the IPC
// bridge. Fase 4: single instance, window state, safe close, menu, renderer
// health and the app identity. Fase 5: native integrations (folder picker,
// notifications, badge, links, theme). Fase 6/7: login-shell env and hardening
// before any child process or window exists.

let core: OscCore | null = null
let bridge: IpcBridge | null = null
let mainWindow: BrowserWindow | null = null
/** set once the quit was confirmed: close/before-quit must not ask twice (4.4) */
let quitting = false

/** Menu actions reach the renderer on the same channel the core broadcasts on (4.6). */
const sendToRenderer = (m: ServerMsg): void => {
  const wc = mainWindow?.webContents
  if (wc && !wc.isDestroyed()) wc.send(SERVER_MSG_CHANNEL, m)
}

function createWindow(): void {
  // Fase 4.2: restore size/position only when they fit a display that exists
  const saved = readWindowState(windowStateFile())
  const options = restoreWindowOptions(
    saved,
    screen.getAllDisplays().map((d) => ({ workArea: d.workArea }))
  )
  mainWindow = new BrowserWindow({
    width: options.width,
    height: options.height,
    ...(options.x !== undefined && options.y !== undefined ? { x: options.x, y: options.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // 4.3: no white flash — the window paints the app's own background (index.css --bg)
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111114' : '#f7f7f8',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      ...secureWebPreferences,
      preload: join(import.meta.dirname, '../preload/index.cjs')
    }
  })
  if (saved?.maximized) mainWindow.maximize()

  // Fase 7: no webview, no window.open, no navigation away from the app page
  applyWindowSecurity(mainWindow.webContents)
  // the bridge only trusts this window, and drops its subscriptions on
  // reload / destroy / renderer crash (the core then stops idle watchers)
  bridge?.attachWindow(mainWindow)
  // 4.7: log renderer crashes/hangs and offer the reload that replays the session
  attachRendererHealth(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('close', (e) => {
    // remember the bounds before the window goes away (normal bounds: unmaximize target)
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow, windowStateFile())
    // macOS: closing the window keeps the app (and the agents) alive; the
    // safe-close question happens in before-quit (Cmd+Q / menú Salir)
    if (quitting || process.platform === 'darwin') return
    e.preventDefault()
    void requestQuit()
  })

  // Load the remote URL for development or the local html file for production.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

/**
 * Fase 4.4: confirm when an agent is working or decisions are pending, then
 * quit; will-quit runs core.shutdown() + app.exit(0), so no agent tree survives.
 */
async function requestQuit(): Promise<void> {
  if (quitting) return
  const work = liveWork(core?.sessionStates() ?? [])
  if (work.length > 0 && !(await confirmQuit(work))) return // Cancelar: everything stays
  quitting = true
  app.quit()
}

// Fase 4.1: one instance per user — a second open only focuses this window
// (two would fight over the same SQLite db and the same agent sessions).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // Fase 4.8: identity before ready — app.name feeds the macOS menus and the
  // AppUserModelId groups taskbar pins and notifications on Windows (no-op elsewhere).
  app.setName(APP_NAME)
  app.setAppUserModelId(APP_USER_MODEL_ID)

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    // Fase 6: on macOS/Linux the dock/launcher PATH misses nvm/volta/homebrew;
    // merge the login shell's env before any child process is spawned (no-op on
    // Windows, where the process inherits the user's PATH)
    await ensureShellEnv()
    // Fase 7: deny-by-default permissions for the session the window uses
    applySessionSecurity(session.defaultSession)
    core = createOscCore({ version: app.getVersion() })
    bridge = registerIpc({ core, window: () => mainWindow })
    // Fase 5: the native-integration channels and the pending-decisions badge
    registerNativeIpc({ core, win: () => mainWindow })
    trackPendingInteractions({ core, getWin: () => mainWindow })
    installAppMenu(sendToRenderer) // Fase 4.6 (also removes autoHideMenuBar)
    // Fase 9: auto-update (disabled when unpackaged or OSC_NO_UPDATE_CHECK=1); the install quit is pre-confirmed
    registerUpdater({
      core,
      win: () => mainWindow,
      send: sendToRenderer,
      beforeInstall: () => {
        quitting = true
      }
    }).start()
    createWindow()

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open; the
      // page re-subscribes and the core answers with the replay (4.5)
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q. Windows/Linux already confirmed in close (4.4/4.5).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Fase 4.4: quit attempts (Cmd+Q, menú Salir, cierre de sesión) ask first
  // when there is live work; a confirmed quit flows on to will-quit below.
  app.on('before-quit', (e) => {
    if (quitting || !core) return
    if (liveWork(core.sessionStates()).length === 0) return
    e.preventDefault()
    void requestQuit()
  })

  // Stop agents and watchers, checkpoint the db, then really exit.
  app.on('will-quit', (e) => {
    if (!core) return
    e.preventDefault()
    const c = core
    core = null
    c.shutdown()
      .catch(() => {}) // the app must be able to exit even if cleanup fails
      .finally(() => app.exit(0))
  })
}

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { createOscCore, type OscCore } from './core/osc-core.ts'
import { registerIpc, type IpcBridge } from './ipc.ts'
import { registerNativeIpc } from './desktop/ipc-native.ts'
import { installLinkGuard } from './desktop/external-links.ts'
import { trackPendingInteractions } from './desktop/badge.ts'

// Fase 2: the core is created at startup (data dir, Studio import, db) and shut
// down on quit (agents, watchers, WAL checkpoint). Fase 3 registers the IPC
// bridge; Fase 5 adds the native integrations (folder picker, notifications,
// badge, links, theme) and window/menu polish (single instance, safe close)
// arrives with Fase 4.

let core: OscCore | null = null
let bridge: IpcBridge | null = null
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true
    }
  })
  // the bridge only trusts this window, and drops its subscriptions on
  // reload / destroy / renderer crash (the core then stops idle watchers)
  bridge?.attachWindow(mainWindow)
  // links never navigate the window: they open in the OS browser or nothing
  installLinkGuard(mainWindow.webContents)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  // Load the remote URL for development or the local html file for production.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  core = createOscCore({ version: app.getVersion() })
  bridge = registerIpc({ core, window: () => mainWindow })
  // Fase 5: the native-integration channels and the pending-decisions badge
  registerNativeIpc({ core, win: () => mainWindow })
  trackPendingInteractions({ core, getWin: () => mainWindow })
  createWindow()

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
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

// desktop/menu.ts (Fase 4, tarea 4.6): the application menu — Archivo, Editar
// (roles: without them Cmd/Ctrl+C, V, X… do nothing in inputs, above all on
// macOS), Ver (DevTools only when unpackaged), Ventana and Ayuda. Actions the
// renderer must react to travel as ServerMsg { type: 'menu', action }.
//
// Ayuda placeholders — do NOT implement them here: Fase 5 wires 'demo-repo'
// (tarea 5.7) and 'open-data-folder' (tarea 5.8), Fase 6
// 'dependency-diagnostics' (tarea 6.4) and Fase 9 'check-updates' (tarea 9.4).
// Each phase replaces the dispatch in store.ts menuAction(); this menu only
// emits the action id.

import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction, ServerMsg } from '@shared/protocol.ts'

export const APP_NAME = 'OpenSpecControl'
/** The appId electron-builder signs with (tarea 8.2); Windows notifications/taskbar need it. */
export const APP_USER_MODEL_ID = 'io.github.ricbalda.openspeccontrol'
export const REPO_URL = 'https://github.com/ricbalda/openspeccontrol'

/** Where menu clicks land: the main window, on the 'osc:server-msg' channel. */
export type MenuSender = (m: ServerMsg) => void

/** The template (exported for tests); `mac` defaults to the current platform. */
export function buildMenu(opts: {
  packaged: boolean
  send: MenuSender
  mac?: boolean
}): MenuItemConstructorOptions[] {
  const mac = opts.mac ?? process.platform === 'darwin'
  const emit = (action: MenuAction) => (): void => {
    opts.send({ type: 'menu', action })
  }

  const fileSubmenu: MenuItemConstructorOptions[] = [
    { label: 'Añadir carpeta…', accelerator: 'CmdOrCtrl+O', click: emit('add-folder') },
    {
      label: 'Volver a escanear repos',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: emit('rescan-repos')
    },
    { type: 'separator' },
    // role quit: app.quit(), que pasa por el cierre seguro de la tarea 4.4
    { role: 'quit', label: mac ? `Salir de ${APP_NAME}` : 'Salir' }
  ]

  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: 'undo', label: 'Deshacer' },
    { role: 'redo', label: 'Rehacer' },
    { type: 'separator' },
    { role: 'cut', label: 'Cortar' },
    { role: 'copy', label: 'Copiar' },
    { role: 'paste', label: 'Pegar' },
    { role: 'selectAll', label: 'Seleccionar todo' }
  ]

  const viewSubmenu: MenuItemConstructorOptions[] = [{ role: 'reload', label: 'Recargar' }]
  if (!opts.packaged) {
    // una build empaquetada no ofrece DevTools (spec desktop-shell)
    viewSubmenu.push({ role: 'toggleDevTools', label: 'Herramientas de desarrollo' })
  }
  viewSubmenu.push(
    { type: 'separator' },
    { role: 'resetZoom', label: 'Tamaño real' },
    { role: 'zoomIn', label: 'Acercar' },
    { role: 'zoomOut', label: 'Alejar' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Pantalla completa' }
  )

  const windowSubmenu: MenuItemConstructorOptions[] = [
    { role: 'minimize', label: 'Minimizar' },
    { role: 'zoom', label: 'Zoom' }
  ]
  if (mac) windowSubmenu.push({ role: 'front', label: 'Traer todo al frente' })
  windowSubmenu.push({ type: 'separator' }, { role: 'close', label: 'Cerrar' })

  const helpSubmenu: MenuItemConstructorOptions[] = [
    // Fase 5 · tarea 5.7: portar scripts/demo-repo.mjs a desktop/demo-repo.ts
    { label: 'Crear repositorio de demostración…', click: emit('demo-repo') },
    // Fase 6 · tarea 6.4: tabla de herramientas (desktop/tools.ts)
    { label: 'Diagnóstico de dependencias', click: emit('dependency-diagnostics') },
    { type: 'separator' },
    // Fase 5 · tarea 5.8: shell.openPath(DATA_DIR)
    { label: 'Abrir carpeta de datos', click: emit('open-data-folder') },
    // Fase 9 · tarea 9.4: forzar la comprobación de actualizaciones
    { label: 'Buscar actualizaciones…', click: emit('check-updates') },
    { type: 'separator' },
    { label: 'Documentación (GitHub)', click: () => void shell.openExternal(REPO_URL) }
  ]

  const menus: MenuItemConstructorOptions[] = [
    { label: 'Archivo', submenu: fileSubmenu },
    { label: 'Editar', submenu: editSubmenu },
    { label: 'Ver', submenu: viewSubmenu },
    { label: 'Ventana', submenu: windowSubmenu },
    { label: 'Ayuda', submenu: helpSubmenu }
  ]
  if (!mac) return menus
  // macOS: el primer menú es el de la app (Acerca de, Servicios, Ocultar…, Salir)
  return [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `Acerca de ${APP_NAME}` },
        { type: 'separator' },
        { role: 'services', label: 'Servicios' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar otras' },
        { role: 'unhide', label: 'Mostrar todas' },
        { type: 'separator' },
        { role: 'quit', label: `Salir de ${APP_NAME}` }
      ]
    },
    ...menus
  ]
}

/** Build the menu for this run and install it as the application menu. */
export function installAppMenu(send: MenuSender): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenu({ packaged: app.isPackaged, send })))
}

// menu (tarea 4.6): Archivo/Editar/Ver/Ventana/Ayuda, roles de edición para
// que Cmd/Ctrl+C… funcionen en los inputs, sin DevTools cuando está
// empaquetada, y cada acción del renderer emitida como ServerMsg { type:
// 'menu' }. Electron (app/Menu/shell) se simula.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuAction, ServerMsg } from '@shared/protocol.ts'
const mock = vi.hoisted(() => ({
  sent: [] as ServerMsg[],
  template: null as unknown,
  appMenu: null as unknown,
  externals: [] as string[],
  packaged: false
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mock.packaged
    }
  },
  Menu: {
    buildFromTemplate: (t: unknown) => {
      mock.template = t
      return { template: t }
    },
    setApplicationMenu: (m: unknown) => {
      mock.appMenu = m
    }
  },
  shell: {
    openExternal: (u: string) => {
      mock.externals.push(u)
      return Promise.resolve()
    }
  }
}))

import {
  APP_NAME,
  APP_USER_MODEL_ID,
  buildMenu,
  installAppMenu,
  REPO_URL
} from '../../src/main/desktop/menu.ts'

const send = (m: ServerMsg): void => {
  mock.sent.push(m)
}
const menu = () => buildMenu({ packaged: false, send, mac: false })
// the template is typed for Electron; tests walk it as data
const top = (m?: unknown) => m as { label: string; role?: string; submenu: Item[] }[]
type Item = {
  label?: string
  role?: string
  accelerator?: string
  click?: () => void
  submenu?: Item[]
}
const item = (m: unknown, label: string): Item | undefined => top(m).find((x) => x.label === label)
const sub = (m: unknown, label: string): Item[] => item(m, label)!.submenu!

describe('la plantilla (tarea 4.6)', () => {
  beforeEach(() => {
    mock.sent.length = 0
    mock.externals.length = 0
  })

  it('Archivo, Editar, Ver, Ventana y Ayuda', () => {
    expect(top(menu()).map((x) => x.label)).toEqual([
      'Archivo',
      'Editar',
      'Ver',
      'Ventana',
      'Ayuda'
    ])
  })

  it('Editar trae los roles undo/redo/cut/copy/paste/selectAll (Cmd/Ctrl+C y V en inputs)', () => {
    const roles = sub(menu(), 'Editar').map((x) => x.role)
    for (const r of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
      expect(roles).toContain(r)
  })

  it('Ver: Recargar, zoom y pantalla completa; DevTools solo sin empaquetar', () => {
    const dev = sub(buildMenu({ packaged: false, send, mac: false }), 'Ver').map((x) => x.role)
    const prod = sub(buildMenu({ packaged: true, send, mac: false }), 'Ver').map((x) => x.role)
    expect(dev).toContain('reload')
    expect(dev).toContain('toggleDevTools')
    expect(dev).toContain('resetZoom')
    expect(dev).toContain('togglefullscreen')
    expect(prod).not.toContain('toggleDevTools')
  })

  it('Ventana: minimizar, zoom y cerrar', () => {
    const roles = sub(menu(), 'Ventana').map((x) => x.role)
    expect(roles).toEqual(expect.arrayContaining(['minimize', 'zoom', 'close']))
  })

  it('Archivo: Salir usa role quit (pasa por el cierre seguro 4.4)', () => {
    expect(sub(menu(), 'Archivo').some((x) => x.role === 'quit')).toBe(true)
  })
})

describe('acciones del menú → renderer (tarea 4.6)', () => {
  beforeEach(() => {
    mock.sent.length = 0
  })

  it('Archivo → Añadir carpeta… llega como ServerMsg menu add-folder', () => {
    item(sub(menu(), 'Archivo'), 'Añadir carpeta…')!.click!()
    expect(mock.sent).toEqual([{ type: 'menu', action: 'add-folder' as MenuAction }])
  })

  it('Archivo → Volver a escanear repos llega como menu rescan-repos', () => {
    item(sub(menu(), 'Archivo'), 'Volver a escanear repos')!.click!()
    expect(mock.sent).toEqual([{ type: 'menu', action: 'rescan-repos' as MenuAction }])
  })

  it('Ayuda: los marcadores de Fases 5/6/9 emiten su acción sin implementarla', () => {
    const help = sub(menu(), 'Ayuda')
    // Fase 5 · tarea 5.7
    item(help, 'Crear repositorio de demostración…')!.click!()
    // Fase 6 · tarea 6.4
    item(help, 'Diagnóstico de dependencias')!.click!()
    // Fase 5 · tarea 5.8
    item(help, 'Abrir carpeta de datos')!.click!()
    // Fase 9 · tarea 9.4
    item(help, 'Buscar actualizaciones…')!.click!()
    expect(mock.sent).toEqual([
      { type: 'menu', action: 'demo-repo' },
      { type: 'menu', action: 'dependency-diagnostics' },
      { type: 'menu', action: 'open-data-folder' },
      { type: 'menu', action: 'check-updates' }
    ])
  })

  it('Ayuda → Documentación abre el repo en el navegador del sistema', () => {
    item(sub(menu(), 'Ayuda'), 'Documentación (GitHub)')!.click!()
    expect(mock.externals).toEqual([REPO_URL])
  })
})

describe('macOS', () => {
  it('el primer menú es el de la app, con Acerca de y Salir', () => {
    const m = buildMenu({ packaged: true, send, mac: true })
    expect(top(m).map((x) => x.label)).toEqual([
      APP_NAME,
      'Archivo',
      'Editar',
      'Ver',
      'Ventana',
      'Ayuda'
    ])
    const roles = top(m)[0].submenu!.map((x) => x.role)
    expect(roles).toEqual(
      expect.arrayContaining(['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit'])
    )
  })

  it('Traer todo al frente solo en macOS', () => {
    expect(
      sub(buildMenu({ packaged: true, send, mac: true }), 'Ventana').some((x) => x.role === 'front')
    ).toBe(true)
    expect(
      sub(buildMenu({ packaged: true, send, mac: false }), 'Ventana').some(
        (x) => x.role === 'front'
      )
    ).toBe(false)
  })
})

describe('installAppMenu', () => {
  it('construye con app.isPackaged y registra el menú de aplicación', () => {
    mock.packaged = true
    try {
      installAppMenu(send)
      expect(mock.template).toBeTruthy()
      expect(mock.appMenu).toEqual({ template: mock.template })
      // la plantilla instalada es la empaquetada: sin DevTools
      const view = sub(mock.template, 'Ver').map((x) => x.role)
      expect(view).not.toContain('toggleDevTools')
    } finally {
      mock.packaged = false
    }
  })
})

describe('identidad (tarea 4.8)', () => {
  it('el AppUserModelId coincide con el appId de electron-builder', () => {
    expect(APP_USER_MODEL_ID).toBe('io.github.ricbalda.openspeccontrol')
    expect(APP_NAME).toBe('OpenSpecControl')
  })
})

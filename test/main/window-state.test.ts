// window-state (tarea 4.2): restore only what fits — the position inside a
// display that still exists, the size clamped to [1024×640, largest work
// area] — and persist the normal bounds on close. Pure Node: displays and
// the window are fakes (screen.getAllDisplays stays in index.ts).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  insideAnyWorkArea,
  readWindowState,
  restoreWindowOptions,
  saveWindowState,
  windowStateFile,
  type DisplayLike,
  type StateWindow,
  type WindowState
} from '../../src/main/desktop/window-state.ts'

const file = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wstate-')), 'window-state.json')

const display = (x: number, y: number, w: number, h: number): DisplayLike => ({
  workArea: { x, y, width: w, height: h }
})
// a 1920×1080 monitor with its work area, and the same plus a 1280×960 second one
const DESKTOP = [display(0, 0, 1920, 1040)]
const TWO = [display(0, 0, 1920, 1040), display(1920, 0, 1280, 960)]

const saved = (o: Partial<WindowState> = {}): WindowState => ({
  width: 1400,
  height: 900,
  x: 100,
  y: 60,
  maximized: false,
  ...o
})

describe('restore (tarea 4.2)', () => {
  it('sin estado guardado: los valores por defecto, centrada por Electron', () => {
    expect(restoreWindowOptions(null, DESKTOP)).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT
    })
  })

  it('restaura tamaño y posición cuando caben en el monitor', () => {
    expect(restoreWindowOptions(saved(), DESKTOP)).toEqual({
      width: 1400,
      height: 900,
      x: 100,
      y: 60
    })
  })

  it('restaura una ventana guardada en el segundo monitor que sigue conectado', () => {
    // 1200×900 en x=1950: cabe completa en el segundo monitor (1920..3200 × 0..960)
    expect(restoreWindowOptions(saved({ x: 1950, y: 40, width: 1200, height: 900 }), TWO)).toEqual({
      width: 1200,
      height: 900,
      x: 1950,
      y: 40
    })
  })

  it('descarta la posición cuando el monitor ya no existe (centrada y completa)', () => {
    // guardada en el segundo monitor, pero ahora solo está DESKTOP
    expect(restoreWindowOptions(saved({ x: 2100, y: 40 }), DESKTOP)).toEqual({
      width: 1400,
      height: 900
    }) // sin x/y: Electron la centra
  })

  it('descarta una posición que quedaría a medias en un monitor más pequeño', () => {
    expect(restoreWindowOptions(saved({ x: 1500, y: 0 }), DESKTOP).x).toBeUndefined()
  })

  it('no baja del mínimo 1024×640 (los breakpoints de index.css)', () => {
    expect(restoreWindowOptions(saved({ width: 800, height: 500 }), DESKTOP)).toEqual({
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
      x: 100,
      y: 60
    })
  })

  it('encoge un tamaño que ya no cabe en ningún área de trabajo', () => {
    expect(
      restoreWindowOptions(saved({ width: 2200, height: 1000 }), [display(0, 0, 1280, 720)])
    ).toEqual({ width: 1280, height: 720 })
  })
})

describe('readWindowState', () => {
  it('tolera un archivo corrupto o ausente restaurando nada', () => {
    const corrupt = file()
    fs.writeFileSync(corrupt, '{oops')
    expect(readWindowState(corrupt)).toBeNull()
    expect(readWindowState(path.join(os.tmpdir(), `nope-${Date.now()}.json`))).toBeNull()
  })

  it('rechaza un estado parcial o no numérico', () => {
    const partial = file()
    fs.writeFileSync(partial, JSON.stringify({ width: 1200, y: 10, maximized: true }))
    expect(readWindowState(partial)).toBeNull()
  })

  it('el archivo vive en el directorio de datos', () => {
    expect(path.basename(windowStateFile())).toBe('window-state.json')
  })
})

describe('insideAnyWorkArea', () => {
  it('solo si cabe completa dentro de un área de trabajo', () => {
    expect(insideAnyWorkArea(saved(), DESKTOP)).toBe(true)
    expect(insideAnyWorkArea(saved({ x: 600 }), DESKTOP)).toBe(false) // cruza el borde derecho
    expect(insideAnyWorkArea(saved({ x: -200, y: -100 }), DESKTOP)).toBe(false)
    expect(insideAnyWorkArea(saved({ x: -200, y: -100 }), TWO)).toBe(false)
  })
})

describe('saveWindowState (tarea 4.2)', () => {
  const win = (b: {
    x: number
    y: number
    width: number
    height: number
    maximized?: boolean
  }): StateWindow => ({
    getNormalBounds: () => ({ x: b.x, y: b.y, width: b.width, height: b.height }),
    isMaximized: () => !!b.maximized
  })

  it('guarda los bounds normales y el estado maximizado', () => {
    const f = file()
    saveWindowState(win({ x: 12, y: 34, width: 1200.6, height: 700.2 }), f)
    expect(readWindowState(f)).toEqual({
      width: 1201,
      height: 700,
      x: 12,
      y: 34,
      maximized: false
    })
  })

  it('maximizada guarda los bounds normales (a donde vuelve al restaurar)', () => {
    const f = file()
    saveWindowState(win({ x: 0, y: 0, width: 1920, height: 1040, maximized: true }), f)
    const s = readWindowState(f)!
    expect(s.maximized).toBe(true)
    expect(restoreWindowOptions(s, DESKTOP)).toEqual({ width: 1920, height: 1040, x: 0, y: 0 })
  })

  it('un guardar→leer→restaurar respeta el mínimo y el monitor', () => {
    const f = file()
    saveWindowState(win({ x: 1920, y: 0, width: 1000, height: 620 }), f) // más pequeña que el mínimo
    expect(restoreWindowOptions(readWindowState(f), TWO)).toEqual({
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
      x: 1920,
      y: 0
    })
  })

  it('no rompe al cerrar aunque el destino no se pueda escribir', () => {
    const blocker = file()
    fs.writeFileSync(blocker, 'x') // un archivo donde iría el directorio
    expect(() =>
      saveWindowState(win({ x: 0, y: 0, width: 1200, height: 800 }), path.join(blocker, 'w.json'))
    ).not.toThrow()
  })
})

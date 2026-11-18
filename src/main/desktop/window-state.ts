// desktop/window-state.ts (Fase 4, tarea 4.2): remembers size, position and
// maximized state across launches in <data dir>/window-state.json. The
// position is restored only when the whole window fits a display that still
// exists (screen.getAllDisplays); otherwise Electron centers it. The size
// never goes below 1024×640 (the smallest breakpoint of index.css) nor above
// the largest available work area. Electron-free, so plain Node tests cover it.

import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../core/repos.ts'

export const MIN_WIDTH = 1024
export const MIN_HEIGHT = 640
export const DEFAULT_WIDTH = 1280
export const DEFAULT_HEIGHT = 800

export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  maximized: boolean
}

/** A rectangle: a Display's workArea, or the window's normal bounds. */
export interface Area {
  x: number
  y: number
  width: number
  height: number
}

/** The slice of Electron's Display this module needs (tests fake it). */
export interface DisplayLike {
  workArea: Area
}

export const windowStateFile = (): string => path.join(dataDir(), 'window-state.json')

/** Read the saved state; null when missing, corrupt or incomplete. */
export function readWindowState(file: string): WindowState | null {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as Record<string, unknown>
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const width = n(s.width)
  const height = n(s.height)
  const x = n(s.x)
  const y = n(s.y)
  if (width === null || height === null || x === null || y === null) return null
  return { width, height, x, y, maximized: s.maximized === true }
}

/** The largest work area, to cap a size that no longer fits any monitor. */
const widest = (displays: DisplayLike[]): Area | null =>
  displays.reduce<Area | null>(
    (best, d) =>
      !best || d.workArea.width * d.workArea.height > best.width * best.height ? d.workArea : best,
    null
  )

/** True when the whole window fits inside one existing display's work area. */
export function insideAnyWorkArea(s: WindowState, displays: DisplayLike[]): boolean {
  return displays.some((d) => {
    const a = d.workArea
    return (
      s.x >= a.x && s.y >= a.y && s.x + s.width <= a.x + a.width && s.y + s.height <= a.y + a.height
    )
  })
}

/**
 * What createWindow passes to BrowserWindow: the saved size clamped to
 * [minimum, largest work area] and the position only when it fits a display
 * that still exists (no x/y means Electron centers the window on the primary).
 */
export function restoreWindowOptions(
  saved: WindowState | null,
  displays: DisplayLike[]
): { width: number; height: number; x?: number; y?: number } {
  if (!saved) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  const max = widest(displays)
  const clamp = (v: number, min: number, hi: number): number =>
    Math.min(Math.max(v, min), Math.max(hi, min))
  const width = clamp(saved.width, MIN_WIDTH, max ? max.width : saved.width)
  const height = clamp(saved.height, MIN_HEIGHT, max ? max.height : saved.height)
  if (!insideAnyWorkArea({ ...saved, width, height }, displays)) return { width, height }
  return { width, height, x: saved.x, y: saved.y }
}

/** The slice of BrowserWindow saving needs (tests fake it, index.ts passes the real one). */
export interface StateWindow {
  getNormalBounds(): Area
  isMaximized(): boolean
}

/** Persist the window's size and position (normal bounds: where unmaximizing returns to). */
export function saveWindowState(win: StateWindow, file: string): void {
  const b = win.getNormalBounds()
  const state: WindowState = {
    width: Math.round(b.width),
    height: Math.round(b.height),
    x: Math.round(b.x),
    y: Math.round(b.y),
    maximized: win.isMaximized()
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state))
  } catch (e) {
    // a read-only data dir must never break closing
    console.warn('could not save window state:', (e as Error).message)
  }
}

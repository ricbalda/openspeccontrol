// Actualización automática (Fase 9, tareas 9.1 y 9.2): la máquina de estados
// sobre `electron-updater` (releases de GitHub `ricbalda/openspeccontrol`).
//
// Este módulo no importa Electron: recibe el `autoUpdater` y los efectos del
// sistema (empaquetado, temporizador, diálogo de cierre seguro, salida de la
// app) como dependencias, así que la máquina se prueba entera con un updater
// simulado. El cableado real (autoUpdater, ipcMain, diálogo) vive en
// `updater-ipc.ts`.
//
// Reemplaza la comprobación contra el registro npm que heredó Studio: una
// instalación de escritorio se actualiza sola, no con `npm install -g`.
//
// Estados (`UpdateState.status`):
//   disabled     sin empaquetar u OSC_NO_UPDATE_CHECK=1: nunca se consulta nada
//   idle         sin novedades (tras una comprobación: "ya tienes la última versión")
//   checking     consultando el release más reciente
//   available    hay una versión nueva; la descarga arranca sola (autoDownload)
//   downloading  descargando, con `progress` (0-100)
//   downloaded   lista: "Reiniciar para actualizar a x.y.z"
//   error        la comprobación o la descarga falló; no afecta al uso de la app

import type { UpdateState } from '@shared/protocol.ts'
import { OscError } from '../core/errors.ts'
import type { LiveWork } from './safe-close.ts'

/** Cada cuánto se vuelve a comprobar (además de al arrancar). */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** a > b solo para versiones x.y.z estables; una preliminar (x.y.z-…) nunca cuenta como más nueva. */
export function isNewer(a: string, b: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(a)) return false
  const pa = a.split('.').map(Number),
    pb = b
      .split(/[.-]/)
      .slice(0, 3)
      .map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i]
  return false
}

/** OSC_NO_UPDATE_CHECK=1 (también true/yes): sin conexión, redes aisladas. */
export const updateCheckDisabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  /^(1|true|yes)$/i.test(env.OSC_NO_UPDATE_CHECK ?? '')

/** Por qué no se busca nada: `dev` = no empaquetada, `env` = OSC_NO_UPDATE_CHECK. */
export function disabledReason(
  packaged: boolean,
  env: NodeJS.ProcessEnv = process.env
): 'dev' | 'env' | null {
  if (!packaged) return 'dev'
  return updateCheckDisabled(env) ? 'env' : null
}

/** La parte de `electron-updater` (AppUpdater) que usa la máquina; los tests la simulan. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  on(event: string, listener: (arg: any) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterDeps {
  updater: UpdaterLike
  /** versión instalada (app.getVersion()) */
  current: string
  /** app.isPackaged */
  packaged: boolean
  env?: NodeJS.ProcessEnv
  /** cada cambio de estado (el main lo reenvía al renderer como `update_state`) */
  emit: (state: UpdateState) => void
  /** trabajo que un reinicio interrumpiría (busy o decisiones pendientes) */
  liveWork: () => LiveWork[]
  /** la confirmación de cierre seguro; true = reiniciar igual */
  confirmRestart: (work: LiveWork[]) => Promise<boolean>
  /** el cierre que sigue ya está confirmado: close/before-quit no deben preguntar otra vez */
  beforeInstall: () => void
  /** inyectables para los tests (por defecto, los globales) */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  log?: (msg: string, err?: unknown) => void
}

export interface Updater {
  state(): UpdateState
  /** Desactiva o arranca: comprobación inmediata y luego cada 24 h. */
  start(): void
  /** Detiene el temporizador de 24 h. */
  stop(): void
  /**
   * Fuerza una comprobación y responde el estado resultante. Si ya hay una en curso
   * la espera; con la descarga en marcha o terminada responde el estado tal cual.
   */
  check(): Promise<UpdateState>
  /**
   * "Reiniciar para actualizar": con trabajo en curso pide antes la confirmación de
   * cierre seguro; false si el usuario canceló. Falla (conflict) sin descarga lista.
   */
  install(): Promise<boolean>
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { updater, current } = deps
  const log = deps.log ?? ((msg, err) => console.error(msg, err))
  const reason = disabledReason(deps.packaged, deps.env)

  let state: UpdateState =
    reason !== null ? { status: 'disabled', current, reason } : { status: 'idle', current }
  let inflight: Promise<UpdateState> | null = null
  let timer: unknown = null
  /** versión que electron-updater anunció pero la regla de preliminares rechazó */
  let rejected: string | null = null

  const set = (next: UpdateState): void => {
    state = next
    deps.emit(state)
  }

  const errorState = (err: unknown): UpdateState => ({
    status: 'error',
    current,
    error: (err as Error)?.message || String(err)
  })

  if (reason === null) {
    // 9.1: se descarga sola y, si el usuario cierra la app antes de reiniciar, se instala al salir.
    // Una preliminar jamás se ofrece a una estable (sin allowPrerelease ni downgrade).
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = false
    updater.allowDowngrade = false

    updater.on('checking-for-update', () => {
      rejected = null
      set({ status: 'checking', current })
    })
    updater.on('update-available', (info: { version: string }) => {
      if (!isNewer(info.version, current)) {
        // no es una versión estable más nueva (p. ej. 0.1.1-beta.1): ni se ofrece ni se instala al salir
        rejected = info.version
        updater.autoInstallOnAppQuit = false
        set({ status: 'idle', current })
        return
      }
      updater.autoInstallOnAppQuit = true
      set({ status: 'available', current, latest: info.version })
    })
    updater.on('update-not-available', () => {
      set({ status: 'idle', current })
    })
    updater.on('download-progress', (p: { percent: number }) => {
      if (state.status !== 'available' && state.status !== 'downloading') return
      const progress = Math.max(0, Math.min(100, Math.round(p.percent)))
      // electron-updater informa varias veces por segundo: solo se emite si cambia el entero
      if (state.status === 'downloading' && state.progress === progress) return
      set({ status: 'downloading', current, latest: state.latest, progress })
    })
    updater.on('update-downloaded', (info: { version: string }) => {
      if (rejected !== null || !isNewer(info.version, current)) return
      set({ status: 'downloaded', current, latest: info.version })
    })
    updater.on('error', (err: Error) => {
      set(errorState(err))
    })
  }

  const runCheck = (): Promise<UpdateState> => {
    // electron-updater rechaza la promesa y además emite 'error': el segundo no pisa al primero
    const p = updater
      .checkForUpdates()
      .then(() => state)
      .catch((err: unknown) => {
        if (state.status !== 'error') set(errorState(err))
        return state
      })
      .finally(() => {
        if (inflight === p) inflight = null
      })
    return p
  }

  const check = (): Promise<UpdateState> => {
    if (reason !== null) return Promise.resolve(state)
    if (inflight) return inflight
    // descargando o ya descargada: no hay nada que comprobar hasta reiniciar
    if (state.status === 'available' || state.status === 'downloading') {
      return Promise.resolve(state)
    }
    if (state.status === 'downloaded') return Promise.resolve(state)
    inflight = runCheck()
    return inflight
  }

  return {
    state: () => state,

    start() {
      if (reason !== null || timer !== null) return
      void check()
      timer = (deps.setInterval ?? setInterval)(() => void check(), CHECK_INTERVAL_MS)
      // el temporizador de 24 h no debe mantener viva la aplicación
      ;(timer as { unref?: () => void } | null)?.unref?.()
    },

    stop() {
      if (timer === null) return
      ;(deps.clearInterval ?? clearInterval)(timer as never)
      timer = null
    },

    check,

    async install() {
      if (state.status !== 'downloaded') {
        throw new OscError('conflict', 'no hay una actualización descargada que instalar')
      }
      const work = deps.liveWork()
      if (work.length > 0 && !(await deps.confirmRestart(work))) return false // Cancelar: todo sigue
      try {
        deps.beforeInstall()
        // sin ventana del instalador (Windows) y reabre la app al terminar
        updater.quitAndInstall(true, true)
      } catch (err) {
        log('quitAndInstall failed:', err)
        set(errorState(err))
        throw err
      }
      return true
    }
  }
}

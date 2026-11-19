// Fase 9: el cableado de la actualización automática con Electron. La máquina de
// estados (updater.ts) no sabe de Electron; aquí se le dan el `autoUpdater` real,
// `app.isPackaged`, el diálogo de cierre seguro (reutiliza safe-close.ts), el
// reenvío de `update_state` al renderer y los tres canales IPC: `updateState`,
// `checkForUpdates` e `installUpdate` (mismo contrato que el puente de la Fase 3:
// solo el marco principal de confianza, argumentos validados y el sobre { ok, data }).

import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { methodChannel, type IpcResult } from '@shared/ipc.ts'
import type { ServerMsg } from '@shared/protocol.ts'
import { makeTrustedSender } from '../ipc.ts'
import type { OscCore } from '../core/osc-core.ts'
import { OscError } from '../core/errors.ts'
import { liveWork, workDetail, type LiveWork } from './safe-close.ts'
import { createUpdater, type Updater, type UpdaterLike } from './updater.ts'

// electron-updater es CommonJS: en el bundle ESM del main se toma de la exportación por defecto
const { autoUpdater } = electronUpdater

/**
 * La confirmación de cierre seguro aplicada al reinicio para actualizar:
 * Cancelar es el botón por defecto y de escape, así que Enter conserva el trabajo.
 */
export async function confirmRestart(work: LiveWork[]): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Reiniciar para actualizar',
    message: 'Hay trabajo en curso; reiniciar lo detendrá.',
    detail:
      `${workDetail(work)}\n` +
      'Los procesos de los agentes se detendrán y la base de datos se cerrará de forma limpia.',
    buttons: ['Cancelar', 'Reiniciar igual'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}

export function registerUpdater(opts: {
  core: OscCore
  win: () => BrowserWindow | null
  /** hacia el renderer (ServerMsg `update_state`) */
  send: (m: ServerMsg) => void
  /** marca el cierre como ya confirmado: close/before-quit no preguntan una segunda vez */
  beforeInstall: () => void
}): Updater {
  const updater = createUpdater({
    updater: autoUpdater as unknown as UpdaterLike,
    current: app.getVersion(),
    packaged: app.isPackaged,
    emit: (state) => opts.send({ type: 'update_state', state }),
    liveWork: () => liveWork(opts.core.sessionStates()),
    confirmRestart,
    beforeInstall: opts.beforeInstall
  })

  const isTrusted = makeTrustedSender(opts.win)
  const handle = <T>(method: string, fn: () => Promise<T> | T): void => {
    ipcMain.handle(methodChannel(method), async (event): Promise<IpcResult<T>> => {
      if (!isTrusted(event.senderFrame))
        return { ok: false, error: { code: 'invalid', message: 'untrusted sender' } }
      try {
        return { ok: true, data: await fn() }
      } catch (e) {
        if (e instanceof OscError) return { ok: false, error: { code: e.code, message: e.message } }
        console.error(`ipc ${method} failed:`, e)
        return {
          ok: false,
          error: { code: 'internal', message: String((e as Error)?.message || e) }
        }
      }
    })
  }

  handle('updateState', () => updater.state())
  handle('checkForUpdates', () => updater.check())
  handle('installUpdate', async () => ({ installing: await updater.install() }))

  return updater
}

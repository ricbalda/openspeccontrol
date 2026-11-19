// updater (Fase 9, tareas 9.1 a 9.5): la máquina de estados de la actualización
// automática con un `autoUpdater` simulado. Sustituye a updates.test.ts de Studio
// (comprobación contra el registro npm). Cubre: desactivada sin empaquetar o con
// OSC_NO_UPDATE_CHECK, comprobación al arrancar y cada 24 h, el flujo
// checking → available → downloading → downloaded, sin conexión, la regla de
// versión preliminar (isNewer) y el reinicio con la confirmación de cierre seguro.

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../src/shared/protocol.ts'
import {
  CHECK_INTERVAL_MS,
  createUpdater,
  disabledReason,
  isNewer,
  updateCheckDisabled,
  type UpdaterDeps,
  type UpdaterLike
} from '../../src/main/desktop/updater.ts'
import type { LiveWork } from '../../src/main/desktop/safe-close.ts'

/** El autoUpdater de electron-updater: un emisor con las propiedades y llamadas que usa la máquina. */
class FakeAutoUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = true
  allowDowngrade = true
  checkForUpdates = vi.fn(async (): Promise<unknown> => null)
  quitAndInstall = vi.fn()
}

const CURRENT = '0.1.0'
const BUSY: LiveWork[] = [{ repo: '/repos/app', busy: true, pending: 0 }]

function setup(over: Partial<UpdaterDeps> = {}) {
  const au = new FakeAutoUpdater()
  const states: UpdateState[] = []
  const order: string[] = []
  const intervals: { fn: () => void; ms: number; cleared: boolean }[] = []
  const deps: UpdaterDeps = {
    updater: au,
    current: CURRENT,
    packaged: true,
    env: {},
    emit: (s) => states.push(s),
    liveWork: () => [],
    confirmRestart: vi.fn(async () => true),
    beforeInstall: () => order.push('beforeInstall'),
    setInterval: (fn, ms) => {
      const h = { fn, ms, cleared: false }
      intervals.push(h)
      return h
    },
    clearInterval: (h) => {
      ;(h as { cleared: boolean }).cleared = true
    },
    log: () => {},
    ...over
  }
  au.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'))
  const updater = createUpdater(deps)
  return { au, updater, states, order, intervals, deps }
}

/** Lo que electron-updater hace en una comprobación con novedades: anuncia y empieza a descargar. */
const release = (au: FakeAutoUpdater, version: string, percents: number[] = []) => {
  au.checkForUpdates.mockImplementationOnce(async () => {
    au.emit('checking-for-update')
    au.emit('update-available', { version })
    for (const percent of percents) au.emit('download-progress', { percent })
    return null
  })
}
const downloaded = (au: FakeAutoUpdater, version: string) => {
  au.emit('update-downloaded', { version })
}

describe('isNewer: la regla de versión preliminar (9.5)', () => {
  it('compara versiones x.y.z; una preliminar nunca se ofrece', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(false)
    expect(isNewer('0.1.1-test', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(false) // mismo x.y.z: no es una actualización
  })
})

describe('desactivada (9.1)', () => {
  it('sin empaquetar (npm run dev) el estado es disabled/dev y no se consulta nada', async () => {
    const { au, updater, states, intervals } = setup({ packaged: false })
    expect(updater.state()).toEqual({ status: 'disabled', current: CURRENT, reason: 'dev' })
    updater.start()
    expect(await updater.check()).toEqual({ status: 'disabled', current: CURRENT, reason: 'dev' })
    expect(au.checkForUpdates).not.toHaveBeenCalled()
    expect(intervals).toHaveLength(0)
    expect(states).toEqual([])
    // ni siquiera toca la configuración de electron-updater
    expect(au.autoDownload).toBe(false)
    expect(au.autoInstallOnAppQuit).toBe(false)
  })

  it('OSC_NO_UPDATE_CHECK=1 (o true/yes) lo desactiva aunque esté empaquetada', async () => {
    for (const v of ['1', 'true', 'YES']) {
      const { au, updater } = setup({ env: { OSC_NO_UPDATE_CHECK: v } })
      expect(updater.state()).toEqual({ status: 'disabled', current: CURRENT, reason: 'env' })
      updater.start()
      await updater.check()
      expect(au.checkForUpdates).not.toHaveBeenCalled()
    }
    expect(updateCheckDisabled({ OSC_NO_UPDATE_CHECK: '0' })).toBe(false)
    expect(updateCheckDisabled({})).toBe(false)
    expect(disabledReason(true, {})).toBeNull()
    expect(disabledReason(false, { OSC_NO_UPDATE_CHECK: '1' })).toBe('dev')
  })

  it('install() sin descarga lista falla con conflict (también desactivada)', async () => {
    const { updater } = setup({ packaged: false })
    await expect(updater.install()).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('comprobación al arrancar y cada 24 h (9.1)', () => {
  it('configura autoDownload y autoInstallOnAppQuit, y no admite preliminares ni downgrade', () => {
    const { au } = setup()
    expect(au.autoDownload).toBe(true)
    expect(au.autoInstallOnAppQuit).toBe(true)
    expect(au.allowPrerelease).toBe(false)
    expect(au.allowDowngrade).toBe(false)
  })

  it('start() comprueba ya y programa la siguiente cada 24 horas; stop() la cancela', async () => {
    const { au, updater, intervals } = setup()
    updater.start()
    updater.start() // idempotente
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(CHECK_INTERVAL_MS)
    expect(CHECK_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
    await updater.check() // espera la comprobación en curso
    intervals[0].fn()
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2)
    updater.stop()
    expect(intervals[0].cleared).toBe(true)
  })
})

describe('el flujo de una actualización (9.2)', () => {
  it('checking → available → downloading (n %) → downloaded, emitido en cada paso', async () => {
    const { au, updater, states } = setup()
    release(au, '0.1.1', [3.2, 3.4, 40, 99.6])
    const end = await updater.check()
    expect(end).toEqual({
      status: 'downloading',
      current: CURRENT,
      latest: '0.1.1',
      progress: 100
    })
    downloaded(au, '0.1.1')
    expect(updater.state()).toEqual({ status: 'downloaded', current: CURRENT, latest: '0.1.1' })
    // 3.2 y 3.4 redondean a 3: solo se emite una vez por porcentaje entero
    expect(states.map((s) => [s.status, s.progress])).toEqual([
      ['checking', undefined],
      ['available', undefined],
      ['downloading', 3],
      ['downloading', 40],
      ['downloading', 100],
      ['downloaded', undefined]
    ])
    expect(states.every((s) => s.current === CURRENT)).toBe(true)
  })

  it('con la descarga en marcha o terminada no vuelve a consultar', async () => {
    const { au, updater } = setup()
    release(au, '0.1.1', [10])
    await updater.check()
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1)
    downloaded(au, '0.1.1')
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updater.state().status).toBe('downloaded')
  })

  it('"Ya tienes la última versión": sin novedades el estado vuelve a idle', async () => {
    const { au, updater, states } = setup()
    au.checkForUpdates.mockImplementationOnce(async () => {
      au.emit('checking-for-update')
      au.emit('update-not-available', { version: CURRENT })
      return null
    })
    expect(await updater.check()).toEqual({ status: 'idle', current: CURRENT })
    expect(states.map((s) => s.status)).toEqual(['checking', 'idle'])
  })

  it('dos comprobaciones a la vez comparten la misma consulta', async () => {
    const { au, updater } = setup()
    let done!: () => void
    au.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((res) => {
          done = () => {
            au.emit('update-not-available', { version: CURRENT })
            res(null)
          }
        })
    )
    const a = updater.check()
    const b = updater.check()
    expect(a).toBe(b)
    done()
    await Promise.all([a, b])
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('ignora el progreso que llega sin una actualización anunciada', () => {
    const { au, updater, states } = setup()
    au.emit('download-progress', { percent: 50 })
    expect(updater.state().status).toBe('idle')
    expect(states).toEqual([])
  })
})

describe('sin conexión (9.2)', () => {
  it('el error de electron-updater pasa el estado a error y se reintenta después', async () => {
    const { au, updater, states } = setup()
    au.checkForUpdates.mockImplementationOnce(async () => {
      au.emit('checking-for-update')
      const err = new Error('net::ERR_INTERNET_DISCONNECTED')
      au.emit('error', err) // electron-updater emite 'error' y además rechaza la promesa
      throw err
    })
    const s = await updater.check()
    expect(s).toEqual({
      status: 'error',
      current: CURRENT,
      error: 'net::ERR_INTERNET_DISCONNECTED'
    })
    expect(states.map((x) => x.status)).toEqual(['checking', 'error']) // un solo error, no dos

    // la próxima comprobación (a las 24 h o a mano) parte de cero
    au.checkForUpdates.mockImplementationOnce(async () => {
      au.emit('checking-for-update')
      au.emit('update-not-available', { version: CURRENT })
      return null
    })
    expect(await updater.check()).toEqual({ status: 'idle', current: CURRENT })
  })

  it('si la promesa rechaza sin emitir error, también queda en error', async () => {
    const { au, updater } = setup()
    au.checkForUpdates.mockRejectedValueOnce(new Error('boom'))
    expect(await updater.check()).toMatchObject({ status: 'error', error: 'boom' })
  })
})

describe('versión preliminar (9.5)', () => {
  it('0.1.1-beta.1 sobre la 0.1.0 estable: no se ofrece ni se instala al salir', async () => {
    const { au, updater, states } = setup()
    release(au, '0.1.1-beta.1', [50])
    expect(await updater.check()).toEqual({ status: 'idle', current: CURRENT })
    expect(au.autoInstallOnAppQuit).toBe(false)
    // aunque electron-updater la descargue, nada llega al usuario
    au.emit('download-progress', { percent: 100 })
    downloaded(au, '0.1.1-beta.1')
    expect(updater.state().status).toBe('idle')
    expect(states.map((s) => s.status)).toEqual(['checking', 'idle'])
    await expect(updater.install()).rejects.toMatchObject({ code: 'conflict' })
  })

  it('una estable posterior se ofrece con normalidad y reactiva la instalación al salir', async () => {
    const { au, updater } = setup()
    release(au, '0.1.1-beta.1')
    await updater.check()
    expect(au.autoInstallOnAppQuit).toBe(false)
    release(au, '0.1.1')
    await updater.check()
    expect(au.autoInstallOnAppQuit).toBe(true)
    downloaded(au, '0.1.1')
    expect(updater.state()).toEqual({ status: 'downloaded', current: CURRENT, latest: '0.1.1' })
  })

  it('una versión igual a la instalada tampoco se ofrece', async () => {
    const { au, updater } = setup()
    release(au, CURRENT)
    expect((await updater.check()).status).toBe('idle')
  })
})

describe('reiniciar para actualizar con cierre seguro (9.3)', () => {
  const ready = async (over: Partial<UpdaterDeps> = {}) => {
    const s = setup(over)
    release(s.au, '0.1.1', [100])
    await s.updater.check()
    downloaded(s.au, '0.1.1')
    return s
  }

  it('sin trabajo en curso instala directo: beforeInstall y quitAndInstall', async () => {
    const { updater, au, order, deps } = await ready()
    expect(await updater.install()).toBe(true)
    expect(deps.confirmRestart).not.toHaveBeenCalled()
    expect(order).toEqual(['beforeInstall', 'quitAndInstall'])
    expect(au.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('con un agente busy pide la confirmación ANTES de reiniciar', async () => {
    const order: string[] = []
    const { updater, au } = await ready({
      liveWork: () => BUSY,
      confirmRestart: vi.fn(async (w: LiveWork[]) => {
        order.push(`confirm(${w[0].repo})`)
        return true
      }),
      beforeInstall: () => order.push('beforeInstall')
    })
    au.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'))
    expect(await updater.install()).toBe(true)
    expect(order).toEqual(['confirm(/repos/app)', 'beforeInstall', 'quitAndInstall'])
  })

  it('Cancelar deja todo como estaba: no cierra ni instala', async () => {
    const { updater, au, order, deps } = await ready({
      liveWork: () => [{ repo: '/repos/app', busy: false, pending: 2 }],
      confirmRestart: vi.fn(async () => false)
    })
    expect(await updater.install()).toBe(false)
    expect(deps.confirmRestart).toHaveBeenCalledTimes(1)
    expect(au.quitAndInstall).not.toHaveBeenCalled()
    expect(order).toEqual([])
    expect(updater.state().status).toBe('downloaded') // se puede volver a intentar
  })

  it('si quitAndInstall falla, el estado pasa a error y el fallo se propaga', async () => {
    const { updater, au } = await ready()
    au.quitAndInstall.mockImplementation(() => {
      throw new Error('instalador no encontrado')
    })
    await expect(updater.install()).rejects.toThrow('instalador no encontrado')
    expect(updater.state()).toMatchObject({ status: 'error', error: 'instalador no encontrado' })
  })

  it('sin descarga lista no hay nada que instalar', async () => {
    const { updater, au } = setup()
    await expect(updater.install()).rejects.toMatchObject({ code: 'conflict' })
    expect(au.quitAndInstall).not.toHaveBeenCalled()
  })
})

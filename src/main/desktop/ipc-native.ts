// Fase 5: the IPC channels of the native integrations (pickFolder, notify,
// openExternal, setNativeTheme, openDataFolder, showInExplorer). Same contract
// as the Fase 3 bridge — trusted main frame only, zod-validated arguments, the
// { ok, data } / { ok: false, error } envelope — reusing its exported
// makeTrustedSender instead of reopening src/main/ipc.ts.

import { ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { methodChannel, type IpcResult } from '@shared/ipc.ts'
import { makeTrustedSender } from '../ipc.ts'
import type { OscCore } from '../core/osc-core.ts'
import { OscError } from '../core/errors.ts'
import { describeIssues } from '../core/schemas.ts'
import { pickFolder } from './pick-folder.ts'
import { showAppNotification } from './notifications.ts'
import { openExternalLink } from './external-links.ts'
import { applyNativeTheme } from './theme.ts'
import { openDataFolder, showRepoInExplorer } from './data-folder.ts'

const notifyBody = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(1000).optional(),
  kind: z.enum(['info', 'attention']).optional()
})
const themeSetting = z.enum(['light', 'dark', 'system'])
const urlBody = z.string().min(1).max(2000)
const repoBody = z.string().min(1)

/** zod check that fails as code "invalid" (the same shape ipc.ts uses). */
function check<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data)
  if (!r.success) throw new OscError('invalid', `invalid arguments: ${describeIssues(r.error)}`)
  return r.data
}

export function registerNativeIpc(opts: {
  core: OscCore
  /** The app window: the dialog's parent and the notification focus target. */
  win: () => BrowserWindow | null
}): void {
  const { core } = opts
  const isTrusted = makeTrustedSender(opts.win)

  const handle = <T>(method: string, fn: (args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(methodChannel(method), async (event, ...args): Promise<IpcResult<T>> => {
      if (!isTrusted(event.senderFrame))
        return { ok: false, error: { code: 'invalid', message: 'untrusted sender' } }
      try {
        return { ok: true, data: await fn(args) }
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

  handle('pickFolder', () => pickFolder(core, opts.win()))
  handle('notify', (a) => {
    showAppNotification(check(notifyBody, a[0]), opts.win())
    return { ok: true as const }
  })
  handle('openExternal', (a) => openExternalLink(check(urlBody, a[0])))
  handle('setNativeTheme', (a) => {
    applyNativeTheme(check(themeSetting, a[0]))
    return { ok: true as const }
  })
  handle('openDataFolder', async () => {
    await openDataFolder()
    return { ok: true as const }
  })
  handle('showInExplorer', (a) => {
    showRepoInExplorer(check(repoBody, a[0]))
    return { ok: true as const }
  })
}

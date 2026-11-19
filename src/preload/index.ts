// window.osc (Fase 3): the whole renderer↔core transport. One explicit
// function per OscApi method — never a generic `invoke`, so a compromised
// page cannot reach channels the bridge did not open. Handlers answer
// { ok, data } / { ok, false, error } envelopes; here `ok: false` becomes a
// thrown Error again, so the renderer's toasts show the core's own message
// like Studio's HTTP client did.

import { contextBridge, ipcRenderer } from 'electron'
import {
  CLIENT_MSG_CHANNEL,
  SERVER_MSG_CHANNEL,
  methodChannel,
  type IpcResult,
  type OscApi
} from '@shared/ipc.ts'
import type { ServerMsg } from '@shared/protocol.ts'

const call = async <T>(method: string, ...args: unknown[]): Promise<T> => {
  const r = (await ipcRenderer.invoke(methodChannel(method), ...args)) as IpcResult<T>
  if (!r.ok) throw new Error(r.error.message)
  return r.data
}

const osc: OscApi = {
  config: () => call('config'),
  updateState: () => call('updateState'),
  repos: (refresh) => call('repos', refresh),
  addRoot: (path) => call('addRoot', path),
  removeRoot: (path) => call('removeRoot', path),
  init: (repo, agent) => call('init', repo, agent),
  changes: (repo) => call('changes', repo),
  archived: (repo, name) => call('archived', repo, name),
  settings: (repo, reviewInRepo) => call('settings', repo, reviewInRepo),
  file: (repo, path) => call('file', repo, path),
  action: (repo, action, change, text) => call('action', repo, action, change, text),
  review: (repo, change) => call('review', repo, change),
  addComment: (c) => call('addComment', c),
  patchComment: (id, patch) => call('patchComment', id, patch),
  deleteComment: (id) => call('deleteComment', id),
  sendReview: (repo, change) => call('sendReview', repo, change),
  closeRound: (repo, change) => call('closeRound', repo, change),
  git: (repo, scope) => call('git', repo, scope),
  gitBranch: (repo, change) => call('gitBranch', repo, change),
  gitCommit: (b) => call('gitCommit', b),
  // Fase 5: native integrations (dialog, notifications, links, theme, folders)
  pickFolder: () => call('pickFolder'),
  notify: (n) => call('notify', n),
  openExternal: (url) => call('openExternal', url),
  setNativeTheme: (t) => call('setNativeTheme', t),
  openDataFolder: () => call('openDataFolder'),
  showInExplorer: (repo) => call('showInExplorer', repo),
  createDemoRepo: (agent) => call('createDemoRepo', agent),
  // Fase 9: actualización automática
  checkForUpdates: () => call('checkForUpdates'),
  installUpdate: () => call('installUpdate'),
  send: (msg) => {
    ipcRenderer.send(CLIENT_MSG_CHANNEL, msg)
  },
  onMessage: (cb) => {
    const listener = (_ev: unknown, m: ServerMsg): void => cb(m)
    ipcRenderer.on(SERVER_MSG_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(SERVER_MSG_CHANNEL, listener)
    }
  }
}

contextBridge.exposeInMainWorld('osc', osc)

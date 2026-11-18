// @vitest-environment jsdom
// store.ts over the bridge (tarea 3.7): boot wires window.osc.onMessage and
// subscribes to the saved repo, so a page reload recovers the repo and the
// transcript replay — same contract the WebSocket had, without a network.

import { describe, expect, it } from 'vitest'
import type { ClientMsg, LoggedEvent, ServerMsg } from '@shared/protocol.ts'
import { boot, selectRepo, useStore } from '../../src/renderer/src/store.ts'

const APP = 'C:/repos/app'
const WORK = 'C:/repos'
const sends: ClientMsg[] = []
let server: ((m: ServerMsg) => void) | null = null

window.osc = {
  config: () =>
    Promise.resolve({
      platform: 'win32',
      defaultAgent: 'fake',
      agents: [{ id: 'fake', label: 'Fake', openspecTool: null }]
    }),
  repos: () =>
    Promise.resolve({
      roots: [{ path: WORK, fromEnv: false, truncated: false }],
      repos: [
        {
          id: APP,
          name: 'app',
          root: WORK,
          rel: 'app',
          openspec: true,
          session: null
        }
      ]
    }),
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  send: (m) => sends.push(m),
  onMessage: (cb) => {
    server = cb
    return () => {}
  }
} as unknown as typeof window.osc

describe('store over window.osc', () => {
  it('boot subscribes to the saved repo and applies the session and replay', async () => {
    localStorage.setItem('repo', APP)
    await boot()
    expect(useStore.getState().repo).toBe(APP)
    expect(sends).toContainEqual({ type: 'subscribe', repo: APP })

    server!({ type: 'session', repo: APP, session: null })
    expect(useStore.getState().session).toBeNull()

    const entry: LoggedEvent = {
      seq: 1,
      at: '2026-11-18T10:00:00.000Z',
      event: { kind: 'notice', level: 'info', text: 'openspec init' }
    }
    server!({ type: 'replay', repo: APP, entries: [entry] })
    expect(useStore.getState().events).toEqual([entry])

    // messages of other repos are ignored, as before
    server!({ type: 'replay', repo: 'C:/repos/other', entries: [entry] })
    expect(useStore.getState().events).toEqual([entry])
  })

  it('selecting a repo (re)subscribes over the bridge', () => {
    sends.length = 0
    selectRepo(APP)
    expect(sends.at(-1)).toEqual({ type: 'subscribe', repo: APP })
  })
})

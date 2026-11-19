// @vitest-environment jsdom
// Fase 11 (tarea 11.5): los eventos del agente llegan por la puerta del store
// agrupados. Una sesión de más de 2000 eventos congelaba la página (~80 s con
// 2500 eventos) porque cada uno rehacía y repintaba toda la transcripción; ahora
// los eventos que llegan en ráfaga se aplican en un solo cambio del store.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoggedEvent, ServerMsg } from '@shared/protocol.ts'
import { boot, selectRepo, useStore } from '../../src/renderer/src/store.ts'

const APP = 'C:/repos/app'
const OTHER = 'C:/repos/other'
let server: ((m: ServerMsg) => void) | null = null

const repoInfo = (id: string, name: string) => ({
  id,
  name,
  root: 'C:/repos',
  rel: name,
  openspec: true,
  session: null
})

window.osc = {
  config: () =>
    Promise.resolve({
      platform: 'win32',
      defaultAgent: 'fake',
      agents: [{ id: 'fake', label: 'Fake', openspecTool: null }]
    }),
  repos: () =>
    Promise.resolve({
      roots: [{ path: 'C:/repos', fromEnv: false, truncated: false }],
      repos: [repoInfo(APP, 'app'), repoInfo(OTHER, 'other')]
    }),
  changes: () =>
    Promise.resolve({ active: [], archived: [], specs: [], workflows: [], reviewInRepo: false }),
  review: () => Promise.resolve({ comments: [], rounds: [] }),
  git: () => Promise.resolve({ repo: false, branch: null, base: null, onBase: false }),
  send: () => {},
  onMessage: (cb) => {
    server = cb
    return () => {}
  }
} as unknown as typeof window.osc

const chunk = (seq: number): LoggedEvent => ({
  seq,
  at: '2026-11-19T10:00:00.000Z',
  event: {
    kind: 'update',
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `t${seq} ` } }
  }
})
const turnEnd = (seq: number): LoggedEvent => ({
  seq,
  at: '2026-11-19T10:00:00.000Z',
  event: { kind: 'turn_end', stopReason: 'end_turn' }
})
const send = (repo: string, entry: LoggedEvent) => server!({ type: 'event', repo, entry })

beforeAll(async () => {
  localStorage.setItem('repo', APP)
  await boot()
})
beforeEach(() => {
  vi.useFakeTimers()
  selectRepo(APP) // vacía la transcripción y descarta lo que hubiese en el búfer
})
afterEach(() => {
  vi.useRealTimers()
})

describe('eventos del agente en ráfaga (tarea 11.5)', () => {
  it('una ráfaga de eventos produce un solo cambio del store', () => {
    let changes = 0
    const off = useStore.subscribe((s, prev) => {
      if (s.events !== prev.events) changes++
    })
    for (let i = 1; i <= 2500; i++) send(APP, chunk(i))
    expect(useStore.getState().events).toHaveLength(0) // aún en el búfer
    vi.advanceTimersByTime(200)
    off()
    expect(changes).toBe(1)
    // el log vivo se queda en la misma ventana que el replay del servidor (2000)
    const events = useStore.getState().events
    expect(events).toHaveLength(2000)
    expect(events[0].seq).toBe(501)
    expect(events.at(-1)?.seq).toBe(2500)
  })

  it('conserva el orden y no pierde eventos entre ráfagas', () => {
    for (let i = 1; i <= 5; i++) send(APP, chunk(i))
    vi.advanceTimersByTime(200)
    for (let i = 6; i <= 9; i++) send(APP, chunk(i))
    vi.advanceTimersByTime(200)
    expect(useStore.getState().events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('el fin de turno (y el resto de lo que hay que ver ya) vacía el búfer al instante', () => {
    send(APP, chunk(1))
    send(APP, chunk(2))
    expect(useStore.getState().events).toHaveLength(0)
    send(APP, turnEnd(3)) // sin avanzar el reloj
    expect(useStore.getState().events.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('un replay sustituye el log y descarta lo que estaba en el búfer', () => {
    send(APP, chunk(1))
    server!({ type: 'replay', repo: APP, entries: [chunk(7), chunk(8)] })
    vi.advanceTimersByTime(200)
    expect(useStore.getState().events.map((e) => e.seq)).toEqual([7, 8])
  })

  it('cambiar de repo descarta lo que estaba en el búfer del anterior', () => {
    send(APP, chunk(1))
    selectRepo(OTHER)
    vi.advanceTimersByTime(200)
    expect(useStore.getState().events).toHaveLength(0)
    selectRepo(APP)
  })

  it('los eventos de otros repos se ignoran', () => {
    send(OTHER, chunk(1))
    vi.advanceTimersByTime(200)
    expect(useStore.getState().events).toHaveLength(0)
  })
})

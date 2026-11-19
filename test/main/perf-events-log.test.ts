import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { closeDb, events, openDb } from '../../src/main/core/db.ts'

// Fase 11 (tarea 11.5): coste del log de eventos (una alta por evento del agente
// y el replay de los últimos 2000 al reconectar). Archivo aparte de perf-core.test.ts
// porque db.ts guarda un único manejador abierto por proceso.

describe('log de eventos: añadir y reproducir (tarea 11.5)', () => {
  it('2500 altas y un replay de 2000 se hacen en una fracción de segundo por evento', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-perf-db-'))
    try {
      openDb(path.join(dir, 'events.db'))
      const t0 = performance.now()
      for (let i = 0; i < 2500; i++) {
        events.append('repo', { kind: 'update', update: { sessionUpdate: 'x', i } })
      }
      const appendMs = performance.now() - t0
      const t1 = performance.now()
      const list = events.list('repo')
      const replayMs = performance.now() - t1
      console.log(
        `[perf-core] 2500 altas: ${Math.round(appendMs)} ms (${(appendMs / 2500).toFixed(2)} ms/alta); replay de ${list.length}: ${Math.round(replayMs)} ms`
      )
      expect(list).toHaveLength(2000)
      // generoso: sin fsync por evento son ~0,1 ms; con fsync de disco lento, unos pocos ms
      expect(appendMs / 2500).toBeLessThan(20)
      expect(replayMs).toBeLessThan(1000)
    } finally {
      closeDb()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

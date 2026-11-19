// Fase 10 (tarea 10.2): la lógica del arranque de prueba de la CI
// (scripts/ci-smoke-lib.mjs) clasifica bien los mensajes CDP y decide el
// veredicto: falla si no hay #root, si está vacío o si hay errores de consola;
// pasa si carga limpio. Lanzar Electron con --remote-debugging-port solo ocurre
// dentro del workflow de CI, no aquí.

import { describe, expect, it } from 'vitest'
import {
  describeConsoleError,
  pickPageTarget,
  ROOT_PROBE,
  smokeVerdict
} from '../../scripts/ci-smoke-lib.mjs'

describe('describeConsoleError', () => {
  it('detecta console.error con sus argumentos', () => {
    const msg = {
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'error',
        args: [
          { type: 'string', value: 'boom' },
          { type: 'number', value: 3 }
        ]
      }
    }
    expect(describeConsoleError(msg)).toBe('console.error: boom 3')
  })

  it('usa la descripción de objetos remotos sin valor', () => {
    const msg = {
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'error',
        args: [{ type: 'object', description: 'TypeError: x is undefined' }]
      }
    }
    expect(describeConsoleError(msg)).toContain('TypeError: x is undefined')
  })

  it('ignora console.log, warn e info', () => {
    for (const type of ['log', 'warning', 'info', 'debug']) {
      const msg = { method: 'Runtime.consoleAPICalled', params: { type, args: [] } }
      expect(describeConsoleError(msg)).toBeNull()
    }
  })

  it('detecta excepciones sin capturar', () => {
    const msg = {
      method: 'Runtime.exceptionThrown',
      params: {
        exceptionDetails: {
          text: 'Uncaught',
          url: 'file:///app/index.js',
          lineNumber: 7,
          exception: { description: 'ReferenceError: foo is not defined' }
        }
      }
    }
    expect(describeConsoleError(msg)).toBe(
      'excepción: ReferenceError: foo is not defined (file:///app/index.js:7)'
    )
  })

  it('detecta entradas de log de nivel error (red, CSP) y no las de aviso', () => {
    const error = {
      method: 'Log.entryAdded',
      params: { entry: { level: 'error', source: 'security', text: 'CSP violation', url: 'x' } }
    }
    expect(describeConsoleError(error)).toBe('log(security): CSP violation (x)')
    const warning = { method: 'Log.entryAdded', params: { entry: { level: 'warning', text: 'w' } } }
    expect(describeConsoleError(warning)).toBeNull()
  })

  it('ignora respuestas y eventos que no son de consola', () => {
    expect(describeConsoleError({ method: 'Page.loadEventFired', params: {} })).toBeNull()
    expect(describeConsoleError({})).toBeNull()
  })
})

describe('pickPageTarget', () => {
  const page = {
    type: 'page',
    url: 'file:///out/renderer/index.html',
    webSocketDebuggerUrl: 'ws://x'
  }

  it('elige la página de la app y descarta DevTools, workers y entradas sin WebSocket', () => {
    const targets = [
      { type: 'worker', url: 'file:///w.js', webSocketDebuggerUrl: 'ws://w' },
      { type: 'page', url: 'devtools://devtools/bundled/x.html', webSocketDebuggerUrl: 'ws://d' },
      { type: 'page', url: 'file:///sin-ws.html' },
      page
    ]
    expect(pickPageTarget(targets)).toBe(page)
  })

  it('devuelve null si aún no hay página o la respuesta no es una lista', () => {
    expect(pickPageTarget([])).toBeNull()
    expect(pickPageTarget({ error: 'x' })).toBeNull()
  })
})

describe('smokeVerdict', () => {
  it('pasa con #root renderizado y sin errores', () => {
    expect(smokeVerdict({ probe: { present: true, children: 1 }, errors: [] })).toEqual({
      ok: true,
      problems: []
    })
  })

  it('falla si la sonda nunca respondió o #root no existe', () => {
    expect(smokeVerdict({ probe: null, errors: [] }).ok).toBe(false)
    const r = smokeVerdict({ probe: { present: false, children: 0 }, errors: [] })
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual(['no existe #root en la página'])
  })

  it('falla si #root está vacío (React no pintó nada)', () => {
    const r = smokeVerdict({ probe: { present: true, children: 0 }, errors: [] })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatch(/no renderizó/)
  })

  it('falla con errores de consola aunque #root exista', () => {
    const r = smokeVerdict({
      probe: { present: true, children: 2 },
      errors: ['console.error: boom']
    })
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual(['console.error: boom'])
  })
})

describe('ROOT_PROBE', () => {
  it('consulta #root y cuenta sus hijos', () => {
    expect(ROOT_PROBE).toContain("getElementById('root')")
    expect(ROOT_PROBE).toContain('childElementCount')
  })
})

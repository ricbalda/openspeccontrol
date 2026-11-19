// Fase 10 (tarea 10.2): lógica pura del arranque de prueba de la CI
// (scripts/ci-smoke.mjs). Se separa del script para poder probarla sin
// lanzar Electron: aquí solo se interpretan los mensajes del protocolo
// Chrome DevTools (CDP) y se decide si el arranque fue correcto.

/** Expresión que se evalúa en la página: ¿existe #root y React ya pintó algo dentro? */
export const ROOT_PROBE = `(() => {
  const root = document.getElementById('root')
  return { present: !!root, children: root ? root.childElementCount : 0 }
})()`

/** Elige la página de la app entre los objetivos de `/json/list` (no DevTools ni workers). */
export function pickPageTarget(targets) {
  if (!Array.isArray(targets)) return null
  return (
    targets.find(
      (t) =>
        t &&
        t.type === 'page' &&
        typeof t.webSocketDebuggerUrl === 'string' &&
        !String(t.url ?? '').startsWith('devtools://')
    ) ?? null
  )
}

/** Texto legible de un argumento remoto de `console.*` (valor primitivo o descripción). */
function remoteArgText(arg) {
  if (!arg || typeof arg !== 'object') return String(arg)
  if (arg.value !== undefined) return String(arg.value)
  return arg.description ?? arg.type ?? ''
}

/**
 * Si el mensaje CDP es un error de consola de la página devuelve su descripción;
 * si no, null. Cubre tres vías por las que llega un error al DevTools:
 *  · `Runtime.consoleAPICalled` con type `error` (console.error)
 *  · `Runtime.exceptionThrown` (excepciones sin capturar y promesas rechazadas)
 *  · `Log.entryAdded` con level `error` (red, CSP y otros avisos del navegador)
 */
export function describeConsoleError(msg) {
  if (!msg || typeof msg.method !== 'string') return null
  const p = msg.params ?? {}
  switch (msg.method) {
    case 'Runtime.consoleAPICalled':
      if (p.type !== 'error') return null
      return `console.error: ${(p.args ?? []).map(remoteArgText).join(' ')}`.trim()
    case 'Runtime.exceptionThrown': {
      const d = p.exceptionDetails ?? {}
      const text = d.exception?.description ?? d.text ?? 'excepción sin descripción'
      return `excepción: ${text}${d.url ? ` (${d.url}:${d.lineNumber ?? 0})` : ''}`
    }
    case 'Log.entryAdded':
      if (p.entry?.level !== 'error') return null
      return `log(${p.entry.source ?? '?'}): ${p.entry.text ?? ''}${p.entry.url ? ` (${p.entry.url})` : ''}`
    default:
      return null
  }
}

/**
 * Veredicto del arranque. `probe` es el último resultado de ROOT_PROBE (o null si
 * nunca se pudo evaluar) y `errors` la lista de errores de consola recogidos.
 * Pasa solo si #root existe, tiene contenido renderizado y no hubo errores.
 */
export function smokeVerdict({ probe, errors }) {
  const problems = []
  if (!probe || !probe.present) problems.push('no existe #root en la página')
  else if (probe.children === 0) problems.push('#root existe pero React no renderizó nada')
  for (const e of errors ?? []) problems.push(e)
  return { ok: problems.length === 0, problems }
}

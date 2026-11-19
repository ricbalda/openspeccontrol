// desktop/safe-close.ts (Fase 4, tarea 4.4): the safe-quit gate. Quitting
// while an agent is working (or has decisions waiting for the user) kills its
// process tree, so it is confirmed first: "Cancelar" keeps the app and the
// turn running; "Cerrar igual" lets the quit go on — will-quit then runs
// core.shutdown() and app.exit(0), so no agent process survives.

import path from 'node:path'
import { dialog } from 'electron'
import type { SessionState } from '@shared/protocol.ts'

/** A session a quit would interrupt (core.sessionStates() feeds this). */
export interface LiveWork {
  repo: string
  busy: boolean
  pending: number
}

/** Sessions that must not die silently: a busy agent or decisions still pending. */
export function liveWork(states: { repo: string; state: SessionState }[]): LiveWork[] {
  return states
    .map(({ repo, state }) => ({
      repo,
      busy: state.status === 'busy',
      pending: state.pendingInteractions
    }))
    .filter((w) => w.busy || w.pending > 0)
}

/** One line per repo, saying what closing would interrupt (basename keeps it readable). */
export function workDetail(work: LiveWork[]): string {
  return work
    .map((w) => {
      const name = path.basename(w.repo) || w.repo
      const bits: string[] = []
      if (w.busy) bits.push('un agente está trabajando')
      if (w.pending === 1) bits.push('1 decisión pendiente')
      else if (w.pending > 1) bits.push(`${w.pending} decisiones pendientes`)
      return `- ${name}: ${bits.join(' y ')}.`
    })
    .join('\n')
}

/**
 * The confirmation: Cancelar keeps everything running, "Cerrar igual" quits.
 * Cancelar is both the default and the cancel button, so Enter keeps the work.
 */
export async function confirmQuit(work: LiveWork[]): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Cerrar OpenSpecControl',
    message: 'Hay trabajo en curso; cerrar lo detendrá.',
    detail:
      `${workDetail(work)}\n` +
      'Los procesos de los agentes se detendrán y la base de datos se cerrará de forma limpia.',
    buttons: ['Cancelar', 'Cerrar igual'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}

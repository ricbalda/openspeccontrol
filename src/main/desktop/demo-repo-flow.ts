// Fase 5.7 · Ayuda → "Crear repositorio de demostración…": el flujo nativo
// completo sobre createDemoRepo (demo-repo.ts). El renderer solo elige el agente;
// la carpeta se elige aquí con el selector del SO (un path escrito por el renderer
// nunca llega a createDemoRepo) y todo es asíncrono, así que ni el proceso main ni
// la UI se bloquean mientras se crean los archivos, `openspec init` y el commit.

import fs from 'node:fs/promises'
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { DemoRepoOutcome } from '@shared/ipc.ts'
import type { OscCore } from '../core/osc-core.ts'
import { getAgent } from '../core/agents.ts'
import { OscError } from '../core/errors.ts'
import { createDemoRepo, type DemoRunners } from './demo-repo.ts'

/**
 * Elige la carpeta contenedora, crea <carpeta>/hello-app, la añade al workspace y
 * devuelve lo que el renderer necesita para seleccionarla (repo + cambio).
 * Devuelve null si el usuario cancela el selector. `agentId` null = sin
 * `openspec init` (los archivos de la demo ya traen su carpeta openspec/).
 * `runners` solo existe para que los tests sustituyan git/openspec.
 */
export async function pickAndCreateDemoRepo(
  core: OscCore,
  parent: BrowserWindow | null,
  agentId: string | null,
  runners?: Partial<DemoRunners>
): Promise<DemoRepoOutcome | null> {
  // validar el agente ANTES de abrir el diálogo: un id desconocido falla sin molestar
  let tools: string | null = null
  if (agentId) {
    const agent = getAgent(agentId)
    if (!agent) throw new OscError('invalid', `unknown agent: ${agentId}`)
    tools = agent.openspecTool
  }

  const opts: OpenDialogOptions = {
    title: 'Create demo repository',
    buttonLabel: 'Create here',
    properties: ['openDirectory', 'createDirectory']
  }
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  const root = r.canceled ? null : r.filePaths[0]
  if (!root) return null // cancelado: el diálogo del renderer sigue abierto

  const demo = await createDemoRepo({ root, tools, runners })

  // el id de un repo es su ruta real; si la carpeta elegida ya es una raíz del
  // workspace, hello-app aparece sola y no hace falta añadir otra raíz
  const repoId = await fs.realpath(demo.repo)
  let workspace = await core.repos(true)
  if (!workspace.repos.some((x) => x.id === repoId))
    workspace = await core.addRoot({ path: demo.repo })

  return {
    workspace,
    repo: repoId,
    change: demo.change,
    openspecOk: demo.openspecOk,
    gitOk: demo.gitOk,
    warnings: demo.warnings
  }
}

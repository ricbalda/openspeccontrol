// tarea 11.5: la vista inferida en local (la que pinta el rail al instante) debe
// coincidir con lo que el CLI de OpenSpec real calcula para los mismos archivos:
// progreso de tareas, estado de los artefactos y planificación completa. Se
// ejecuta con el `openspec` del PATH (corre en Windows) y se omite si no existe.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentView, refreshView } from '../../src/main/core/openspec.ts'

const hasCli = spawnSync('openspec', ['--version'], { shell: true }).status === 0

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-parity-'))
const repo = path.join(tmp, 'repo')
const write = (rel: string, text: string) => {
  const file = path.join(repo, 'openspec', 'changes', rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

describe.skipIf(!hasCli)('inferred view == the real openspec CLI (tarea 11.5)', () => {
  it('matches list + status for every stage of a change', async () => {
    fs.mkdirSync(path.join(repo, 'openspec', 'specs'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'openspec', 'config.yaml'), 'schema: spec-driven\n')
    // 1. proposal only
    write('only-proposal/proposal.md', '# P\n')
    // 2. proposal + specs (design missing)
    write('no-design/proposal.md', '# P\n')
    write('no-design/specs/c/spec.md', '# S\n')
    // 3. planning complete, no task ticked
    for (const f of ['proposal.md', 'design.md', 'specs/c/spec.md']) write(`planned/${f}`, '# x\n')
    write('planned/tasks.md', '## 1. A\n- [ ] 1.1 one\n- [ ] 1.2 two\n')
    // 4. applying, CRLF file, mixed markers
    for (const f of ['proposal.md', 'design.md', 'specs/c/spec.md']) write(`applying/${f}`, '# x\n')
    write('applying/tasks.md', '- [x] 1.1 a\r\n- [ ] 1.2 b\r\n1. [X] 1.3 c\r\n- [~] 1.4 d\r\n')
    // 5. all done
    for (const f of ['proposal.md', 'design.md', 'specs/c/spec.md']) write(`finished/${f}`, '# x\n')
    write('finished/tasks.md', '- [x] 1.1 a\n- [x] 1.2 b\n')
    // 6. skip_specs metadata
    write('skip/.openspec.yaml', 'schema: spec-driven\nskip_specs: true\n')
    write('skip/proposal.md', '# P\n')
    write('skip/design.md', '# D\n')
    // 7. only tasks.md (out of order)
    write('lonely-tasks/tasks.md', '- [ ] 1.1 x\n')

    const inferred = currentView(repo)
    expect(inferred.stale).toBe(true)
    await expect(refreshView(repo)).resolves.toBe('fresh')
    const real = currentView(repo)
    expect(real.stale).toBe(false)

    const byName = <T extends { name?: string; changeName?: string }>(xs: T[]) =>
      new Map(xs.map((x) => [x.name ?? x.changeName!, x]))
    const iList = byName(inferred.view.list.changes ?? [])
    const rList = byName(real.view.list.changes ?? [])
    expect([...iList.keys()].sort()).toEqual([...rList.keys()].sort())
    for (const [name, r] of rList) {
      const i = iList.get(name)!
      expect({ name, ...pick(i, 'completedTasks', 'totalTasks', 'status') }).toEqual({
        name,
        ...pick(r, 'completedTasks', 'totalTasks', 'status')
      })
      // newest mtime: the CLI and the inference read the same files
      expect(Math.abs(Date.parse(i.lastModified) - Date.parse(r.lastModified))).toBeLessThan(2000)
    }

    const iSt = byName(inferred.view.status.changes ?? [])
    const rSt = byName(real.view.status.changes ?? [])
    for (const [name, r] of rSt) {
      const i = iSt.get(name)!
      expect(
        {
          name,
          planning: i.isPlanningComplete,
          complete: i.isComplete,
          artifacts: i.artifacts.map((a) => [a.id, a.status])
        },
        name
      ).toEqual({
        name,
        planning: r.isPlanningComplete,
        complete: r.isComplete,
        artifacts: r.artifacts.map((a) => [a.id, a.status])
      })
    }
  }, 60_000)
})

function pick<T extends object, K extends keyof T>(o: T, ...keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>
}

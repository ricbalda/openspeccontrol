# Inventario de tests (tareas 11.1 y 11.2)

Generado por `node scripts/test-inventory.mjs` el 2026-11-19T01:37:16.834Z en Windows_NT 10.0.26300 (win32/x64), Node v26.13.1.

Total de la ejecución: **355 pasan**, 0 fallan, 3 omitidos, en 52 archivos (358 casos).

Un test exigido cuenta si su archivo existe, ejecuta al menos un caso y ninguno falla; si todo su contenido se omite por la plataforma queda como «no ejecutado en este SO», es decir, **no verificado** aquí. «Omitidos» son casos que esta ejecución **no** pudo correr (motivo declarado en el propio archivo).

## 11.1 — núcleo conservado (proceso principal)

| Archivo | Casos | Pasan | Fallan | Omitidos | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `test/main/agents.test.ts` | 2 | 2 | 0 | 0 | ok |
| `test/main/anchor.test.ts` | 12 | 12 | 0 | 0 | ok |
| `test/main/changes-cache.test.ts` | 1 | 0 | 0 | 1 | **no ejecutado en este SO** (todo omitido) |
| `test/main/git.test.ts` | 9 | 9 | 0 | 0 | ok |
| `test/main/repoFile.test.ts` | 8 | 8 | 0 | 0 | ok |
| `test/main/review.test.ts` | 4 | 4 | 0 | 0 | ok |
| `test/main/round.test.ts` | 5 | 5 | 0 | 0 | ok |
| `test/main/sandbox.test.ts` | 3 | 3 | 0 | 0 | ok |
| `test/main/schemas.test.ts` | 3 | 3 | 0 | 0 | ok |
| `test/main/specs.test.ts` | 7 | 7 | 0 | 0 | ok |
| `test/main/usage.test.ts` | 5 | 5 | 0 | 0 | ok |
| `test/main/workspace.test.ts` | 8 | 8 | 0 | 0 | ok |

## 11.1 — renderer conservado

| Archivo | Casos | Pasan | Fallan | Omitidos | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `test/renderer/columnResizer.test.ts` | 5 | 5 | 0 | 0 | ok |
| `test/renderer/relative.test.ts` | 1 | 1 | 0 | 0 | ok |
| `test/renderer/specMarkup.test.tsx` | 3 | 3 | 0 | 0 | ok |
| `test/renderer/textModel.test.ts` | 4 | 4 | 0 | 0 | ok |
| `test/renderer/transcript.test.ts` | 8 | 8 | 0 | 0 | ok |
| `test/renderer/usage.test.ts` | 1 | 1 | 0 | 0 | ok |

## 11.2 — tests nuevos de cada fase

| Archivo | Casos | Pasan | Fallan | Omitidos | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| `test/main/osc-core.test.ts` | 9 | 9 | 0 | 0 | ok |
| `test/main/legacy-import.test.ts` | 5 | 5 | 0 | 0 | ok |
| `test/main/ipc.test.ts` | 18 | 18 | 0 | 0 | ok |
| `test/main/updater.test.ts` | 21 | 21 | 0 | 0 | ok |
| `test/main/shell-env.test.ts` | 13 | 13 | 0 | 0 | ok |
| `test/main/tools.test.ts` | 5 | 5 | 0 | 0 | ok |

## Comprobaciones adicionales

- `workspace` sin `browse`: ok — `test/main/workspace.test.ts` no menciona `browse`.

## Casos omitidos en esta ejecución

| Archivo | Omitidos | Motivo declarado |
| --- | ---: | --- |
| `test/main/changes-cache.test.ts` | 1 | `describe.skipIf(process.platform === 'win32')('change list CLI cache', () => {` |
| `test/main/wsl-unc.test.ts` | 2 | `;(share ? describe : describe.skip)('WSL as a network folder (tarea 6.5)', () => {` |

## Todos los archivos de test de esta ejecución

| Archivo | Casos | Pasan |
| --- | ---: | ---: |
| `test/main/agents.test.ts` | 2 | 2 |
| `test/main/anchor.test.ts` | 12 | 12 |
| `test/main/badge-icon.test.ts` | 4 | 4 |
| `test/main/badge.test.ts` | 5 | 5 |
| `test/main/changes-cache.test.ts` | 1 | 0 |
| `test/main/ci-smoke.test.ts` | 13 | 13 |
| `test/main/ci-workflows.test.ts` | 26 | 26 |
| `test/main/demo-repo-flow.test.ts` | 6 | 6 |
| `test/main/demo-repo.test.ts` | 6 | 6 |
| `test/main/dist-args.test.ts` | 11 | 11 |
| `test/main/external-links.test.ts` | 2 | 2 |
| `test/main/git.test.ts` | 9 | 9 |
| `test/main/hub-env.test.ts` | 4 | 4 |
| `test/main/hub-stop.test.ts` | 1 | 1 |
| `test/main/ipc-native.test.ts` | 10 | 10 |
| `test/main/ipc.test.ts` | 18 | 18 |
| `test/main/legacy-import.test.ts` | 5 | 5 |
| `test/main/menu.test.ts` | 13 | 13 |
| `test/main/notifications.test.ts` | 6 | 6 |
| `test/main/osc-core.test.ts` | 9 | 9 |
| `test/main/perf-core.test.ts` | 1 | 1 |
| `test/main/perf-events-log.test.ts` | 1 | 1 |
| `test/main/pick-folder.test.ts` | 4 | 4 |
| `test/main/release-check.test.ts` | 10 | 10 |
| `test/main/renderer-health.test.ts` | 5 | 5 |
| `test/main/repoFile.test.ts` | 8 | 8 |
| `test/main/review.test.ts` | 4 | 4 |
| `test/main/round.test.ts` | 5 | 5 |
| `test/main/safe-close.test.ts` | 6 | 6 |
| `test/main/sandbox.test.ts` | 3 | 3 |
| `test/main/schemas.test.ts` | 3 | 3 |
| `test/main/security.test.ts` | 7 | 7 |
| `test/main/shell-env.test.ts` | 13 | 13 |
| `test/main/specs.test.ts` | 7 | 7 |
| `test/main/tools.test.ts` | 5 | 5 |
| `test/main/updater.test.ts` | 21 | 21 |
| `test/main/usage.test.ts` | 5 | 5 |
| `test/main/window-state.test.ts` | 15 | 15 |
| `test/main/workspace.test.ts` | 8 | 8 |
| `test/main/wsl-unc.test.ts` | 2 | 0 |
| `test/renderer/api.test.ts` | 3 | 3 |
| `test/renderer/columnResizer.test.ts` | 5 | 5 |
| `test/renderer/event-batching.test.ts` | 6 | 6 |
| `test/renderer/help-menu-actions.test.tsx` | 16 | 16 |
| `test/renderer/native-integrations.test.tsx` | 7 | 7 |
| `test/renderer/relative.test.ts` | 1 | 1 |
| `test/renderer/specMarkup.test.tsx` | 3 | 3 |
| `test/renderer/store.test.ts` | 2 | 2 |
| `test/renderer/textModel.test.ts` | 4 | 4 |
| `test/renderer/transcript.test.ts` | 8 | 8 |
| `test/renderer/update-pill.test.tsx` | 6 | 6 |
| `test/renderer/usage.test.ts` | 1 | 1 |

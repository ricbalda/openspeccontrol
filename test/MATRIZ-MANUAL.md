# Matriz manual de la Fase 11 (tareas 11.4 y 11.6)

Checklist para completar a mano: **3 sistemas operativos × 4 agentes**. Esta matriz no se
puede ejecutar de forma automática (necesita cada SO, sesiones reales con cada agente y, en
varios puntos, cuentas y permisos de agente), así que **ningún punto está marcado como
verificado**.

Reglas de marcado:

- `⬜ no ejecutado` — nadie lo ha probado todavía (estado de partida de **todas** las celdas).
- `✅ AAAA-MM-DD nombre` — probado de verdad en ese SO con ese agente; anota fecha y quién.
- `❌ #issue` — probado y falla (enlaza el problema).
- `—` — el punto no depende del agente: se prueba una vez por SO, en la columna «Sin agente».

> **Estado de la aceptación (11.6): NO CUMPLIDA.** Hay que marcar todos los puntos por
> sistema operativo. Esta sesión solo pudo trabajar en Windows 11 y con un agente ACP **falso**
> (`test/e2e/fake-acp-agent.mjs`), que no sustituye a los agentes reales: ver «Evidencia
> parcial» al final. Nada de eso cuenta como marca.

## Preparación (una vez por SO y agente)

1. `npm ci && npx electron-vite build`, o instala el paquete generado por `npm run dist`.
2. `node scripts/demo-repo.mjs <carpeta> --tools <claude|codebuddy|codex|opencode>` crea
   `hello-app` con el cambio `add-hello-endpoint` listo en «In review» y los comandos `/opsx`
   instalados para ese agente. En la app: selector de repos → **Add folder…** → `<carpeta>`.
3. Agente instalado y con sesión iniciada (CodeBuddy: `codebuddy`; Claude Code y Codex vía
   `npx`; opencode: `opencode`). Ayuda → **Diagnóstico de dependencias** debe mostrar
   node, npx, openspec y git en verde.
4. Para ejercitar la importación de Studio: una copia de un `~/.openspec-studio` de Studio 0.3.x
   (con repos, comentarios y rondas) **antes** del primer arranque, y un `OSC_DATA` vacío.

## Matriz — Windows

| Punto | CodeBuddy | Claude Code | Codex | opencode | Sin agente |
| --- | --- | --- | --- | --- | --- |
| 1. Conectar y reanudar la sesión | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 2. Propose | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 3. Send review | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 4. Permisos y elicitation | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 5. Build | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 6. Verify | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 7. Sync | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 8. Archive | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 9. Historial (replay al reconectar) | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 10. Specs principales | — | — | — | — | ⬜ no ejecutado |
| 11. Validación y artefactos desactualizados | — | — | — | — | ⬜ no ejecutado |
| 12. Rama y commit | — | — | — | — | ⬜ no ejecutado |
| 13. `.openspeccontrol-review.json` y lectura de `.studio-review.json` | — | — | — | — | ⬜ no ejecutado |
| 14. `agents.json` en caliente | — | — | — | — | ⬜ no ejecutado |
| 15. Importación de una instalación de Studio 0.3.x | — | — | — | — | ⬜ no ejecutado |

## Matriz — macOS

| Punto | CodeBuddy | Claude Code | Codex | opencode | Sin agente |
| --- | --- | --- | --- | --- | --- |
| 1. Conectar y reanudar la sesión | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 2. Propose | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 3. Send review | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 4. Permisos y elicitation | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 5. Build | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 6. Verify | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 7. Sync | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 8. Archive | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 9. Historial (replay al reconectar) | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 10. Specs principales | — | — | — | — | ⬜ no ejecutado |
| 11. Validación y artefactos desactualizados | — | — | — | — | ⬜ no ejecutado |
| 12. Rama y commit | — | — | — | — | ⬜ no ejecutado |
| 13. `.openspeccontrol-review.json` y lectura de `.studio-review.json` | — | — | — | — | ⬜ no ejecutado |
| 14. `agents.json` en caliente | — | — | — | — | ⬜ no ejecutado |
| 15. Importación de una instalación de Studio 0.3.x | — | — | — | — | ⬜ no ejecutado |

## Matriz — Linux

| Punto | CodeBuddy | Claude Code | Codex | opencode | Sin agente |
| --- | --- | --- | --- | --- | --- |
| 1. Conectar y reanudar la sesión | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 2. Propose | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 3. Send review | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 4. Permisos y elicitation | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 5. Build | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 6. Verify | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 7. Sync | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 8. Archive | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 9. Historial (replay al reconectar) | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | ⬜ no ejecutado | — |
| 10. Specs principales | — | — | — | — | ⬜ no ejecutado |
| 11. Validación y artefactos desactualizados | — | — | — | — | ⬜ no ejecutado |
| 12. Rama y commit | — | — | — | — | ⬜ no ejecutado |
| 13. `.openspeccontrol-review.json` y lectura de `.studio-review.json` | — | — | — | — | ⬜ no ejecutado |
| 14. `agents.json` en caliente | — | — | — | — | ⬜ no ejecutado |
| 15. Importación de una instalación de Studio 0.3.x | — | — | — | — | ⬜ no ejecutado |

## Cómo comprobar cada punto

| # | Qué hacer | Qué debe verse |
| --- | --- | --- |
| 1 | Panel del agente → **Connect**; cerrar la app y reabrirla → **Connect** de nuevo | La sesión pasa a «ready»; la segunda vez anuncia «Resumed … session» (si el agente soporta `session/load`) y conserva el contexto |
| 2 | **New change** → describir un cambio → Propose | El agente crea `proposal.md`, specs, `design.md` y `tasks.md`; el rail muestra las pastillas de artefactos en verde |
| 3 | Comentar un texto del cambio y **Send review** | Ronda «running» → «done»; el agente responde a cada comentario y la ronda muestra el diff de lo que cambió |
| 4 | Provocar una acción con permiso (Build que escribe archivos o ejecuta comandos) y, si el agente lo ofrece, una pregunta de formulario | Tarjeta de permiso/elicitation en el chat; al responder, la sesión continúa; con la ventana en segundo plano, notificación nativa e insignia con el número de decisiones pendientes |
| 5 | **Build** sobre `add-hello-endpoint` | Las 3 tareas se marcan en `tasks.md` y el rail muestra el progreso; el código del repo cambia |
| 6 | **Verify** | El agente comprueba código contra specs/tareas/diseño y lo cuenta en el chat |
| 7 | **Sync** | Las specs delta pasan a `openspec/specs/` |
| 8 | **Archive** | El cambio pasa a «Archived» con prefijo de fecha y desaparece de «In review» |
| 9 | Con más de 2000 eventos en la sesión (p. ej. un Build largo), recargar con Ver → Recargar | La transcripción vuelve entera (los últimos 2000 eventos) y la ventana no se congela |
| 10 | Abrir **SPECS** en el rail | Lista de capacidades con su número de requisitos; se abren en solo lectura |
| 11 | Editar a mano `design.md` después de `tasks.md`, e introducir un error en una spec | El rail marca los artefactos posteriores como desactualizados y el cambio como inválido (insignia de `openspec validate`); el panel de validación muestra el detalle |
| 12 | **Create branch change/…** y luego Commit desde el panel de git | La rama se crea y el commit incluye solo los archivos del cambio; con un hook que rechaza el commit, el error se muestra |
| 13 | En el selector de repos, marcar «Keep review history in …» → comentar; después, con un repo que traiga `.studio-review.json` de Studio, abrir el cambio | Se escribe `.openspeccontrol-review.json` junto al cambio; el `.studio-review.json` se lee (y no se reescribe) |
| 14 | Con la app abierta, añadir un agente en `<datos>/agents.json` y guardar | Aparece en el selector del panel sin reiniciar; un JSON inválido no tumba la app (aviso en consola) |
| 15 | Primer arranque con un `~/.openspec-studio` de Studio 0.3.x y `OSC_DATA` vacío | Aparecen sus carpetas, comentarios y rondas; el origen queda intacto; se crea `imported-from-studio.json` |

## Evidencia parcial (no cuenta como marca)

Lo único que se ejecutó de verdad, en **Windows 11 (x64)** el 2026-11-19, y con qué alcance:

- Un agente ACP **falso** (`test/e2e/fake-acp-agent.mjs`, dado de alta por `agents.json`)
  completó el apretón de manos, `session/new` y turnos de 2500 eventos por el camino real del
  hub (puntos 1 y 9 solo en parte: no es CodeBuddy/Claude/Codex/opencode, no hay reanudación
  `session/load`, y la recarga reproduce un replay de 2000 eventos). Ver
  [INFORME-FASE11.md](INFORME-FASE11.md).
- Al lanzar la app en esa máquina sin aislar `HOME`, apareció el repo de un `~/.openspec-studio`
  real: la importación de Studio (punto 15) funciona al menos para la lista de carpetas. No se
  comprobaron comentarios, rondas ni `agents.json` importados, ni la integridad del origen.
- Los tests unitarios (`legacy-import`, `agents`, `repoFile`, `git`, `review`…) cubren la lógica
  de los puntos 12–15, pero no sustituyen la prueba manual con la app empaquetada.
- macOS y Linux: **nada** ejecutado (la matriz de la CI de la Fase 10 corre tests y el arranque
  de prueba, no estos escenarios).

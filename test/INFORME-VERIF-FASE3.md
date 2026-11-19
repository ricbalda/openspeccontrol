# Informe de verificación — tareas 3.11 y 1.11 (`migrate-to-electron-desktop`)

Plataforma: Windows 11, Node 26 / Electron 45 (`npm run dev` y build de producción por CDP 9301), CLI real `openspec` 2.0.0 y `git`.
Fecha de las ejecuciones: 2026-11-19. Todo lo de abajo lo ejecuté yo; las capturas `.png` están versionadas en `test/e2e/captures/`; los `.log` (`fase3-walkthrough.log`, `fase3-debug-all.log`) quedan ignorados por git y se regeneran ejecutando los scripts.

## Resumen

| Tarea                      | Estado                                    | Resumen                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **3.11** aceptación Fase 3 | **Cumplida** (con dos límites declarados) | Recorrido completo del Walkthrough 17/17 pasos; importación de Studio comprobada (UI, `OSC_DATA`, marcador, origen intacto por SHA-256, sin reimportar); 0 sockets TCP en LISTEN en el árbol de la app sin `--remote-debugging-port`. Límites: diálogo nativo de carpeta no automatizable; el agente es el falso, no uno real. |
| **1.11** «Debug All»       | **Parcial**                               | El puerto del renderer (`REMOTE_DEBUGGING_PORT`) y el inspector V8 del main con sourcemaps funcionan; que VS Code se enganche al pulsar F5 **no es verificable aquí**. `launch.json` no se modifica (ver decisión abajo).                                                                                                      |

## 3.11 — evidencia por punto del criterio

Script reproducible: `node test/e2e/fase3-walkthrough.mjs` (CDP 9301, sesión agent-browser `fase3v`, `--user-data-dir`, `OSC_DATA`, `HOME` y `USERPROFILE` temporales). Salida: `test/e2e/captures/fase3-walkthrough.log` (`OK: 17/17 pasos`). Capturas: `fase3-1…8-*.png`.

### a) Recorrido del Walkthrough — Cumplida (con agente falso)

El agente `test/e2e/fase3-acp-agent.mjs` habla ACP y hace trabajo real en el repo; el resto es el CLI real, git real y la UI real.

| Paso                             | Cómo se comprobó                                                                                                                                                                         | Resultado |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Añadir carpeta                   | Diálogo «Add folder…» con ruta escrita `~/repos-walk` (la app resuelve `~` con el `USERPROFILE` temporal) y comprobación de que la root queda en el workspace                            | OK        |
| Inicializar                      | Botón «Initialize OpenSpec» → `openspec init` real; existen `openspec/config.yaml` y `.claude/`                                                                                          | OK        |
| Conectar agente                  | Botón «Connect» → sesión `ready` (`window.osc.repos()`)                                                                                                                                  | OK        |
| Proponer                         | «New change» → el agente escribe `proposal/design/tasks/specs` del cambio `add-hello-endpoint`; el cambio pasa a «In review»                                                             | OK        |
| Revisar con comentarios anclados | Selección real del texto `GET /api/v1/helloworld` + barra flotante + «Add comment»; el comentario queda en la db con ese ancla                                                           | OK        |
| Enviar ronda                     | «Send review» → ronda 1 `done`, veredicto `addressed` por id, diff `proposal.md`, archivo realmente editado                                                                              | OK        |
| Resolver                         | «resolve addressed» → el cambio pasa a «Ready to build»                                                                                                                                  | OK        |
| Construir                        | «Build it» → el agente escribe `src/routes/hello.js`, `test/hello.test.js`, registra la ruta y marca 3/3 tareas; `node --test` en el repo pasa                                           | OK        |
| Rama                             | «Create branch change/add-hello-endpoint» desde el aviso de rama base; `git` confirma la rama                                                                                            | OK        |
| Commit                           | Diálogo «Commit 5 files» → commit real con los 5 archivos de `openspec/changes/add-hello-endpoint/`                                                                                      | OK        |
| Archivar                         | Diálogo «Archive» → `openspec archive` real: carpeta `changes/archive/2026-11-19-add-hello-endpoint` y `specs/greeting/spec.md` fusionado; la tarjeta desaparece de los activos en la UI | OK        |
| Sin errores de página            | `agent-browser errors` vacío durante todo el recorrido                                                                                                                                   | OK        |

**No verificado aquí (con el porqué):**

- **Diálogo nativo de carpeta** (`pickFolder`, `dialog.showOpenDialog`): CDP no puede manejar diálogos del SO. Solo se verificó el camino alternativo por ruta escrita.
- **Agentes reales** (CodeBuddy, Claude Code, Codex, opencode): no se usaron. El agente falso cubre el protocolo ACP, los prompts `/opsx:*` y la escritura de artefactos/código, pero no el comportamiento de un modelo (p. ej. que respete el formato `review-result`, permisos o elicitation reales). `Verify` y `Sync specs` tampoco se ejercitaron.
- Observación de diseño (no un fallo): el commit de la app lleva **solo** `openspec/changes/<c>/` (README: «commit only that change's files»). El código que escribe el agente (`src/…`) queda sin commitear; el script lo comprueba explícitamente.

### b) Importación desde `~/.openspec-studio` — Cumplida

Fixture realista en el `HOME` temporal: `studio.db` con el esquema de Studio 0.3.x (`sessions/events/comments/rounds`, modo WAL), un comentario resuelto (`stc1`) con su ronda (`str1`), `config.json` con la carpeta de repos y `agents.json` con agentes propios.

| Comprobación                                                                                                                                                                            | Resultado                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo de Studio aparece en el workspace sin tocar nada, con `openspec` detectado                                                                                                         | OK (`root …\repos-studio`)                                                                                                                                                                                                    |
| Agentes importados (`codebuddy, claude, codex, opencode, gemini, fake`)                                                                                                                 | OK                                                                                                                                                                                                                            |
| Comentario importado visible en la UI (tras «Show 1 resolved») y ronda `done` con la pestaña «What changed»                                                                             | OK (captura `fase3-1-import-studio.png`)                                                                                                                                                                                      |
| `openspeccontrol.db`, `agents.json` en `OSC_DATA` y `imported-from-studio.json` con `from` apuntando al origen                                                                          | OK                                                                                                                                                                                                                            |
| **Origen intacto**: SHA-256 de cada archivo antes/después                                                                                                                               | OK: `agents.json 05ad2a3e…`, `config.json 54ca04c2…`, `studio.db fdafb854…` — huella global idéntica (`ff20042c…` en la ejecución mostrada; el fixture lleva fechas y varía entre ejecuciones, pero antes = después en todas) |
| Segundo arranque con el mismo `OSC_DATA`: no reimporta (marcador con el mismo `at` y mtime; la app registra `already imported`) y se conserva lo nuevo (2 comentarios, 2 rondas, roots) | OK                                                                                                                                                                                                                            |

### c) Sin puertos TCP — Cumplida

Se enumeran los sockets en LISTEN de **todo el árbol de procesos** de la app (`Get-CimInstance Win32_Process` + `Get-NetTCPConnection -State Listen`, cruzado con `netstat -ano -p TCP`).

| Escenario                                                                                           | Árbol                                                                                                                                              | LISTEN                                                                              |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Con `--remote-debugging-port=9301` y el agente **conectado y trabajando** (turno `busy` de Propose) | 6 procesos: main, gpu, utility, renderer, el agente (`node fase3-acp-agent.mjs`, comprobado por línea de comandos) y un hijo más sin tipo Electron | **solo** `127.0.0.1:9301` (pid del main) — es la bandera de la prueba, no de la app |
| **Sin** `--remote-debugging-port` (app en reposo, sin agente)                                       | 4 procesos: main, gpu, utility, renderer                                                                                                           | **ninguno** (`Get-NetTCPConnection` vacío y `netstat` sin filas)                    |

Salida literal (con bandera): `TCP 127.0.0.1:9301 0.0.0.0:0 LISTENING 42992` (pid del proceso principal). Límite: el escenario sin bandera se midió con la app en reposo, sin agente conectado; los hijos `openspec`/`git` viven milisegundos y no se capturan en una foto del árbol (el árbol con agente sí incluye al agente, que a su vez lanza `openspec` en el paso de archivar).

## 1.11 — «Debug All»

Script: `node test/e2e/fase3-debug-all.mjs` (salida en `test/e2e/captures/fase3-debug-all.log`). Lee los `runtimeArgs`/`env` de «Debug Main Process» de `.vscode/launch.json`, arranca `electron-vite dev --sourcemap` con ellos (renderer en 9301 en vez de 9222 para no chocar) y mide.

| Punto                                                                             | Cómo se comprobó                                                                                                                                                                         | Resultado                                                                                                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron-vite dev` aplica `--sourcemap` y `REMOTE_DEBUGGING_PORT`                | Código de electron-vite 6 (`startElectron`: `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}` solo en dev; `--inspect=${V8_INSPECTOR_PORT}` si se pasa `--inspect`) y la ejecución real | Confirmado. `out/main/index.js.map` se genera con 37 fuentes de `src/main`                                                                   |
| (a) Renderer expuesto por CDP                                                     | `GET http://127.0.0.1:9301/json/list`                                                                                                                                                    | **OK**: `page` `http://localhost:5173/` «OpenSpecControl» (ambas configuraciones)                                                            |
| (b) Inspector del main con la configuración **tal cual** (`--sourcemap`)          | `netstat` en 5858 + `/json/list`                                                                                                                                                         | **No abre ningún puerto de inspector** (5858 cerrado)                                                                                        |
| (b′) Inspector del main con `--inspect` añadido                                   | `/json/list` + `Debugger.enable` por WebSocket                                                                                                                                           | **OK**: target `node`; `Debugger.enable` responde; 475 scripts parseados, entre ellos `…/out/main/index.js` con `sourceMapURL: index.js.map` |
| El config coincide con la guía oficial de electron-vite                           | `ctx7 docs /websites/electron-vite` («Debugging > VSCode»)                                                                                                                               | Idéntico: `runtimeArgs: ["--sourcemap"]`, `env.REMOTE_DEBUGGING_PORT=9222`, compuesto «Debug All»                                            |
| Pulsar «Debug All» en VS Code y que el depurador se conecte al main y al renderer | —                                                                                                                                                                                        | **No verificable aquí**                                                                                                                      |

**Decisión sobre `.vscode/launch.json`: no se modifica.** El worker anterior había añadido `--inspect` (cambio sin commitear) con el argumento de que sin él el main no tiene dónde conectarse. Lo medí: es cierto que, sin él, **no hay puerto de inspector TCP**. Pero «Debug Main Process» es una configuración `node`/`launch`: js-debug engancha los procesos hijos (aquí Electron) inyectando su propio bootloader por `NODE_OPTIONS`, sin necesitar un puerto fijo, y esa es la configuración que documenta electron-vite. No puedo ejecutar js-debug fuera de VS Code (no hay servidor DAP independiente en la instalación), así que **no puedo demostrar ni que la config actual falle ni que `--inspect` no entre en conflicto con el bootloader**. Con esa incertidumbre preferí no cambiar una configuración documentada y presumiblemente funcional. Revertí el cambio del worker anterior (`git checkout .vscode/launch.json`).
**Acción para quien tenga VS Code:** pulsar F5 sobre «Debug All» y poner un breakpoint en `src/main/index.ts`; si el main no se engancha, añadir `"--inspect"` a `runtimeArgs` (verificado aquí que con esa bandera el inspector del main en 5858 lista el script con sourcemap) o usar una configuración `attach` al 5858.

Notas de la medición: `electron-vite dev` termina con código 3 si se sustituye `USERPROFILE` (por eso el script no aísla `HOME`; evita leer el `~/.openspec-studio` real dejando en `OSC_DATA` un marcador `imported-from-studio.json` previo), y exige un `--user-data-dir` propio (vía `ELECTRON_CLI_ARGS`) porque la app tiene bloqueo de instancia única y sale sola si otra OpenSpecControl comparte el `userData`.

## Bugs encontrados

1. **Bug real (corregido): la importación dejaba archivos en el origen de Studio.** `importFromStudio` abre `studio.db` en solo lectura, pero en una base en modo WAL una conexión de solo lectura no puede limpiar al cerrarse y deja `studio.db-shm` (y un `-wal` de 0 bytes) junto a la base de Studio. Contradice «el origen queda intacto». Detectado por el worker anterior; yo lo reconfirmé (el test de regresión falla con la versión de `HEAD` y pasa con el arreglo) y corregí un defecto de su arreglo: comparaba nombres relativos del `Set` con rutas absolutas, de modo que **borraba también un `-shm`/`-wal` vacío que ya existía** (Studio abierto). Ahora solo se retira lo que la importación creó y nunca un `-wal` con contenido.
2. Observaciones sin cambio de código: `hasOpenSpec()` es «existe `openspec/`», así que durante `openspec init` el repo se reporta como inicializado antes de que el CLI termine de escribir (el script espera a `config.yaml` y `.claude/`); y `window.osc.review()` solo sirve para cambios activos (tras archivar hay que leer la db).

## Cambios fuera del alcance (`src/**`)

- `src/main/core/legacy-import.ts`: `removeOurSidecars()` retira los `-shm`/`-wal` que la importación creó en el origen (arreglo mínimo del bug 1; rutas absolutas en el conjunto de «ya existían»).
- `test/main/legacy-import.test.ts`: 3 tests de regresión — sin `-shm`/`-wal` residuales tras importar una base WAL; no se borra un `-wal` preexistente con contenido; no se borra un `-shm`/`-wal` vacío preexistente (este último falla con la versión errónea del arreglo).

## Archivos tocados

- Nuevos: `test/e2e/fase3-walkthrough.mjs`, `test/e2e/fase3-acp-agent.mjs`, `test/e2e/fase3-debug-all.mjs`, `test/INFORME-VERIF-FASE3.md`, `test/e2e/captures/fase3-1…8-*.png`, `fase3-walkthrough.log`, `fase3-debug-all.log`.
- Modificados: `src/main/core/legacy-import.ts`, `test/main/legacy-import.test.ts`.
- `.vscode/launch.json`: sin cambios (revertido).
- Eliminado: `test/e2e/fase3-interactive.mjs` (lanzador del worker anterior que importaba el script del recorrido y lo ejecutaba como efecto secundario).

## Verificación final

`npm run typecheck` (0 errores), `npm run lint` (0 errores), `npm test` (59 archivos, 434 tests pasados, 3 omitidos), `npx electron-vite build` (OK), `node test/e2e/fase3-walkthrough.mjs` (17/17), `node test/e2e/fase3-debug-all.mjs` (OK).

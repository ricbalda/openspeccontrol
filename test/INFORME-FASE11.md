# Informe de la Fase 11 — verificación funcional

Rama `migrate-to-electron-desktop-w7-fase11`. Todo lo medido se ejecutó el 2026-11-19 en
**Windows 11 Pro (10.0.26300, x64)**, Intel Core i7-1355U (12 hilos), 32 GB de RAM, Node 26.13.1,
Electron 45.3.4, OpenSpec CLI 2.0.0, agent-browser 0.41.0. Son resultados reales de esta máquina:
no se ha extrapolado nada a macOS ni a Linux.

## Resumen por tarea

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| 11.1 Tests del núcleo y del renderer conservados | **Hecha en Windows**, con una excepción: `changes-cache` se omite en Windows (ver abajo). «En los 3 sistemas» solo lo puede acreditar la matriz de CI | [INVENTARIO-TESTS.md](INVENTARIO-TESTS.md) |
| 11.2 Tests nuevos de cada fase | **Hecha**: `osc-core` (9), `legacy-import` (5), `ipc` (18), `updater` (21), `shell-env` (13), `tools` (5) existen y pasan; no faltaba ninguno | [INVENTARIO-TESTS.md](INVENTARIO-TESTS.md) |
| 11.3 E2E de humo por CDP | **Hecha**: 9/9 pasos, con captura | `test/e2e/smoke.mjs`, `test/e2e/captures/` |
| 11.4 Matriz manual 3 SO × 4 agentes | **No ejecutable aquí**: checklist preparada, todo «no ejecutado» | [MATRIZ-MANUAL.md](MATRIZ-MANUAL.md) |
| 11.5 Rendimiento | **Sesión de >2000 eventos: dentro de umbral, tras corregir un bug real** (antes: página congelada ~80 s). **Rail: cumple con holgura** (tarea 11.5 «rail perf», medido «antes/después» con 7 ejecuciones): pinta 40 cambios en mediana 323 ms (máx. 594 ms; antes mediana 1862 ms) y el refresco en frío baja de ~2,7 s a ≤ 255 ms; la vista validada del CLI llega en segundo plano a los ~2–3 s, marcada «calculando» mientras tanto (sección 11.5-A) | secciones 11.5 y `test/e2e/perf-results-*.json` |
| 11.6 Aceptación | **No cumplida** (depende de 11.4) | [MATRIZ-MANUAL.md](MATRIZ-MANUAL.md) |

## Bugs encontrados y arreglados (cambios fuera de `test/` y `scripts/`)

Ambos arreglos son mínimos, y cada uno lleva su test de regresión.

### 1. `src/renderer/src/store.ts` — una sesión de >2000 eventos congelaba la página

- **Síntoma.** Con un turno que emite 2500 eventos (lo que hace un Build o una revisión largos),
  la ventana quedó sin responder **82 s**: el latido de timers de la página se paró 72 s, las
  consultas por CDP y por IPC expiraron y el contador de eventos solo avanzó al final.
- **Causa.** `onServer` aplicaba cada evento al store al llegar (`set({ events: appendEvent(...) })`);
  cada cambio rehacía `fold(events)` y repintaba la transcripción entera (cientos de tarjetas de
  herramienta o un mensaje de Markdown cada vez más largo). ~30 ms por evento × 2500 = ~80 s. Ninguna
  tarea suelta pasaba de 103 ms, así que el observador de `longtask` del navegador **no lo
  detecta** (198 tareas largas, 1,2 s «bloqueados» sobre una parada real de 72 s): hay que medir
  el hueco de un latido de timers.
- **Arreglo.** Los eventos se acumulan y se aplican en un solo cambio del store cada 80 ms
  (`EVENT_BATCH_MS`); `user`, `permission`, `elicitation` y `turn_end` vacían el búfer al instante
  (las decisiones y el fin de turno se ven sin esperar); un `replay` o un cambio de repo descarta el
  búfer del log anterior. Orden y ventana de 2000 eventos no cambian.
- **Test.** `test/renderer/event-batching.test.ts` (6 casos: una ráfaga de 2500 = un solo cambio del
  store, orden entre ráfagas, vaciado inmediato, replay, cambio de repo, otros repos).

### 2. `src/main/core/acp/hub.ts` — parar un agente a propósito dejaba un error «exited (code 1)»

- **Síntoma.** Al detener, reconectar o cambiar de agente, el log (y la transcripción) recibía
  `«<agente> exited (code 1).»` como **error**. Además, al cerrar la app el aviso llegaba con la base
  de datos ya cerrada y lanzaba `database not opened` sin capturar en el proceso principal (lo vio
  Vitest como «Unhandled Error» en el benchmark del core).
- **Causa.** En Windows el árbol de procesos se mata con `taskkill /F`, que sale con código 1; el
  manejador de `exit` trataba cualquier código distinto de 0 como una caída. En POSIX, `SIGKILL`
  da código `null` y no se notaba.
- **Arreglo.** `AgentSession.stop()` marca `stopping = true` y el manejador de `exit` no avisa si la
  parada fue nuestra (3 líneas).
- **Test.** `test/main/hub-stop.test.ts` (parar y comprobar que no hay avisos de error).

## 11.1 y 11.2 — listado verificable

`node scripts/test-inventory.mjs --check` ejecuta Vitest (proyectos `main` y `renderer`), cruza el
resultado con las listas de `tasks.md` y regenera [INVENTARIO-TESTS.md](INVENTARIO-TESTS.md). Sale con
código 1 si falta, falla o queda vacío algún test exigido. Resultado:

```
[inventario] 355 pasan, 0 fallan, 3 omitidos
[inventario] NO VERIFICADO en este SO:
  - test/main/changes-cache.test.ts: todo omitido en este SO (describe.skipIf(process.platform === 'win32')…)
[inventario] OK: todos los tests exigidos por 11.1 y 11.2 existen, ejecutan casos y pasan
```

- Ningún test de 11.2 faltaba, así que no hubo que escribir ninguno para esa tarea (los 9 casos
  nuevos de esta fase son de los dos arreglos y de 11.5).
- `specMarkup` del renderer es `.test.tsx` (el inventario acepta `.ts` y `.tsx`).
- `workspace` sin `browse`: `test/main/workspace.test.ts` no menciona `browse`.
- **Actualización (tarea 11.5 «rail perf»):** `changes-cache.test.ts` ya corre en Windows (4 casos; el
  CLI falso es un script node tras un shim `.cmd`) y se añadieron tests que no dependen de ningún
  shell. `INVENTARIO-TESTS.md` (generado) no se ha regenerado: su fila de `changes-cache` es anterior.
- **No verificado en Windows (estado de la Fase 11 original):** `changes-cache.test.ts` se omitía entero en Windows
  (`describe.skipIf(process.platform === 'win32')`: usa un `openspec` falso de shell). Su resultado
  depende de la CI en macOS/Linux. Tampoco se ejecuta `wsl-unc.test.ts` (2 casos) por no haber un
  recurso `\\wsl.localhost\…` configurado en esta máquina.
- «En los 3 sistemas» (11.1) se acredita con la matriz de CI de la Fase 10 en verde; aquí no se ha
  podido comprobar.

## 11.3 — E2E de humo (`test/e2e/smoke.mjs`)

```bash
npx electron-vite build
node test/e2e/smoke.mjs            # requiere agent-browser en el PATH; CDP en 9222 (CDP_PORT)
```

Lanza `electron . --remote-debugging-port=9222` con `REPOS_ROOT` apuntando a un repo de demo recién
creado (`scripts/demo-repo.mjs`) y `OSC_DATA` temporal, lo maneja con `agent-browser` (sesión propia)
y borra todo al terminar. Cada paso comprueba algo observable, no solo que el clic no falle:

| Paso | Qué comprueba | ms |
| --- | --- | ---: |
| arranque | `#root` pintado; existe `window.osc`; **no** existe `window.api` | 269 |
| rail | `repos()` devuelve solo `hello-app`; el rail muestra `add-hello-endpoint` en «In review» | 1435 |
| abrir cambio | el visor pinta «Proposal: Add hello endpoint» | 1287 |
| comentario | selección → barra flotante → **Comment** → texto → **Add comment**; la db (vía `window.osc.review`) guarda 1 comentario con cuerpo, archivo `proposal.md` y ancla `GET /api/v1/helloworld` | 708 |
| recargar | la ventana recarga y recuerda el repo | 720 |
| comentario anclado | tras recargar: sigue en la db, no está huérfano, aparece su tarjeta y el texto sigue resaltado (CSS Custom Highlight) | 1325 |
| tema | rota system → light → dark; `data-theme`, `localStorage` y el color de fondo cambian (`rgb(247,247,248)` → `rgb(17,17,20)`) | 611 |
| captura | `test/e2e/captures/smoke-2-final-oscuro.png` (>10 KB) | 210 |
| sin errores | `agent-browser errors` vacío (comprobado que sí detecta una excepción provocada) | 64 |

Resultado de la ejecución final: **9/9 pasos OK**. Capturas: `smoke-1-comentario.png` (justo tras
crear el comentario) y `smoke-2-final-oscuro.png` (tema oscuro tras recargar).

Decisiones y observaciones:

- **Aislamiento de `HOME`/`USERPROFILE`.** La app importa en lectura el `~/.openspec-studio` real si
  existe (Fase 2). En esta máquina la primera ejecución mostró el repo de un Studio instalado
  («RS1MP»); no hay variable de entorno para desactivar la importación, así que el E2E (y `perf.mjs`)
  apunta `HOME` y `USERPROFILE` a un directorio temporal. El `ci-smoke.mjs` de la Fase 10 no lo hace
  (solo comprueba que carga).
- **Reintento al abrir el cambio.** La primera versión del E2E falló una vez (de ~5 ejecuciones): tras
  recargar, el clic sobre el cambio no abrió el visor en 20 s. No se encontró causa en la app (sospecha:
  clic durante el repintado de la lista); el script reintenta el clic cada segundo. Desde entonces
  4/4 ejecuciones limpias. Si reaparece sin reintento, merece investigarse.
- **Barra de comentarios.** El selector `button[title="Comment"]` coincide primero con los botones
  ocultos de reacción por bloque; el script usa el de la barra flotante (`div[data-ui].absolute`).
- **Diseño, no bug:** con la ventana por defecto (~1266 px) el área del documento mide <760 px, y
  `DocReview` pasa a modo estrecho: los comentarios anclados salen en «Notes» (con su cita) en lugar de
  en el margen. El resaltado del texto sí está.
- La CI no ejecuta este E2E (necesita `agent-browser`); el `ci-smoke.mjs` de la Fase 10 sigue siendo
  el único arranque de prueba automático.

## 11.5 — Rendimiento (`test/e2e/perf.mjs`, `test/main/perf-*.test.ts`)

```bash
npx electron-vite build
node test/e2e/perf.mjs                # base grande por defecto; escribe test/e2e/perf-results-40-cambios.json
PERF_CHANGES=20 node test/e2e/perf.mjs
```

Requiere agent-browser, el CLI `openspec` y Node ≥ 22.18 (importa `src/main/core/db.ts` para sembrar la
base con el esquema real). Variables: `PERF_CHANGES`, `PERF_ARCHIVED`, `PERF_SPECS`, `PERF_REPOS`,
`PERF_COMMENTS`, `PERF_EVENTS`, `CDP_PORT`, `KEEP_TMP=1`.

### A) Rail con una base grande — **cumple con holgura: pinta 40 cambios en ~0,3 s (antes ~1,9 s)**

Base: un repo con **40 cambios activos** (todos con `.openspec.yaml`, propuesta, diseño, spec delta y
tareas), 120 archivados y 25 specs, 60 repos más en `REPOS_ROOT`, **3000 comentarios** y **200 rondas**
en la db. «Primera carga» = clic en el repo hasta que el rail pinta los 40 cambios; «refresco en
frío» = `window.osc.changes()` tras tocar un archivo bajo `openspec/` (invalida la caché por firma de
artefactos).

**Metodología de la ronda 3 (tarea 11.5 «rail perf»).** «Antes» y «después» medidos por el mismo
agente, en la misma máquina y el mismo día (2026-11-19), con el mismo `perf.mjs` y puerto CDP 9303: el
«antes» es `HEAD` (`b2d470c`) exportado a un directorio temporal y construido aparte; el «después» es
este árbol. Ejecuciones secuenciales (nunca dos a la vez). Las ejecuciones en que Chromium estranguló
la ventana (hueco de timers ≈ 1000 ms con 0 tareas largas: ventana oculta/ocluida; solo afecta a la
sección B) se repitieron: pasó en torno a 1 de cada 4 ejecuciones (también en el «antes»: 1 de 7 con
40 cambios y 1 de 2 con 2). Las tablas incluyen solo ejecuciones con la ventana visible; el rail se
mide en el mismo ciclo, pero esas ejecuciones no se usan como evidencia.

**Antes** (`HEAD`; `changes()` esperaba a las tres llamadas paralelas del CLI: `list`,
`status --all`, `validate`):

| Cambios | Ejecuciones | Primera carga (ms) | `changes()` en frío (ms) |
| ---: | ---: | --- | --- |
| 40 | 7 | 1633 · 1640 · 1811 · 1862 · 2121 · 2367 · **2789** (mediana **1862**) | 2037–4714 (21 medidas, mediana **2652**) |
| 20 | 2 | 1367 · 1687 | 1574–2072 |
| 2 | 2 | 1154 · 1621 | 1031–2156 |

**Diseño aplicado** (combinación de las dos opciones del informe original):

1. **Pintado progresivo con inferencia local.** Lo que `openspec list` y `openspec status` calculan
   para el esquema por defecto (`spec-driven`) es función pura de los archivos: progreso de tareas =
   contar casillas de `tasks.md` (misma expresión regular que el CLI, `task-progress.js` 2.0.0), estado
   de artefactos = existencia de archivos sobre el grafo proposal → specs/design → tasks, y
   `lastModified` = mtime más nuevo. `changes()` deriva esa vista en ~100 ms (40 cambios) y responde ya;
   el rail pinta al instante con la marca visible «Checking changes with the openspec CLI…».
   `validate` es lo único no inferible: la vista provisional lleva `validation: null` y **ningún cambio
   aparece «ready» sin validar** (la etapa se recorta a «review» mientras la vista no esté confirmada).
   Un esquema distinto de `spec-driven` (carpeta `openspec/schemas/`, `schema:` ajeno en `config.yaml`
   o en el `.openspec.yaml` del cambio) desactiva la inferencia del grafo (sin inventar): esos cambios
   salen sin chips hasta que el CLI responde.
2. **stale-while-revalidate persistente.** La última vista confirmada del CLI se guarda por repo en la
   db de la app (tabla `cli_views`, en `OSC_DATA`, nunca en el repo del usuario) junto a la firma de
   artefactos con la que se calculó. Misma firma ⇒ misma respuesta del CLI: tras reiniciar la app el
   rail pinta ya confirmado, sin arrancar procesos.
3. **Refresco en segundo plano.** Con firma distinta, `changes()` responde la inferencia y el core
   lanza (una vez por repo, deduplicado) las tres llamadas del CLI **300 ms después** (así no compiten
   por CPU con el propio pintado: sin el diferido la primera carga variaba 303–1077 ms en 10
   ejecuciones; con él, 271–594 ms). Al terminar emite el mensaje nuevo `changes_updated` (en
   `protocol.ts`) y el renderer vuelve a pedir: la vista confirmada sustituye a la inferida. Si el CLI
   falla, el aviso «Couldn't confirm with the openspec CLI — showing local state» sustituye al
   indicador, y un *backoff* de 15 s impide el bucle mensaje → refetch → respawn con un CLI roto.

La invalidación existente no cambia: el vigilante de archivos y la firma de artefactos siguen
mandando; escribir el historial de revisión (`.openspeccontrol-review.json`) sigue sin disparar el CLI.

**Después** (este árbol, mismas condiciones):

| Cambios | Ejecuciones | Primera carga (ms) | Vista confirmada por el CLI (ms) | `changes()` en frío (ms) | en caliente (ms) |
| ---: | ---: | --- | --- | --- | --- |
| 40 | 7 | 271 · 277 · 304 · 323 · 394 · 456 · **594** (mediana **323**) | 2033–3238 (med. 2213) | 72–255 (21 medidas, med. **140**) | 56–235 |
| 20 | 3 | 171 · 244 · 258 | 1649–2119 | 68–173 | 44–140 |
| 10 | 3 | 121 · 175 · 179 | 1386–1608 | 48–98 | 28–92 |
| 2 | 3 | 114 · 141 · 327 | 1191–2540 | 56–100 | 29–114 |

- «Vista confirmada» = cuánto tarda la vista validada del CLI en sustituir a la inferida (tras el
  clic; con 40 cambios incluye los 300 ms de diferido). La física del CLI (~0,7 s por proceso, más la
  validación) no cambia: lo que cambia es que ya no bloquea el pintado. Mientras tanto el rail es útil
  y está marcado como «calculando», nunca como definitivo. En el refresco en frío, la confirmación
  tardó 1923–3236 ms (mediana 2406).
- Recargar la página con el repo ya confirmado restaura el rail en 859–1631 ms con 40 cambios
  (arranque completo del renderer incluido; se informa, no puntúa).
- Coste síncrono medido en el proceso principal con 40 cambios: firma 17–35 ms, inferencia 80–125 ms,
  `listChanges` 44–64 ms (≈ 200 ms por `changes()` en frío; es lo que domina el «en frío» de arriba).

**Correspondencia con el CLI real.** `test/main/changes-parity.test.ts` compara, con el `openspec`
2.0.0 del PATH, la vista inferida con la del CLI en 7 situaciones (solo propuesta, sin diseño,
planificado sin tareas, en curso con CRLF y marcadores mixtos `[x] [X] [~]`, terminado, `skip_specs`,
solo `tasks.md`): progreso, estado, `lastModified` (±2 s), artefactos y `isPlanningComplete`/`isComplete`
coinciden. Esa prueba cazó un fallo real del diseño anterior: `openspec new change` escribe
`schema: spec-driven` en cada `.openspec.yaml` y la inferencia lo tomaba por «esquema propio», así que
en cambios reales no habría inferido ningún artefacto (la fixture de `perf.mjs` no creaba ese archivo y
no lo detectaba; ahora sí lo crea).

**Veredicto: cumple con holgura.** Primera carga de 40 cambios: mediana 323 ms, máximo 594 ms en 7
ejecuciones (objetivo < 1,2 s, umbral 2 s). Refresco en frío: máximo 255 ms. Lo que sigue por encima de
1 s es solo la confirmación del CLI en segundo plano (2,0–3,2 s con 40 cambios). Matices honestos:
(1) durante esos ~2 s el rail muestra el estado «calculando»: sin validación y con las etapas
recortadas a «review»; (2) un esquema propio del repo no tiene chips de artefactos hasta que el CLI
responde; (3) la inferencia solo es exacta para `spec-driven`: un esquema global de usuario que
sobrescriba `spec-driven` por nombre no se detecta (se corregiría solo al llegar el CLI, ≈ 2 s);
(4) medido solo en Windows 11 con una CPU de portátil; en macOS/Linux no se ha medido.
Resultados por ejecución en `test/e2e/perf-results-{2,10,20,40}-cambios.json` (campo `runs`; el resto
del archivo es la última ejecución). Prueba visual (agent-browser por CDP 9303, sesión `perf13`, 40
cambios): marca «calculando» a los 193 ms con los 40 cambios pintados, desaparece a los 1447 ms al
confirmar el CLI; abrir un cambio muestra su propuesta; sin errores de consola/página; capturas
`test/e2e/captures/rail-40-calculando.png` y `rail-40-confirmado-cambio-abierto.png`.

### B) Sesión de más de 2000 eventos — **cumple tras el arreglo 1**

El agente falso (`test/e2e/fake-acp-agent.mjs`, dado de alta en `agents.json`) emite 2500 `session/update`
(texto y herramientas) por el camino real: hub → db → IPC → store → transcripción. Una sonda en la página
registra tareas largas, el hueco máximo de un latido de timers y la latencia IPC. Criterio: hueco
máximo de timers ≤ 500 ms y tarea más larga ≤ 250 ms (a partir de 200–500 ms la interacción se siente
congelada).

| | Eventos | Duración | Hueco máx. de timers | Tarea más larga | IPC mediana / p95 / máx |
| --- | ---: | ---: | ---: | ---: | --- |
| **Antes del arreglo** (`mixed`) | 2502 | **81 975 ms** | **71 995 ms** | 103 ms (198 largas) | 1 / 79 226 / 81 793 ms |
| Antes, solo herramientas | 2502 | 71 s | 66,6 s | – | – |
| Antes, solo texto | 2502 | 123 s | 118,8 s | – | – |
| **Después** (ejecución final) | 2502 | **2 952 ms** | **123 ms** | 75 ms (7 largas) | 391 / 2 734 / 2 936 ms |
| Después (otras 4 ejecuciones) | 2502 | 2 023–2 490 ms | 118–131 ms | 60–73 ms | – |
| Replay de 2000 al re-suscribirse | 2000 | 85 ms en llegar | 50 ms | 0 ms | – |

- Línea base sin carga: hueco de timers de 7 ms.
- La latencia IPC «después» (≈ 2–3 s en el p95) **no es un bloqueo**: una consulta enviada en mitad de
  la ráfaga espera detrás de los ~2500 mensajes ya encolados; el core en Node, medido solo (abajo),
  nunca retrasa el bucle más de 6 ms. Se informa pero no puntúa.
- Una ráfaga de 2500 eventos ahora termina en ≈ 2–3 s con la página fluida (hueco máx. 123 ms ≪ 500 ms).
- El trabajo por evento en el proceso principal es ≈ 0,8–1 ms (una transacción SQLite con `fsync` por
  alta; con `PRAGMA synchronous = NORMAL` serían ≈ 0,07 ms). No se ha tocado: es una decisión de
  durabilidad de la db, y 2500 altas repartidas en segundos no bloquean (ver benchmark).

**Regresión tras el cambio del rail (tarea 11.5 «rail perf»)**, mismas ejecuciones que las tablas de A
(solo ventana visible): con 40 cambios y el código final, 2500 eventos en 2174–3306 ms (mediana 2704;
«antes» con el mismo `perf.mjs` en `HEAD`: 2383–3456, mediana 2906 en las 6 de 7 marcadas «visible»), hueco
máximo de timers 97–171 ms (antes 49–267 ms; dos de las siete ejecuciones del «antes» dieron ~1000 ms
por estrangulamiento de la ventana) y tarea más larga 50–155 ms (antes 0–135 ms): no empeora de forma
apreciable y sigue muy por debajo de los umbrales (500 ms / 250 ms).

### Benchmarks sin Electron (corren en `npm test`)

- `test/main/perf-core.test.ts`: 2500 eventos por hub → db → suscriptor con un agente falso, midiendo el
  retardo del bucle de eventos con `monitorEventLoopDelay`: **2503 eventos en 2253 ms (0,90 ms/evento),
  retardo máximo del bucle 6 ms**. Umbrales de la prueba, holgados por la CI: bucle < 1 s, total < 30 s,
  y el replay entrega 2000 entradas.
- `test/main/perf-events-log.test.ts`: 2500 altas en la db (≈ 0,8–1 ms/alta) y replay de 2000 en 3–4 ms.

## Archivos

Nuevos, dentro del alcance: `test/e2e/{lib,smoke,perf,fake-acp-agent}.mjs`, `test/e2e/captures/*.png`,
`test/e2e/perf-results-{2,10,20,40}-cambios.json`, `test/INVENTARIO-TESTS.md` (generado),
`test/MATRIZ-MANUAL.md`, este informe, `scripts/test-inventory.mjs`, y los tests
`test/main/{hub-stop,perf-core,perf-events-log}.test.ts` y `test/renderer/event-batching.test.ts`.

Tarea 11.5 (rail rápido, rondas 2 y 3), dentro del alcance que la tarea da: `src/main/core/{openspec,osc-core,db}.ts`
(inferencia local, refresco en segundo plano diferido 300 ms, tabla `cli_views`, esquema `spec-driven` explícito),
`src/shared/{protocol,ipc}.ts` (mensaje `changes_updated`, campos `stale`/`refreshError` de `OscChanges`),
`src/renderer/src/store.ts` y `src/renderer/src/panes/RepoSection.tsx` (marca «calculando» / aviso de fallo),
`test/e2e/perf.mjs` (mide pintado y confirmación por separado; variables `AB_SESSION` y `PERF_OUT`; la fixture
crea `.openspec.yaml`), `test/e2e/perf-results-{2,10,20,40}-cambios.json` (con el campo `runs`), las capturas
`test/e2e/captures/rail-40-*.png`, y los tests `test/main/{changes-cache,changes-view,osc-changes-refresh,changes-parity}.test.ts`
(`changes-parity` compara la inferencia con el CLI real) y `test/renderer/{changes-stale.test.ts,repoRail-stale.test.tsx}`.

**Fuera del alcance (arreglos mínimos justificados arriba):** `src/renderer/src/store.ts` (+35/−4) y
`src/main/core/acp/hub.ts` (+6/−1). No se ha tocado `openspec/**`, `Docs/**`, `CLAUDE.md` ni
`package.json` (los scripts se ejecutan con `node …`; no se añadieron entradas de `npm run`).

## Observaciones que no son bugs de esta fase

- `config()` lanza 8 procesos hijos (`--version` y `where` de node, npx, openspec y git) en cada
  llamada, sin caché. Hoy solo se llama al arrancar y al abrir el diálogo de diagnóstico; no sirve como
  «ping» ni para llamarlo en bucle (mi primera sonda lo hizo cada 100 ms y saturó la app).
- Los ficheros del worktree están en CRLF (`core.autocrlf`); los parches a `store.ts` y `hub.ts`
  conservan CRLF, de modo que el diff real es el pequeño que se ve arriba.

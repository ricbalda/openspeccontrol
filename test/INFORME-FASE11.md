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
| 11.5 Rendimiento | **Sesión de >2000 eventos: dentro de umbral, tras corregir un bug real** (antes: página congelada ~80 s). **Rail: NO cumple el umbral de 2 s de forma holgada con 40 cambios en frío** (mediana 1,88 s de primera carga, 2,0–3,1 s al refrescar tras un cambio en disco; sí cumple con ≤ 20 cambios) | secciones 11.5 y `test/e2e/perf-results-*.json` |
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
- **No verificado en Windows:** `changes-cache.test.ts` se omite entero en Windows
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

### A) Rail con una base grande — **no cumple el umbral de 2 s con holgura**

Base: un repo con **40 cambios activos** (todos con propuesta, diseño, spec delta y tareas), 120
archivados y 25 specs, 60 repos más en `REPOS_ROOT`, **3000 comentarios** y **200 rondas** en la db.
La primera carga es el clic en el repo hasta que el rail pinta los 40 cambios; arranca el CLI de
OpenSpec (tres llamadas en paralelo: `list`, `status --all`, `validate`).

| Cambios | Primera carga (ms) | `changes()` en frío tras tocar un archivo, 3 medidas (ms) | `changes()` en caliente (ms) | Escaneo de repos (ms) |
| ---: | ---: | --- | --- | --- |
| 40 (7 ejecuciones) | 1834 · 1842 · 1871 · 1881 · 1950 · 1974 · **2216** (mediana **1881**) | 2004–3066 (mediana ≈ 2400) | 45–96 | 4–8 |
| 20 | 1401 | 1380 · 2070 · 1726 | 35–43 | 4–5 |
| 10 | 1269 | 1111 · 1681 · 1518 | 35–38 | 5–6 |
| 2 (base mínima) | 935 | 883 · 1250 · 1188 | 5–8 | 1–2 |

Lectura: con 40 cambios la primera carga queda en torno a 1,9 s (6 de 7 ejecuciones por debajo de 2 s,
con un margen de apenas 6 %, y una a 2,2 s) y el refresco tras un cambio en disco supera 2 s; con ≤ 20
cambios y en las recargas con caché (≈ 50 ms) cumple con holgura. **El tiempo es del CLI de OpenSpec,
no de la app**: las tres llamadas juntas tardan 1,84 s sobre esa misma base (`openspec --version` solo
ya cuesta ≈ 0,2 s en esta máquina) y lo demás (comentarios, specs, IPC y pintado) suma ~0,05–0,1 s.
Veredicto honesto: umbral **no demostrado** para una base de 40 cambios en frío; no es un bug que se
arregle con un cambio mínimo.
Opciones para decidir (no aplicadas): persistir la última vista del CLI y pintarla enseguida mientras
se refresca (stale-while-revalidate), o pintar con `list` y completar `status`/`validate` después.

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

### Benchmarks sin Electron (corren en `npm test`)

- `test/main/perf-core.test.ts`: 2500 eventos por hub → db → suscriptor con un agente falso, midiendo el
  retardo del bucle de eventos con `monitorEventLoopDelay`: **2503 eventos en 2253 ms (0,90 ms/evento),
  retardo máximo del bucle 6 ms**. Umbrales de la prueba, holgados por la CI: bucle < 1 s, total < 30 s,
  y el replay entrega 2000 entradas.
- `test/main/perf-events-log.test.ts`: 2500 altas en la db (≈ 0,8–1 ms/alta) y replay de 2000 en 3–4 ms.

## Archivos

Nuevos, dentro del alcance: `test/e2e/{lib,smoke,perf,fake-acp-agent}.mjs`, `test/e2e/captures/*.png`,
`test/e2e/perf-results-{10,20,40}-cambios.json`, `test/INVENTARIO-TESTS.md` (generado),
`test/MATRIZ-MANUAL.md`, este informe, `scripts/test-inventory.mjs`, y los tests
`test/main/{hub-stop,perf-core,perf-events-log}.test.ts` y `test/renderer/event-batching.test.ts`.

**Fuera del alcance (arreglos mínimos justificados arriba):** `src/renderer/src/store.ts` (+35/−4) y
`src/main/core/acp/hub.ts` (+6/−1). No se ha tocado `openspec/**`, `Docs/**`, `CLAUDE.md` ni
`package.json` (los scripts se ejecutan con `node …`; no se añadieron entradas de `npm run`).

## Observaciones que no son bugs de esta fase

- `config()` lanza 8 procesos hijos (`--version` y `where` de node, npx, openspec y git) en cada
  llamada, sin caché. Hoy solo se llama al arrancar y al abrir el diálogo de diagnóstico; no sirve como
  «ping» ni para llamarlo en bucle (mi primera sonda lo hizo cada 100 ms y saturó la app).
- Los ficheros del worktree están en CRLF (`core.autocrlf`); los parches a `store.ts` y `hub.ts`
  conservan CRLF, de modo que el diff real es el pequeño que se ve arriba.

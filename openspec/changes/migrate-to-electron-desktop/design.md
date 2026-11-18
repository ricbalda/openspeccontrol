# Design

## Context

Motivación y alcance en `proposal.md`; este documento recoge el **cómo**. Detalle ampliado en `Docs/plan-migracion-electron.md` (secciones 3–5 y 8).

**Origen:** OpenSpec Studio 0.3.1 (`../../openspec-studio`, solo lectura): `server/src/index.ts` (447 líneas: ~20 endpoints REST, WebSocket `/ws`, watcher por repo, arranque), `acp/hub.ts`, `agents.ts`, `db.ts` (`node:sqlite`), `openspec.ts`, `git.ts`, `proc.ts`, `review/*`, `repos.ts`, `workspace.ts`, `schemas.ts`, `security.ts`, `updates.ts`; `web/src` (React 19 + zustand + Tailwind 4); `shared/protocol.ts` y `shared/anchor.ts`.

**Destino:** el scaffold de este repositorio (electron-vite 6, plantilla `react-ts`, Electron 44.7.2, main/preload en CJS, `sandbox: false`, sin git, sin tests), con `openspec/` ya inicializado. Restricciones: `.npmrc` vacío a propósito (npm 12), `allowScripts` para `electron-winstaller`, ESLint + Prettier, Windows como entorno de desarrollo principal.

**Versiones objetivo** (consultadas en npm el 2026-11-18):

| paquete | versión | nota |
|---|---|---|
| `electron` | 45.3.4 | Node 24.22.3, Chromium 156, SQLite 3.54.1 |
| `electron-vite` | 6.0.0 | rolldown (`build.rolldownOptions`); `build.externalizeDeps`; Node `^20.19 \|\| >=22.12` |
| `vite` / `@vitejs/plugin-react` | 8.3.x / 6.x | ya en el scaffold y en `web/` de Studio |
| `electron-builder` | 26.18.0 | empaquetado, firma, notarización, fuses |
| `electron-updater` | 6.8.11 | GitHub Releases |
| Node (desarrollo/CI) | ≥ 22.13 | los tests del núcleo corren `node:sqlite` fuera de Electron |

## Goals / Non-Goals

**Goals:**
- Paridad funcional completa con Studio 0.3.1 (capacidad `core-parity`) sobre IPC, sin puertos de red.
- Núcleo `OscCore` sin dependencia de `electron`, probable con Vitest en Node.
- Producto distribuible y actualizable en Windows, macOS y Linux.
- Migración sin pérdida para usuarios de Studio.

**Non-Goals:**
- Empaquetar Node.js, el CLI `openspec` o los adaptadores de agentes (D9).
- Varias ventanas, modo bandeja, arranque con el sistema, `utilityProcess`, Microsoft Store, Mac App Store, Snap o Flatpak.
- Cambios funcionales en el flujo OpenSpec, la revisión o el protocolo ACP.
- Modificar `../../openspec-studio` o su paquete npm.
- Funciones que el README describe pero Studio no tiene: entrega a Orca con worktrees por cambio, tablero multi-cambio con detección de actividad, escritura de estado en Orca y detección de solapes. Son cambios posteriores; este entrega solo la paridad con Studio 0.3.1.

## Decisions

Las decisiones D1–D11 ya fueron tomadas (plan, sección 2); aquí se registran con su motivo y la alternativa descartada.

| # | Decisión | Motivo | Alternativa descartada |
|---|---|---|---|
| D1 | Solo escritorio: sin modo web, servidor HTTP/WS ni CLI npm. | Un único producto y un único transporte. | Web + escritorio con dos adaptadores. |
| D2 | Transporte por IPC (`contextBridge` + `ipcMain.handle` + `webContents.send`); sin puerto. | Elimina la superficie de red; `security.ts` deja de ser necesario. | Cargar el servidor actual en localhost. |
| D3 | Núcleo en el proceso main, en módulos que no importan `electron`. | Carga ligera; se prueba en Node y puede pasar a `utilityProcess` sin reescribirse. | `utilityProcess` desde el inicio. |
| D4 | Se mantiene `node:sqlite`. | Verificado en Electron 45.3.4; sin módulos nativos ni `@electron/rebuild`. | `better-sqlite3`. |
| D5 | Datos propios en `~/.openspeccontrol` con importación única desde `~/.openspec-studio` (origen intacto). | Identidad propia sin perder datos de Studio. | Compartir `~/.openspec-studio`; empezar de cero. |
| D6 | electron-builder 26 (NSIS, dmg + zip, AppImage + deb), firma y notarización, electron-updater 6 con GitHub Releases `ricbalda/openspeccontrol`. | Tres plataformas con auto-update. | Solo aviso de nueva versión. |
| D7 | Estructura estándar de electron-vite en un solo `package.json`; código copiado desde Studio (sin `git mv`), núcleo extraído directamente aquí. | Configuración mínima; Studio queda intacto como referencia. | Migrar dentro del repo de Studio; mantener `server/` y `web/`. |
| D8 | main en ESM, preload en CJS con `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. | Un preload con sandbox no puede ser ESM; hay que forzar `format: 'cjs'` (genera `index.cjs`). | Preload ESM con `sandbox: false`. |
| D9 | Node.js del sistema sigue siendo requisito externo; la app lo detecta y lo explica. | `openspec` y los adaptadores `npx` se instalan y autentican fuera de la app. | Empaquetarlos. |
| D10 | Prefijo `osc` para API, canales, clases y variables. | Corto y alineado con el nombre. | `openSpecControl` (largo), `control` (genérico). |
| D11 | ESLint + Prettier del scaffold; sin Biome. | Ya configurados y documentados en `CLAUDE.md`. | Adoptar Biome de Studio. |

**Nombres derivados del nombre de la app** (OpenSpecControl):

- **Dos carpetas distintas.** `~/.openspeccontrol` guarda los datos de la app (D5); el `userData` de Electron (`%APPDATA%\OpenSpecControl` o equivalente, derivado de `productName`) guarda caché y `Local Storage`. `productName` va fijado en `package.json` para que ese nombre no dependa del momento en que se llame a `app.setName`.
- **Instaladores con el nombre visible:** `${productName}-${version}-setup.exe`, `.dmg` y `.AppImage` (el `.deb` conserva la convención de Debian en minúsculas).
- **Remoto con historial:** `ricbalda/openspeccontrol` ya tiene un `Initial commit` con el `LICENSE`; el repositorio local se engancha encima (`checkout -b main --track origin/main`) para mantener el historial lineal. Receta verificada en un directorio temporal.
- **Licencia:** `LICENSE` MIT propio (© Ricardo Balda) más `NOTICE` con el aviso MIT de OpenSpec Studio (© Fridayana Baabullah), ambos dentro del paquete.

**Decisiones técnicas del diseño del puente IPC:**

- **Contrato único:** `src/shared/ipc.ts` define `OscApi` con un método por operación, más `send(msg: ClientMsg)` y `onMessage(cb)`. El preload expone una función explícita por método (nunca un `invoke` genérico). *Por qué:* limita la superficie que un renderer comprometido puede alcanzar.
- **Envelope de errores:** cada handler devuelve `{ ok: true, data } | { ok: false, error: { code, message } }` y el preload convierte `ok: false` en `throw new Error(message)`. *Por qué:* Electron reescribe los mensajes de las excepciones lanzadas en `ipcMain.handle` ("Error invoking remote method…"). Los códigos (`invalid`, `not_found`, `conflict`, `too_large`, `internal`) sustituyen a 400/404/409/413/500.
- **Suscripciones por `webContents.id`** (antes por `WebSocket`), limpiadas en `did-start-navigation`, `destroyed` y `render-process-gone`; el watcher de `<repo>/openspec` está activo mientras haya un suscriptor o una sesión de agente.
- **Validación del emisor** (`isTrustedSender`): solo `mainWindow.webContents`, desde su `mainFrame`, con origen `ELECTRON_RENDERER_URL` (desarrollo) o el `index.html` empaquetado.
- **Validación de argumentos** con los esquemas zod existentes (`parseOr400` → `parseOrThrow` con `OscError`).
- **Estado en el main, no en el renderer:** una recarga se recupera con `replay`; se elimina el badge "server offline" y la reconexión con backoff.

**Arquitectura objetivo:**

```
Renderer (React 19 + zustand, sandbox, contextIsolation)
   │  window.osc.*  (preload/index.cjs vía contextBridge)
   ▼
Preload (CJS) ── ipcRenderer.invoke('osc:<método>') / send('osc:client-msg') / on('osc:server-msg')
   ▼
Main (ESM)
   ├─ index.ts    ciclo de vida: instancia única, ventana, menú, cierre seguro, tema
   ├─ ipc.ts      1 handler por método · valida emisor · valida con zod · envelope {ok,data}|{ok:false,error}
   ├─ desktop/    window-state, menu, notifications, updater, shell-env, tools, demo-repo
   └─ core/       OscCore (sin `electron`): hub ACP, openspec CLI, git, workspace, review, db, legacy-import
        └─ procesos hijo: agentes ACP (stdio, cwd = repo), `openspec --json`, `git`  (cross-spawn / killTree)
```

**Estructura de carpetas:** `src/main/{index.ts, ipc.ts, core/, desktop/}`, `src/preload/`, `src/renderer/{index.html, src/}`, `src/shared/{protocol.ts, anchor.ts, ipc.ts}`, `test/main/`, `test/renderer/`, `scripts/`, `build/`, `resources/`, `Docs/`, `openspec/`. Se conservan `main`/`preload`/`renderer` porque son las rutas por defecto de electron-vite.

**Mapa de módulos** (origen → destino):

| origen (`../../openspec-studio`) | destino | cambio |
|---|---|---|
| `server/src/index.ts` | `core/osc-core.ts` + `ipc.ts` + `index.ts` | solo referencia: la lógica de los handlers pasa a `OscCore`; sin HTTP |
| `acp/hub.ts`, `agents.ts`, `openspec.ts`, `git.ts`, `proc.ts` | `core/…` | sin cambios funcionales; renombres de identidad |
| `db.ts` | `core/db.ts` | `openDb(path)` explícito en lugar de abrir al importar |
| `review/*` | `core/review/…` | `.openspeccontrol-review.json`; lectura de respaldo de `.studio-review.json` |
| `repos.ts`, `workspace.ts` | `core/…` | `STUDIO_DIR` desaparece; `DATA_DIR` explícito; se elimina `browse()` |
| `schemas.ts` | `core/schemas.ts` | valida argumentos IPC |
| — | `core/legacy-import.ts` | nuevo (importación única) |
| `security.ts` | — | no se trae |
| `updates.ts` | `desktop/updater.ts` | se reescribe sobre `electron-updater` |
| `web/src`, `web/index.html` | `src/renderer/` | transporte `fetch`/WS → `window.osc` |

**Qué no se trae:** `hono`, `@hono/node-server`, `ws`, `@types/ws`, `tsx`, `bin/`, `scripts/dev.mjs`, `security.ts` y su test, `web/vite.config.ts`, Biome, workspaces, `update-check.json` y `BrowseResult`/`browse()`.

**Equivalencias navegador → nativo:** explorador de carpetas propio → `dialog.showOpenDialog`; `Notification` del navegador → `Notification` de Electron + `flashFrame` + contador; enlaces → `shell.openExternal` con lista de esquemas; tema → `nativeTheme.themeSource`; aviso de versión nueva → `electron-updater`.

**Diferencias por plataforma:**

| tema | Windows | macOS | Linux |
|---|---|---|---|
| Cierre de la última ventana | cierra la app (con confirmación si hay agentes) | la app y los agentes siguen; `activate` reabre | cierra la app (con confirmación) |
| `PATH` | hereda el del usuario | se lee del shell de login (`$SHELL -ilc`) + rutas conocidas | ídem macOS |
| Contador de pendientes | icono superpuesto (`setOverlayIcon`) | `app.setBadgeCount` | `app.setBadgeCount` |
| Identidad | `setAppUserModelId('io.github.ricbalda.openspeccontrol')` | — | — |
| Instalador | NSIS por usuario, x64 + arm64 | dmg + zip universal, hardened runtime, notarización | AppImage + deb, x64 + arm64 |
| Firma | Azure Trusted Signing o certificado (`CSC_LINK`) | Developer ID + notarización | — |
| Auto-update | sí | sí (requiere el zip) | AppImage sí; deb por confirmar (spike 0.5) |
| Rutas en WSL | `\\wsl$\…` como carpeta de red, con CLIs del lado de Windows | — | polling de chokidar en `/mnt/*` |

**Seguridad (Fase 7):** `webPreferences` con `contextIsolation`, `sandbox`, sin `nodeIntegration`, `webSecurity` y `navigateOnDragDrop: false`; CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'`; permisos denegados salvo `clipboard-sanitized-write`; `will-attach-webview` y ventanas nuevas bloqueados; fuses `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` y `EnableNodeCliInspectArguments` desactivados, `EnableEmbeddedAsarIntegrityValidation` y `OnlyLoadAppFromAsar` activados. Se conservan `repoPath()`, `safeResolve`, `validChange`, `MAX_DOC_BYTES` y `capped()`. Los agentes se lanzan con el `node`/`npx` del sistema, así que no se usa `ELECTRON_RUN_AS_NODE`.

## Risks / Trade-offs

- **`PATH` incompleto al abrir desde el escritorio (macOS/Linux)** → Fase 6 (shell de login, rutas conocidas y diagnóstico visible); validado en el spike 0.4.
- **Trabajo síncrono en el main (SQLite, `openspecSignature`)** → se mide en 11.5; el núcleo no importa `electron` (D3), así que puede pasar a `utilityProcess` sin reescribirse.
- **Firma y notarización (coste, secretos, SmartScreen)** → certificados y secretos antes de la Fase 8; Azure Trusted Signing reduce el coste en Windows.
- **Auto-update de `deb`** → spike 0.5; si no es viable, aviso con enlace al release.
- **Importación desde Studio falla o la base está en uso** → `VACUUM INTO` desde conexión de solo lectura; si falla, se registra y se arranca vacío; se puede reintentar borrando `~/.openspeccontrol`. Tests en 2.9.
- **Studio 0.3.x y OpenSpecControl sobre el mismo repo a la vez** → sesiones de agente duplicadas y comentarios divergentes (la importación es una copia única) → nota de migración (12.4); la instancia única cubre solo OpenSpecControl.
- **Dos archivos de revisión en el mismo cambio** → el antiguo solo se lee si falta el nuevo y nunca se reescribe.
- **Cambio de origen del renderer (`file://` frente a `http://127.0.0.1:3940`)** → se pierden preferencias de `localStorage` (tema, ancho del panel, último repo) → aceptado.
- **HMR de desarrollo con CSP estricta** → se verifica en 7.2; si hace falta, CSP diferenciada para desarrollo.
- **Descarga de ~100 MB frente a ~1 MB por npm** → inherente a Electron; las actualizaciones usan descargas diferenciales (blockmap).
- **Reformateo masivo al pasar a Prettier** → commit propio y sin cambios de lógica (1.8).
- **Trade-off de D3:** el trabajo síncrono del núcleo comparte hilo con la ventana a cambio de menos piezas (sin `MessagePort`, reinicios ni doble ciclo de vida).

## Migration Plan

Orden por fases, cada una deja el repositorio compilando y con los tests en verde:

0. **Spike** (rama `spike/electron-45`): valida los supuestos de riesgo antes de mover código.
1. **Incorporar código de Studio** a la estructura de electron-vite con la identidad de OpenSpecControl.
2. **Extraer `OscCore`** e implementar la importación desde Studio.
3. **Puente IPC** y cambio de transporte en el renderer (sin puertos TCP abiertos).
4–7. **Shell de escritorio, integraciones nativas, entorno de ejecución y seguridad.**
8–10. **Empaquetado y firma, actualización automática y CI/CD.**
11–12. **Verificación funcional completa y documentación** (incluida la nota de migración desde Studio).

**Reversión:** `../../openspec-studio` y `~/.openspec-studio` no se modifican, así que volver a Studio es siempre posible. Dentro de este repositorio se trabaja con git (`git init` en 0.1) y ramas por fase; los releases se publican como borrador antes de hacerse públicos.

## Hallazgos del spike

<!-- Se completa en la tarea 0.6. Registrar por sistema operativo (Windows / macOS / Linux): -->

- **0.2 — main ESM + preload CJS + `sandbox: true`:** _pendiente_
- **0.3 — `node:sqlite` (WAL), `chokidar`, `cross-spawn`, `killTree` en la app empaquetada:** _pendiente_
- **0.4 — `PATH` al lanzar desde Finder/escritorio (nvm/volta/homebrew):** _pendiente_
- **0.5 — auto-update de electron-updater con `deb` en Linux:** _pendiente_
- **Nombre del archivo `main` generado (`index.js` o `index.mjs`):** _pendiente_

## Open Questions

- **Método de firma en Windows:** Azure Trusted Signing (`azureSignOptions`) o certificado (`CSC_LINK`/`CSC_KEY_PASSWORD`). Se decide en la Fase 8 según el certificado disponible; no cambia las specs ni las tareas.
- **Arrastrar y soltar una carpeta sobre la ventana** (`webUtils.getPathForFile`): opcional dentro de 5.2; no afecta a los requisitos.
- **Importar las preferencias de `localStorage`** de Studio: hoy se acepta perderlas; se reconsidera si el feedback lo pide.

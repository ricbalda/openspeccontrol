# Design

## Context

Motivación y alcance en `proposal.md`; este documento recoge el **cómo**. Detalle ampliado en `docsplan/plan-migracion-electron.md` (secciones 3–5 y 8).

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

**Estructura de carpetas:** `src/main/{index.ts, ipc.ts, core/, desktop/}`, `src/preload/`, `src/renderer/{index.html, src/}`, `src/shared/{protocol.ts, anchor.ts, ipc.ts}`, `test/main/`, `test/renderer/`, `scripts/`, `build/`, `resources/`, `docs/`, `docsplan/`, `openspec/`. Se conservan `main`/`preload`/`renderer` porque son las rutas por defecto de electron-vite.

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

Ejecutado en **Windows 11 (osRelease 10.0.26300)** con Electron 45.3.4 (Node 24.22.3, Chromium 156.0.8078.100), electron-vite 6.0.0 (vite 8.3.8), electron-builder 26.18.0, chokidar 6.0.0, cross-spawn 7.0.6 y electron-updater 6.8.11. Cada resultado indica si fue **ejecutado** (en Windows, en dev y en la app empaquetada con `electron-builder --dir`) o solo **documentado** (no hay equipos macOS/Linux disponibles). Evidencia reproducible en el commit `spike(config)` (`src/main/spike-checks.ts` ejecuta las sondas 0.3 y escribe un informe JSON en `OSC_SPIKE_REPORT`).

- **0.2 — main ESM + preload CJS + `sandbox: true`:** **✅ Windows, ejecutado.** Con `"type": "module"` el main se genera en `out/main/index.js` en ESM real (inspeccionado: `import`/`export` en el bundle) y el `main` del `package.json` sigue siendo `./out/main/index.js` (sin cambio). El preload con `build.rolldownOptions.output.format: 'cjs'` genera `out/preload/index.cjs`; se añadió además `build.externalizeDeps: false` porque un preload con sandbox no puede `require` módulos externos (empaqueta `@electron-toolkit/preload` dentro del `.cjs`). `sandbox: true` funciona: el `contextBridge` de prueba `window.osc` (`ipcRenderer.invoke('osc:ping')` + vuelta con `osc:bridge-log`) respondió en `npm run dev` (ventana abierta, dev server en 5173, sin errores) y en la app empaquetada. Nota: se quitó el guard `process.contextIsolated` del preload; con sandbox se usa `contextBridge` siempre. *macOS/Linux: no verificado en equipo real — falta repetir `npm run dev` y `--dir` en ambos; el main ESM es soportado por Electron ≥28 en los tres SO.*
- **0.3 — `node:sqlite` (WAL), `chokidar`, `cross-spawn`, `killTree` en la app empaquetada:** **✅ Windows, ejecutado** (dos informes `allOk: true`: dev `packaged:false` y exe `dist\win-unpacked\openspeccontrol.exe` con `packaged:true`); **⬜ macOS/Linux: documentado, no verificado.**

  | prueba | Windows (ejecutado, dev + empaquetado) | macOS / Linux (documentado; falta verificar en equipo real) |
  |---|---|---|
  | `node:sqlite` con WAL | ✅ `PRAGMA journal_mode` = `wal`, archivos `-wal` y `-shm` creados, los datos persisten tras cerrar y reabrir (Node 24.22.3, sin warning de experimental) | Módulo builtin del mismo Node 24.22.3 que Electron 45 empaqueta en los 3 SO; sin módulos nativos ni `@electron/rebuild` (D4) |
  | `chokidar` 6 | ✅ 6.0.0 detecta el evento `add` en ~35 ms, también desde dentro del asar empaquetado | chokidar 6 es JS puro (única dependencia `readdirp`; ya sin `fsevents` ni nativos) y expone `usePolling` para `/mnt/*` (WSL) |
  | `cross-spawn` | ✅ 7.0.6 lanza y captura `npx --version` (12.2.3), `openspec --version` (2.0.0) y `git --version` (2.51.2.windows.1); en Windows es imprescindible para los shims `.cmd` de npm | En Unix recae en `child_process` nativo (README: cross-platform); los CLIs no son shims `.cmd` ahí, así que el riesgo es menor |
  | `killTree` | ✅ `taskkill /pid <pid> /T /F` terminó `cmd.exe` y sus 2 hijos; verificado con `tasklist /FI "PID eq …"` que ninguno quedó vivo | La rama POSIX (`p.kill()`, SIGTERM al hijo directo) es la misma de Studio `proc.ts`; no ejecutada |

- **0.4 — `PATH` al lanzar desde Finder/escritorio (nvm/volta/homebrew):** **⬜ macOS/Linux: documentado, no verificado — falta lanzar la app empaquetada desde Finder/dock y desde un lanzador `.desktop` y volcar el `PATH`.** La documentación del ecosistema (README de `fix-path`, la solución estándar para Electron en macOS/Linux) indica que las apps GUI **no heredan el `PATH` de los dotfiles** (`.zshrc`, `.bash_profile`, `.bashrc`): macOS lanza las apps GUI desde `launchd` con un `PATH` mínimo (`/usr/bin:/bin:/usr/sbin:/sbin`) y en Linux el lanzador arranca desde el entorno de la sesión (systemd/dbus), no desde un shell de login. En la práctica faltan `~/.nvm/versions/node/*/bin`, `~/.volta/bin`, `/opt/homebrew/bin` y `/home/linuxbrew/.linuxbrew/bin`. **Confirma la necesidad de la Fase 6** (`shell-env.ts`: `$SHELL -ilc` + rutas conocidas + diagnóstico visible).
- **0.5 — auto-update de electron-updater 6.8 con `deb` en Linux:** **⬜ Linux: documentado, no verificado — falta una VM Debian/Ubuntu con dos releases de prueba; la conclusión es «viable con matiz».** Docs oficiales de electron-builder v26 («Auto Update»): targets Linux auto-actualizables = **AppImage, DEB, Pacman y RPM**. Código real de `electron-updater@6.8.11` (la versión que instala el proyecto): al empaquetar un `deb`, electron-builder escribe `resources/package-type` = `deb` y `autoUpdater` carga `DebUpdater` (`out/main.js`); `DebUpdater.doInstall` (`out/DebUpdater.js`) descarga el `.deb` del release y ejecuta `dpkg -i <deb>` (si faltan dependencias reintenta con `apt-get install -f -y`; PM alternativo `apt install -y --allow-unauthenticated --allow-downgrades --allow-change-held-packages`); si no corre como root, envuelve el comando con `pkexec` (o `kdesudo`/`gksudo`/`beesu`/`sudo`) y **muestra un diálogo gráfico de autenticación** («<app> would like to update»), tras lo cual puede relanzar la app. Matiz de diseño: la actualización `deb` no es 100 % silenciosa (prompt de privilegios) y exige publicar el `.deb` en el release junto al AppImage para que `latest-linux.yml` lo exponga; si el prompt no fuera aceptable, queda el plan B del aviso con enlace al release.
- **Nombre del archivo `main` generado (`index.js` o `index.mjs`):** **`out/main/index.js`** en formato ESM (con `"type": "module"` la extensión `.js` ya significa ESM; verificado sobre el bundle generado). El preload se genera como **`out/preload/index.cjs`**. Por tanto: `package.json` → `"main": "./out/main/index.js"` (el valor del scaffold ya es correcto) y `webPreferences.preload` → `join(__dirname, '../preload/index.cjs')`.

## Open Questions

- **Método de firma en Windows:** Azure Trusted Signing (`azureSignOptions`) o certificado (`CSC_LINK`/`CSC_KEY_PASSWORD`). Se decide en la Fase 8 según el certificado disponible; no cambia las specs ni las tareas.
- **Arrastrar y soltar una carpeta sobre la ventana** (`webUtils.getPathForFile`): opcional dentro de 5.2; no afecta a los requisitos.
- **Importar las preferencias de `localStorage`** de Studio: hoy se acepta perderlas; se reconsidera si el feedback lo pide.

## Checklist de seguridad de Electron (Fase 7, tarea 7.7)

Revisión punto por punto de la checklist oficial
(https://electronjs.org/docs/latest/tutorial/security, 20 puntos) sobre el estado real del código:

| # | Recomendación oficial | Estado en OpenSpecControl |
|---|---|---|
| 1 | Solo cargar contenido seguro | ✅ Todo el contenido es local: el `index.html` empaquetado (`loadFile`) o, en desarrollo, el dev server de vite en `localhost`. No se carga ningún recurso remoto; la CSP además prohíbe cualquier origen ajeno. |
| 2 | No activar la integración de Node para contenido | ✅ `nodeIntegration: false` en `secureWebPreferences` (`src/main/desktop/security.ts`); verificado en runtime: `window.process` y `require` no existen en el renderer (dev y empaquetado). |
| 3 | Activar el aislamiento de contexto | ✅ `contextIsolation: true` (idem); el preload expone `window.osc` vía `contextBridge` y nada más. |
| 4 | Activar el sandbox del proceso | ✅ `sandbox: true` (idem; desde el spike 0.2, con preload CJS y `externalizeDeps: false`). |
| 5 | Manejar los permisos de sesión | ✅ `applySessionSecurity` instala `setPermissionRequestHandler` y `setPermissionCheckHandler` que deniegan todo salvo `clipboard-sanitized-write` (tarea 7.3, cubierto por `test/main/security.test.ts`). |
| 6 | No desactivar `webSecurity` | ✅ `webSecurity: true` fijo en `secureWebPreferences`; no se toca en ninguna ventana. |
| 7 | Definir una Content-Security-Policy | ✅ CSP completa en `src/renderer/index.html` (tarea 7.2): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'`. HMR verificado bajo esa política (0 violaciones de consola en dev). |
| 8 | No activar `allowRunningInsecureContent` | ✅ Nunca se establece (va a `true` solo si se desactiva `webSecurity`, que no ocurre). |
| 9 | No activar features experimentales | ✅ `experimentalFeatures` nunca se establece. |
| 10 | No usar `enableBlinkFeatures` | ✅ No se usa. |
| 11 | `<webview>`: no usar `allowpopups` | ✅ Más estricto: no hay ningún `<webview>` y `will-attach-webview` se cancela siempre (`applyWindowSecurity`), así que no puede crearse uno con ninguna opción. |
| 12 | Verificar las opciones de webview | ✅ Ídem: al cancelarse `will-attach-webview` no hay opciones que verificar. |
| 13 | Desactivar o limitar la navegación | ✅ `will-navigate` se cancela para cualquier URL (`applyWindowSecurity`); la app es un único documento y no navega. |
| 14 | Desactivar o limitar ventanas nuevas | ✅ `setWindowOpenHandler` devuelve siempre `deny` (idem). La app tiene una sola ventana. |
| 15 | No usar `shell.openExternal` con contenido no confiable | ✅ Hoy la app no llama a `openExternal` en absoluto. Cuando la Fase 5.5 lo introduzca (enlaces del markdown), lo hará con lista de esquemas `http:`/`https:`/`mailto:`. |
| 16 | Usar una versión actual de Electron | ✅ Electron 45.3.4 (Chromium 156, Node 24.22.3), la versión objetivo del diseño; se mantiene al día en cada release. |
| 17 | Validar el emisor de todos los mensajes IPC | ✅ `isTrustedSender` (Fase 3, `src/main/ipc.ts`): cada `ipcMain.handle` y el canal `osc:client-msg` comprueban frame principal de la ventana, en el origen cargado; tests en `test/main/ipc.test.ts`. |
| 18 | Evitar `file://`; preferir protocolos propios | ⚠️ **Desviación aceptada de momento:** en producción el renderer se carga con `loadFile` (`file://`). Es contenido propio, sin Node, con CSP estricta y sin navegación; migrar a `protocol.handle` con un protocolo custom queda anotado como mejora posterior (no cubierto por esta fase). |
| 19 | Revisar los fuses | ✅ Tarea 7.5: hook `afterPack` propio (`scripts/electron-fuses.mjs`) desactiva `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` y `EnableNodeCliInspectArguments`, y activa `EnableEmbeddedAsarIntegrityValidation` y `OnlyLoadAppFromAsar`. |
| 20 | No exponer APIs de Electron a contenido no confiable | ✅ El preload (`src/preload/index.ts`) expone una función explícita por método (`window.osc`), nunca un `invoke` genérico ni `ipcRenderer.on` crudo; `onMessage` reenvía solo el mensaje y devuelve la baja. |

Verificación de la fase (7.7): consola del renderer sin violaciones de CSP ni
advertencias de seguridad (comprobado en runtime en dev y en el `index.html`
construido, con el preload real: `FASE7_REPORT` con `cspViolations: []`), tests
de `isTrustedSender` en verde (`test/main/ipc.test.ts`) y `npm test` completo
en verde. Fuses verificados con `npx @electron/fuses read` sobre el paquete
`--dir` y arranque del empaquetado con `ELECTRON_RUN_AS_NODE=1` ignorando la
variable (arranca la app, no un intérprete de Node).

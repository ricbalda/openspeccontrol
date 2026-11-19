# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado del proyecto

**OpenSpecControl** es una app de escritorio **Electron 45 + React 19 + TypeScript** (electron-vite 6, un solo `package.json`) para revisar cambios de OpenSpec como un documento y dejar que un agente de código los implemente. Es la migración de OpenSpec Studio 0.3.x a escritorio: el servidor HTTP/WebSocket de Studio ya no existe; el renderer habla con el núcleo solo por IPC (`window.osc`) y la app no abre ningún puerto. El plan está en `Docs/plan-migracion-electron.md` (carpeta ignorada por git) y el cambio OpenSpec activo en `openspec/changes/migrate-to-electron-desktop/` (`tasks.md` lo marca el orquestador; no lo edites a mano salvo que la tarea lo pida).

## Comandos

```bash
npm install            # postinstall: install-electron + electron-builder install-app-deps
npm run dev            # electron-vite dev -w (HMR del renderer, reinicia el main al cambiar)
npm run start          # electron-vite preview (build de producción sin empaquetar)
npm test               # vitest run: proyectos `main` (node, OSC_DATA temporal) y `renderer` (jsdom por archivo)
npm run lint           # eslint --cache .
npm run format         # prettier --write .
npm run typecheck      # typecheck:node (main+preload+shared+test/main) y typecheck:web (renderer+test/renderer)
npm run build          # typecheck + electron-vite build -> out/ (out/main, out/preload/index.cjs, out/renderer)
npm run dist           # build + instalador para el SO actual -> release/<version>/
npm run dist:win       # build + NSIS por usuario, x64 y arm64
npm run dist:mac       # build + dmg y zip universales (solo se puede ejecutar en macOS)
npm run dist:linux     # build + AppImage y deb, x64 y arm64
npm run dist:dir       # build + carpeta sin instalador (la comprobación de empaquetado más rápida)
npm run demo-repo      # scripts/demo-repo.mjs: crea el repo de demostración (hello-app)
```

`dist*` pasa por `scripts/dist.mjs` (envoltorio de `electron-builder` que añade la firma de Azure Trusted Signing si están las variables `AZURE_SIGN_*`). Los scripts `build:win` y `build:unpack` de la plantilla ya no existen. Antes de dar una tarea por terminada ejecuta `npm run typecheck`, `npm run lint` (0 errores; con `core.autocrlf` en Windows salen miles de avisos `Delete ␍`, ruido conocido), `npm test` y `npx electron-vite build`.

## Arquitectura

Cuatro carpetas bajo `src/`; `electron-vite` (`electron.vite.config.ts`) compila main, preload y renderer a `out/<proceso>/`:

- **`src/main/`** — proceso principal, ESM.
  - `index.ts`: ciclo de vida (instancia única, ventana con `show: false` + `ready-to-show`, cierre seguro, menú, updater). En dev carga `ELECTRON_RENDERER_URL`; en producción, `out/renderer/index.html`. Los assets se importan con `?asset` (`resources/icon.png?asset`).
  - `ipc.ts`: un `ipcMain.handle` por método de `OscApi`, con comprobación del emisor (`makeTrustedSender`), validación zod y envelope `IpcResult`. `desktop/ipc-native.ts` registra los métodos nativos con el mismo contrato.
  - `desktop/`: la capa nativa (`window-state`, `menu`, `notifications`, `badge`, `safe-close`, `updater` + `updater-ipc`, `shell-env`, `tools`, `demo-repo`, `security`, `external-links`, `theme`, `pick-folder`, `data-folder`, `renderer-health`).
  - `core/`: el núcleo **`OscCore`** (`osc-core.ts`), que **no importa `electron`** (así se prueba con Vitest en Node y podría moverse a un `utilityProcess`). Incluye el hub ACP (`acp/`), `agents.ts`, `openspec.ts`, `git.ts`, `proc.ts`, `workspace.ts`, `repos.ts`, `db.ts` (`node:sqlite`, WAL), `review/`, `schemas.ts` (zod), `errors.ts` (`OscError`) y `legacy-import.ts` (importación única desde `~/.openspec-studio`). Importar un módulo del núcleo no tiene efectos: `createOscCore({ dataDir, version, env })` ejecuta el arranque explícito (directorio de datos → importación de Studio → `openDb` → config → migración de ids) y `core.shutdown()` detiene agentes, watchers y la base.
- **`src/preload/`** — puente en **CJS** (`out/preload/index.cjs`, con `sandbox: true` un preload no puede ser ESM). Expone solo `window.osc` por `contextBridge`: una función explícita por método de `OscApi`, **sin `invoke` genérico**, más `send(msg)` y `onMessage(cb)` (devuelve la baja). Un `ok: false` del envelope vuelve a ser un `throw new Error(message)`. `window.osc` se declara en `src/preload/index.d.ts`. Ya no existen `window.electron` ni `window.api` de la plantilla.
- **`src/renderer/`** — React 19 + zustand + Tailwind 4. Entrada `src/renderer/index.html` → `src/main.tsx` → `App.tsx`; estado en `store.ts`; el cliente del núcleo es `lib/api.ts` (envuelve `window.osc`); paneles en `panes/`, revisión en `review/`, agente en `agent/`. Alias `@renderer/*` → `src/renderer/src/*`. No hay `fetch` ni `WebSocket`. El `index.html` define una CSP estricta (`default-src 'self'`, sin objetos, frames ni base): ni scripts externos ni inline.
- **`src/shared/`** — sin dependencias: `ipc.ts` (contrato `OscApi`, canales, `IpcResult`, códigos de error), `protocol.ts` (`ClientMsg`/`ServerMsg` y tipos de dominio) y `anchor.ts`. Alias `@shared/*`.

Fuera de `src/`: `test/main` y `test/renderer` (Vitest), `scripts/` (empaquetado, arranque de prueba de CI, demo repo), `build/` (iconos, entitlements, `SIGNING.md`), `resources/` (icono de ventana), `.github/workflows/` (`ci.yml`, `release.yml`) y `openspec/`.

### Contrato `window.osc` (IPC)

`OscApi` (`src/shared/ipc.ts`) es la única superficie del renderer: `config`, `updateState`, `repos`, `addRoot`, `removeRoot`, `init`, `changes`, `archived`, `settings`, `file`, `action`, `review`, `addComment`, `patchComment`, `deleteComment`, `sendReview`, `closeRound`, `git`, `gitBranch`, `gitCommit`, `pickFolder`, `notify`, `openExternal`, `setNativeTheme`, `openDataFolder`, `showInExplorer`, `createDemoRepo`, `checkForUpdates`, `installUpdate`, `send` y `onMessage`.

- Canales: `osc:<método>` (invoke), `osc:client-msg` (renderer → main, `ClientMsg`) y `osc:server-msg` (main → renderer, `ServerMsg`, incluidos `menu` y `update_state`).
- Errores: Electron reescribe el mensaje de las excepciones de `ipcMain.handle`, así que cada handler responde `{ ok: true, data } | { ok: false, error: { code, message } }` con `code ∈ invalid | not_found | conflict | too_large | internal` (`OscError` en el núcleo).
- Las suscripciones se indexan por `webContents.id` y se limpian en recarga, destrucción y caída del renderer; tras recargar, el núcleo reenvía el `replay`.

Flujo para una nueva capacidad: método en `OscCore` (si es lógica) o módulo en `desktop/` (si usa `electron`) → esquema zod y `handle(...)` en `src/main/ipc.ts` o `desktop/ipc-native.ts` → firma en `OscApi` (`src/shared/ipc.ts`) → función explícita en `src/preload/index.ts` → uso desde el renderer a través de `lib/api.ts`. Añade el test correspondiente en `test/main` o `test/renderer`.

TypeScript usa project references: `tsconfig.node.json` (main, preload, shared, `test/main`, config de vite y vitest) y `tsconfig.web.json` (renderer, shared, `test/renderer` y `src/preload/*.d.ts`). Un archivo nuevo debe caer en el `include` de uno de los dos para que el typecheck lo vea. Se mantiene `allowImportingTsExtensions`: los imports relativos llevan la extensión (`./osc-core.ts`) y los compartidos usan `@shared/...`, nunca rutas relativas a `src/shared`.

## Nombres e identidad (tabla 1.1 del plan)

- Nombre visible `OpenSpecControl`; paquete y ejecutable `openspeccontrol`; versión inicial `0.1.0`; `appId` / `AppUserModelId` `io.github.ricbalda.openspeccontrol`; releases en `ricbalda/openspeccontrol`.
- Prefijo corto **`osc`** para todo lo propio: `window.osc`, canales `osc:*`, `OscApi`, `OscCore`, `OscError`, variables `OSC_DATA`, `OSC_DB`, `OSC_NO_UPDATE_CHECK`, `clientInfo.name = 'openspeccontrol'`. Sin marca: `DEFAULT_AGENT`, `OPENSPEC_BIN`, `OPENSPEC_TELEMETRY`, `REPOS_ROOT`, `REPO_SCAN_DEPTH`, `MAX_DOC_BYTES`.
- Datos del usuario en `~/.openspeccontrol/` (`OSC_DATA`): `openspeccontrol.db` (+ `-wal`/`-shm`), `config.json`, `agents.json`, `window-state.json` e `imported-from-studio.json`. El `userData` de Electron (`%APPDATA%\OpenSpecControl`, etc.) es **otra** carpeta y solo guarda cachés de Chromium y `localStorage`.
- Archivo de revisión por cambio: `openspec/changes/<c>/.openspeccontrol-review.json` (formato `openspeccontrol-review`). El `.studio-review.json` de Studio solo se lee como respaldo y nunca se escribe; ambos se ignoran al calcular la firma de artefactos.
- Instaladores: `OpenSpecControl-<versión>-<arch>-setup.exe` (NSIS, uno por arquitectura), `OpenSpecControl-<versión>.dmg`, `OpenSpecControl-<versión>-<arch>.AppImage` y `.deb`, en `release/<versión>/`.
- Studio solo aparece en lo intencionado: la importación (`legacy-import.ts`), la lectura de `.studio-review.json`, `NOTICE`, el README y los comentarios que lo explican (`grep -rni studio src test scripts` debe mostrar solo eso). No reintroduzcas `STUDIO_*`, `window.studio`, `~/.openspec-studio` como directorio de trabajo ni el puerto 3940.

## Reglas de seguridad

- **Sin red:** la app no escucha en ningún puerto. No añadas servidores HTTP/WebSocket ni `fetch`/`WebSocket` en el renderer.
- **`webPreferences` fijas** (`desktop/security.ts`, `secureWebPreferences`): `contextIsolation`, `sandbox`, `webSecurity` activos; `nodeIntegration` y `spellcheck` desactivados; `navigateOnDragDrop: false`. Al crear una ventana, solo se añade `preload`. No hay `process` ni `require` en el renderer.
- **IPC:** cada handler comprueba primero el emisor (`makeTrustedSender`: solo el `mainFrame` de la ventana principal, en el origen cargado), valida los argumentos con zod y no lanza excepciones a través del puente. No expongas un `invoke` genérico ni canales sin esquema.
- **Permisos denegados por defecto:** solo pasa `clipboard-sanitized-write`. `<webview>`, `window.open` y la navegación fuera de la página están bloqueados; los enlaces `http:`, `https:` y `mailto:` se abren con `window.osc.openExternal`.
- **Sistema de archivos:** el acceso a archivos del repo pasa por `repoPath()` y `safeResolve` (siguen enlaces simbólicos), con `validChange`, `MAX_DOC_BYTES` y `capped()`; no los esquives con `fs` directo sobre rutas del renderer.
- **Agentes:** corren como el usuario, con el `node`/`npx` del sistema (nunca el Electron de la app); sus prompts de permiso y elicitation se reenvían a la UI y no se aprueban automáticamente.
- **Binario endurecido:** los fuses de Electron se voltean en `afterPack` (`scripts/electron-fuses.mjs`): `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` y `EnableNodeCliInspectArguments` desactivados; `EnableEmbeddedAsarIntegrityValidation` y `OnlyLoadAppFromAsar` activados.
- **Nada de secretos en el repo:** la firma y la notarización se activan solo con las variables de entorno documentadas en `build/SIGNING.md`; los workflows las leen de `secrets.*`.

## Estilo

Prettier: comillas simples, sin punto y coma, `printWidth` 100, sin trailing commas. ESLint flat config con `@electron-toolkit/eslint-config-ts`, React, react-hooks y react-refresh. Los componentes declaran retorno explícito (`React.JSX.Element`). `README.md`, `CLAUDE.md`, `openspec/` y `Docs/` están en `.prettierignore` (documentos de autor): no los reformatees en bloque. Los comentarios y mensajes de commit están en español (`feat:`, `test:`, `docs:`...).

## Particularidades de npm / empaquetado

- `.npmrc` está vacío a propósito: npm 12 rechaza claves desconocidas (`electron_mirror`, etc.). Si hace falta un mirror, usar las variables de entorno `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`.
- `package.json` tiene `allowScripts` para `electron-winstaller`; npm 12 bloquea scripts de instalación de dependencias no listadas ahí. `engines.node` es `>=22.13` (la CI prueba Node 22 y 24); la app empaquetada usa el Node 24 que trae Electron, de ahí que `node:sqlite` no necesite módulos nativos.
- `electron-builder.yml` ya tiene la identidad real (`appId`, `productName`, `publish` a GitHub `ricbalda/openspeccontrol`, `files` solo `out/**`, `package.json`, `LICENSE` y `NOTICE`, `asar` y `asarUnpack: resources/**`). `dev-app-update.yml` apunta al mismo origen.
- `.backup-fix-npm/` (ignorada por git) guarda las versiones previas de `package.json`, `package-lock.json` y `electron-builder.yml` anteriores al ajuste de npm 12 (se bajó `@electron-toolkit/eslint-config-ts` a `^3.1.0`, se subió `electron-builder` a `^26` y se quitó el mirror de `electronDownload`).
- Releases: los construye `release.yml` al empujar una etiqueta `v*` (borrador en GitHub); el procedimiento está en el README, sección Development → Crear un release.

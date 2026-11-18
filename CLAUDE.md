# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado del proyecto

App de escritorio **Electron + React 19 + TypeScript** creada con el scaffold de `electron-vite` (plantilla `react-ts`). Todavía es el código de ejemplo de la plantilla: no hay lógica de negocio, ni router, ni gestor de estado, ni tests configurados.

## Comandos

```bash
npm install            # postinstall: install-electron + electron-builder install-app-deps
npm run dev            # electron-vite dev (HMR del renderer)
npm run start          # electron-vite preview (build de producción sin empaquetar)
npm run lint           # eslint --cache .
npm run format         # prettier --write .
npm run typecheck      # typecheck:node (main+preload) y typecheck:web (renderer)
npm run build          # typecheck + electron-vite build -> out/
npm run build:win      # build + electron-builder --win (NSIS) -> dist/
npm run build:unpack   # build + electron-builder --dir (sin instalador)
```

No hay framework de tests instalado; `npm run typecheck` y `npm run lint` son la verificación disponible.

## Arquitectura

Tres procesos/bundles, cada uno compilado por `electron-vite` (`electron.vite.config.ts`) a `out/<proceso>/`:

- **`src/main/`** — proceso principal (Node). Crea la `BrowserWindow`, registra handlers `ipcMain`. En dev carga `ELECTRON_RENDERER_URL`; en producción, `out/renderer/index.html`. Los assets se importan con el sufijo `?asset` (p. ej. `resources/icon.png?asset`).
- **`src/preload/`** — puente seguro. Expone `window.electron` (`electronAPI` de `@electron-toolkit/preload`) y `window.api` (objeto de APIs propias, hoy vacío) vía `contextBridge`. Los tipos de ambos se declaran en `src/preload/index.d.ts`: al añadir algo a `api` hay que actualizar ese `.d.ts` (hoy `api: unknown`).
- **`src/renderer/`** — React. Entrada `src/renderer/index.html` → `src/main.tsx` → `App.tsx`. Alias `@renderer/*` → `src/renderer/src/*`. El `index.html` define una CSP estricta (`script-src 'self'`), así que no se pueden cargar scripts externos ni inline.

Flujo para una nueva capacidad nativa: handler en `ipcMain` (main) → función en `api` del preload que llama a `ipcRenderer` → tipo en `index.d.ts` → uso desde el renderer con `window.api.*`. El renderer no tiene acceso directo a Node.

TypeScript usa project references: `tsconfig.node.json` (main, preload, config de vite) y `tsconfig.web.json` (renderer + `src/preload/*.d.ts`). Un archivo nuevo debe caer en el `include` de uno de los dos para que el typecheck lo vea.

## Estilo

Prettier: comillas simples, sin punto y coma, `printWidth` 100, sin trailing commas. ESLint flat config con `@electron-toolkit/eslint-config-ts`, React, react-hooks y react-refresh. Los componentes declaran retorno explícito (`React.JSX.Element`).

## Particularidades de npm / empaquetado

- `.npmrc` está vacío a propósito: npm 12 rechaza claves desconocidas (`electron_mirror`, etc.). Si hace falta un mirror, usar las variables de entorno `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`.
- `package.json` tiene `allowScripts` para `electron-winstaller`; npm 12 bloquea scripts de instalación de dependencias no listadas ahí.
- `.backup-fix-npm/` guarda las versiones previas de `package.json`, `package-lock.json` y `electron-builder.yml` antes de ese ajuste (se bajó `@electron-toolkit/eslint-config-ts` a `^3.1.0`, se subió `electron-builder` a `^26` y se quitó el mirror de `electronDownload`).
- `electron-builder.yml` aún tiene valores de plantilla (`appId: com.electron.app`, `publish.url: https://example.com/auto-updates`); `main/index.ts` usa `setAppUserModelId('com.electron')`.

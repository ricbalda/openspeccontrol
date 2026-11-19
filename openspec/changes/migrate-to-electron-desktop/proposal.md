# Proposal

## Why

OpenSpec Studio 0.3.1 es una app web local: un servidor Node (Hono + `ws`) en `127.0.0.1:3940` sin autenticación, que obliga a defensas propias contra DNS rebinding, un explorador de carpetas propio, notificaciones atadas a permisos del navegador y actualizaciones copiando un comando `npm install -g`. OpenSpecControl lleva **toda** esa funcionalidad a una aplicación de escritorio Electron con identidad propia, sin puerto abierto, con diálogos y notificaciones nativas, instaladores firmados para Windows, macOS y Linux y actualización automática. Las decisiones de diseño D1–D11 ya están tomadas en `docsplan/plan-migracion-electron.md` (sección 2) y no se reabren aquí.

## What Changes

- **Solo escritorio (D1):** OpenSpecControl no incluye el modo web, el servidor HTTP/WebSocket ni el CLI npm de Studio. No se trae `security.ts`, `hono`, `ws` ni `tsx`.
- **Transporte por IPC (D2):** el renderer habla con el núcleo solo mediante `window.osc` (`contextBridge`, canales `osc:*`); el preload corre en CJS con `sandbox: true` (D8). La app no abre puertos de red.
- **Núcleo `OscCore` en el proceso main (D3):** la lógica de `server/src/index.ts` pasa a módulos sin `electron`, probables con Vitest; se mantiene `node:sqlite` (D4).
- **Identidad propia (D5, D10):** nombre `OpenSpecControl`, prefijo `osc`, datos en `~/.openspeccontrol`, archivo de revisión `.openspeccontrol-review.json`, variables `OSC_*`. **BREAKING** respecto a Studio: las variables `STUDIO_*` dejan de leerse y desaparecen `PORT`, `HOST` y `ALLOWED_HOSTS`.
- **Importación desde Studio (D5):** en el primer arranque se copian la base, `config.json` y `agents.json` de `~/.openspec-studio` sin modificar el origen; `.studio-review.json` se lee como respaldo.
- **Shell de escritorio:** instancia única, estado de ventana, cierre seguro con agentes activos, menú nativo y ciclo de vida específico de macOS.
- **Integraciones nativas:** selector de carpetas del sistema, notificaciones, contador de pendientes, enlaces al navegador del sistema, tema nativo y repositorio de demostración desde el menú.
- **Entorno de ejecución (D9):** resolución del `PATH` del shell de login en macOS/Linux y diagnóstico de `node`, `npx`, `openspec` y `git`.
- **Endurecimiento de seguridad:** CSP completa, permisos denegados, fuses de Electron y validación del emisor de IPC.
- **Distribución (D6):** instaladores firmados (NSIS, dmg + zip, AppImage + deb), actualización automática con `electron-updater` sobre GitHub Releases (`ricbalda/openspeccontrol`) y CI/CD en tres sistemas operativos.
- **Herramientas (D7, D11):** un solo `package.json` sobre el scaffold existente, copia del código desde `../../openspec-studio` (de solo lectura), ESLint + Prettier, versión inicial 0.1.0.
- **Licencia:** se conserva el aviso MIT de OpenSpec Studio (© Fridayana Baabullah) en un `NOTICE` incluido en el paquete, junto al `LICENSE` MIT propio.
- **Fuera de alcance:** las funciones nuevas del README que Studio no tiene (entrega a Orca, tablero multi-cambio, detección de solapes) son cambios posteriores; este cambio entrega solo la paridad con Studio 0.3.1.

## Capabilities

### New Capabilities
- `desktop-shell`: instancia única, estado de ventana, cierre seguro con agentes activos, menú y ciclo de vida por plataforma.
- `ipc-bridge`: comunicación renderer↔núcleo solo por `window.osc`, con validación de emisor y de esquema, sin puertos de red y con recuperación del estado al recargar.
- `native-integrations`: selector de carpetas nativo, notificaciones, contador de pendientes, enlaces externos, tema nativo y repositorio de demostración.
- `runtime-environment`: resolución del `PATH` y de las variables del shell de login, y diagnóstico de dependencias externas.
- `studio-data-import`: importación única y no destructiva de los datos de OpenSpec Studio, y lectura de respaldo de `.studio-review.json`.
- `desktop-distribution`: instaladores firmados por plataforma y actualización automática desde GitHub Releases.
- `core-parity`: paridad funcional de OpenSpecControl con OpenSpec Studio 0.3.1.

### Modified Capabilities
<!-- Ninguna: openspec/specs/ está vacío, todas las capacidades son nuevas. -->

## Impact

- **Código:** se incorporan `src/main/` (`core/`, `desktop/`, `ipc.ts`), `src/preload/`, `src/renderer/src/`, `src/shared/`, `test/main/`, `test/renderer/` y `scripts/`; se retira el código de ejemplo de la plantilla (`Versions.tsx`, `ping`, `window.electron`/`window.api`).
- **Configuración:** `package.json` (nombre, versión 0.1.0, dependencias), `electron.vite.config.ts`, `electron-builder.yml` (appId `io.github.ricbalda.openspeccontrol`, sin `snap`, publicación en GitHub), `tsconfig*.json`, `eslint.config.mjs`, `.prettierignore`, `.gitignore` y `CLAUDE.md`.
- **Dependencias:** Electron 44.7.2 → 45.3.4; se añaden `@agentclientprotocol/sdk`, `chokidar`, `cross-spawn`, `diff`, `zod`, React, zustand, react-markdown, remark-gfm, lucide-react, clsx, Tailwind 4, Vitest y jsdom. No se añaden `hono`, `ws`, `tsx` ni Biome.
- **Usuarios:** quienes usan Studio conservan sus datos por importación; deben usar la app instalable en lugar del paquete npm global.
- **Repositorio:** se inicializa git en OpenSpecControl; no se modifica `../../openspec-studio` ni su paquete npm.
- **Infraestructura:** workflows de CI y de release en GitHub Actions; secretos de firma (Windows/macOS) y `GH_TOKEN`.

## Estimación

Cambio grande, por fases (tamaños del plan): F0 M · F1 M · F2 L · F3 L · F4 M · F5 M · F6 M · F7 S–M · F8 L · F9 M · F10 M · F11 M · F12 S–M. En total, varias semanas de trabajo; las Fases 0–3 dejan una app funcional con todo el flujo de Studio y las 4–12 la convierten en producto distribuible.

## Riesgos

- **`PATH` incompleto al abrir desde el escritorio (macOS/Linux)** → Fase 6 (shell de login, rutas conocidas y diagnóstico visible); validado antes en el spike 0.4.
- **Trabajo síncrono en el main (SQLite, recorrido de `openspec/`)** → medición en 11.5; el núcleo no importa `electron`, así que puede pasar a un `utilityProcess` sin reescribirlo.
- **Firma y notarización (coste, secretos, reputación de SmartScreen)** → resolver certificados y secretos antes de la Fase 8.
- **Auto-update de `deb`** → spike 0.5; si no es viable, aviso de nueva versión con enlace al release.
- **Importación desde Studio falla o la base está en uso** → copia consistente con `VACUUM INTO` desde una conexión de solo lectura; si falla, se registra y se arranca vacío.
- **Studio y OpenSpecControl abiertos a la vez sobre el mismo repo** → nota de migración en el README; cada app tiene su propio directorio de datos.
- **Reformateo masivo al pasar a Prettier** → un commit propio, sin cambios de lógica (tarea 1.8).
- **HMR con CSP estricta** → verificación en 7.2 y CSP diferenciada para desarrollo si hace falta.

Detalle completo de riesgos y mitigaciones en `design.md`.

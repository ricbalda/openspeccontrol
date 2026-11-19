# Informe E2E — cambio `multi-repo-rail`, fase 5 (tareas 5.1 y 5.2)

- **Fecha**: 2026-11-19
- **Máquina**: Windows (win32), Node 26.13.1, `openspec` 2.0.0, `agent-browser` 0.41.0
- **Ejecución**: `node test/e2e/multi-repo.mjs` (puerto CDP **9233**, distinto del 9222 de `smoke.mjs`), lanzada por el subagente `test-browser` sobre la app real (`electron .` con `out/` de `npx electron-vite build`).
- **Sandbox**: `REPOS_ROOT` y `OSC_DATA` temporales con **dos repos de demostración** (`hello-app` con el cambio `add-hello-endpoint` y `notes-app` con `add-notes-endpoint`) y `agents.json` que declara el **agente falso** (`test/e2e/fake-acp-agent.mjs`, extendido en esta fase para pedir un `session/request_permission` real cuando el prompt contiene `permission`).
- **Resultado**: ✅ **12/12 pasos OK**, código de salida 0, sin errores de página.
- **Capturas** (fuera del repo versionado, no commiteadas): `C:\Users\ricba\AppData\Local\Temp\opencode\multi-repo-rail-e2e\2026-11-19T18-23-34-604Z\`

## Pasos verificados (5.1 + 5.2)

| # | Paso | Resultado | Detalle |
| --- | --- | --- | --- |
| 1 | Arranque: app pintada y dos repos en el workspace | OK | hello-app + notes-app (126 ms) |
| 2 | Abrir A (hello-app): su sección con el cambio en «In review» | OK | sección `[hello-app]` activa (948 ms) |
| 3 | Abrir B (notes-app) desde el selector: dos secciones, B activa, A sigue abierta | OK | rail `[A][B]`, B con borde de acento, selector «notes-app» (1014 ms) |
| 4 | Abrir el cambio de A activa A y muestra su propuesta | OK | A activa con `add-hello-endpoint` abierto (269 ms) |
| 5 | Cambiar a B y volver a A: el cambio abierto de A se conserva | OK | A → B («Nothing open») → A (la propuesta vuelve sin reabrir la tarjeta) (228 ms) |
| 6 | Plegar la sección de A: cabecera visible, cambios ocultos, recordado | OK | `rail-collapsed` recuerda a A en `localStorage` (280 ms) |
| 7 | Cerrar B sin agente: sin diálogo, desaparece y queda solo A | OK | sin `CloseRepoDialog`, `open-repos=[A]`, A activa (302 ms) |
| 8 | Reabrir B y arrancar el agente falso en B | OK | sesión `ready` por el camino real (hub → ACP) (635 ms) |
| 9 | **5.2** Agente de B en segundo plano pide un permiso | OK | «Needs you · 1» en la sección de B, `pendingInteractions=1` en el hub, la decisión no se abre en el centro (A activa), título «(1) Needs you · OpenSpecControl», **foco real perdido: sí** (12151 ms) |
| 10 | Cerrar B con agente: cancelar lo deja abierto con su sesión intacta | OK | diálogo «Close notes-app and disconnect its agent?» → Cancel → B abierta, sesión viva (5401 ms) |
| 11 | Cerrar B con agente: confirmar la desconecta y la quita del rail | OK | sesión `null` en el hub, A activa con su cambio intacto (5516 ms) |
| 12 | Sin errores de página durante el recorrido | OK | `agent-browser errors` vacío (43 ms) |

Escenario adicional verificado de paso: al abrir B desde el selector, el menú marca los repos abiertos (insignia «open») y el botón principal muestra el repo **activo**, no el único.

## Notificación del sistema (5.2): **NO verificada** visualmente

Qué está verificado y qué no:

- **Verificado (determinista, en la propia app real)**: con la ventana **realmente sin foco** (una ventana propia le quita el foco; `document.hasFocus() === false` comprobado sin stubs), el permiso del agente de B en segundo plano produce la marca «Needs you · 1» en su sección, `pendingInteractions = 1` en el estado del hub, y el título de la ventana «(1) Needs you · OpenSpecControl». La decisión de B no aparece en el centro ni en el panel del agente de A.
- **Verificado por pruebas unitarias (fase 4.1, `test/renderer/multi-repo-notify.test.tsx`)**: con la ventana sin foco, el store llama a `window.osc.notify` con el título exacto **«Needs your decision · notes-app»** y `kind: 'attention'`; con la ventana con foco, no llama.
- **NO verificado**: el **toast del sistema** en pantalla. El E2E tomó dos capturas del escritorio completo (inmediata y 2,5 s después de la marca) con la ventana sin foco real, y **ninguna muestra el banner** (revisadas con OCR de Windows; las capturas leen la barra de tareas y las ventanas, pero no hay rastro del aviso). Causas posibles, no excluyentes: una app Electron sin instalar no siempre obtiene banner del Centro de actividades de Windows (AppUserModelId sin acceso directo en el menú Inicio), o el modo «No molestar»/Focus Assist activo. No es un fallo del código de las fases 1–4: la cadena renderer → `osc:notify` → `showAppNotification` está cubierta por pruebas unitarias (`test/main` y `test/renderer`), y la decisión de notificar se tomó con el foco real perdido.

Limitación conocida del propio E2E: `window.osc.notify` está expuesto por `contextBridge` en solo lectura (comprobado con una sonda de Electron: no se puede envolver para registrar la llamada), así que la carga exacta del aviso no es capturable por CDP; de ahí las capturas de escritorio como evidencia.

## Correcciones durante la puesta a punto (solo del propio E2E, ninguna del código de producción)

1. Selectores CSS con rutas Windows: `[title="C:\…"]` rompe por los escapes CSS; los elementos se buscan ahora comparando `title`/`data-repo` por valor.
2. Un helper interpolaba el *texto* de una sección como si fuera código JS (SyntaxError); refactorizado a snippets que no se ejecutan.
3. La comprobación del cambio de B afirmaba sin esperar a que su lista cargara; ahora espera hasta 30 s.

Ningún paso reveló fallos del código de las fases 1–4; no se tocó código de producción.

## Checks de la fase (5.4)

Sobre la rama `multi-repo-rail-w3-fase5` tras los cambios de esta fase:

- `npm run typecheck` — ✅ sin errores
- `npm run lint` — ✅ 0 avisos
- `npm test` — ✅ 59 ficheros OK (431 pruebas, 3 saltadas)
- `npx electron-vite build` — ✅
- `node test/e2e/multi-repo.mjs` — ✅ 12/12 pasos

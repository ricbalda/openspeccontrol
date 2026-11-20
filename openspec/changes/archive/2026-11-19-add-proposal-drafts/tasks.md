# Tasks

## 1. Persistencia y búsqueda en el núcleo

- [x] 1.1 Añadir en `openDb()` (`src/main/core/db.ts`) la tabla `drafts`, el índice `drafts_by_repo`, la tabla virtual `drafts_fts` (FTS5, `trigram remove_diacritics 1`, contenido externo) y sus triggers de insertar, editar y borrar (design D-1) — verificación: un test en `test/main/drafts-db.test.ts` abre una base nueva y otra con las tablas previas, y ambas quedan con el esquema sin perder datos existentes
- [x] 1.2 Crear `src/main/core/drafts.ts` sin importar `electron`, con `list`, `get`, `create`, `save`, `duplicate`, `remove` y `markSent`, fechas ISO y orden por `updated_at` descendente (design D-3) — verificación: tests de `test/main/drafts.test.ts` para crear, guardar (actualiza `updated_at`), duplicar (« (copy)», fechas nuevas), borrar y `not_found`
- [x] 1.3 Implementar la búsqueda: frase FTS escapada para 3 o más caracteres y `LIKE` normalizado para 1–2 caracteres, limitada al repositorio (design D-2) — verificación: tests con «busqueda» frente a «Búsqueda», «export» frente a «Exportación», «ui», sin resultados, sintaxis FTS en la consulta (`"`, `OR`, `*`) sin error, y aislamiento entre dos repos
- [x] 1.4 Imponer las reglas del núcleo: guardar un enviado da `conflict`, y los topes de título y contenido dan `too_large` sin recortar — verificación: tests de `test/main/drafts.test.ts`
- [x] 1.5 Criterio de aceptación del grupo: los borradores persisten al cerrar y reabrir la base, la búsqueda cumple los escenarios de «Búsqueda en el historial» de la spec y `npm run typecheck` y `npm test` pasan — verificación: salida de `npm test` con los tests nuevos en verde

## 2. Contrato IPC

- [x] 2.1 Declarar `DraftSummary`, `Draft`, `DraftMode` y los métodos `drafts`, `draft`, `createDraft`, `saveDraft`, `duplicateDraft`, `deleteDraft` y `sendDraft` en `OscApi` (`src/shared/ipc.ts`), y mover allí `MAX_ACTION_TEXT = 4000`, usado por `actionBody` (design D-4) — verificación: `npm run typecheck` pasa y un test nuevo en `test/main/schemas.test.ts` comprueba que `actionBody` sigue recortando el texto a 4000 caracteres
- [x] 2.2 Añadir los esquemas zod (título ≤ 200, contenido ≤ 100 000, consulta ≤ 200, `mode` enum) en `schemas.ts` y un `handle(...)` por método en `src/main/ipc.ts`, con `makeTrustedSender` y el envelope `IpcResult` — verificación: tests de `test/main` de que cada canal valida argumentos, rechaza emisores no confiables y responde `{ ok: false, error.code }` en `not_found`, `conflict` y `too_large`
- [x] 2.3 Exponer las funciones explícitas en `src/preload/index.ts` (sin `invoke` genérico) y en `src/renderer/src/lib/api.ts` — verificación: `test/renderer/api.test.ts` cubre los métodos nuevos (delegan en `window.osc` con los mismos argumentos y propagan el error) y `npm run typecheck` confirma que el preload implementa `OscApi` completo
- [x] 2.4 Criterio de aceptación del grupo: los siete métodos funcionan de extremo a extremo por IPC con argumentos válidos e inválidos — verificación: `npm run typecheck`, `npm run lint` (0 errores) y `npm test` en verde

## 3. Envío al agente

- [x] 3.1 Implementar `OscCore.sendDraft(id, mode)`: exige un borrador no enviado, contenido ≤ 4000 caracteres y no vacío para `propose`, delega en `this.action(...)` con el contenido y marca enviado solo si `action` no lanza (design D-5) — verificación: tests de `test/main/osc-drafts.test.ts` con agente falso: envío correcto (el agente recibe `/opsx:propose <contenido>`), sin sesión, agente ocupado (el borrador sigue sin enviar), `too_large` sin llamar al agente, `propose` vacío y reenvío de un enviado (`conflict`)
- [x] 3.2 Añadir `sendDraft()` en `store.ts`: activa el repo, ejecuta `ensureAgent()`, invoca `api.sendDraft`, muestra el error con `guard` y recarga la lista y el borrador abierto — verificación: test de `test/renderer` con `window.osc` simulado (llama a `ensureAgent` antes de enviar y, si falla, no cambia el estado)
- [x] 3.3 Criterio de aceptación del grupo: los escenarios de «Enviar un borrador a OpenSpec», «Límite de caracteres para enviar» (rechazo del núcleo) y «Borrador enviado» pasan en tests — verificación: `npm test` en verde

## 4. Sección Drafts en el rail

- [x] 4.1 Crear `DraftsSection` en `RepoSection.tsx`, junto a Specs y Archived: plegable, con **New draft**, el buscador (espera de 250 ms), la lista (título o «Untitled draft», fecha relativa, insignia «Sent · explore/proposal»), el aviso de sin borradores y el de sin coincidencias con **Clear search** (design D-6) — verificación: tests de `test/renderer/drafts-section.test.tsx` del orden, del título vacío, de las insignias, de la búsqueda y de los estados vacíos
- [x] 4.2 Añadir al store la carga de borradores por repo (`draftsByRepo`, `loadDrafts(repo, query)`) y la apertura con `browse: { kind: 'draft', id }`; en un repo de segundo plano, **New draft** o abrir un borrador activan antes ese repo — verificación: tests de `test/renderer` de que «New draft» en B activa B y crea el borrador en B, y de que una respuesta tardía no se pinta en otro repo
- [x] 4.3 Criterio de aceptación del grupo: los escenarios de «Crear un borrador», «Historial de borradores» y «Búsqueda en el historial» pasan en tests de renderer — verificación: `npm test` en verde

## 5. Editor de borradores

- [x] 5.1 Crear `panes/DraftEditor.tsx` y mostrarlo desde `DocReview.tsx` cuando `browse.kind === 'draft'`: título, contenido, **Edit / Preview** con el renderizado markdown de `ReadOnlyDoc`, y fechas de creación y modificación — verificación: test de renderer de que la vista previa renderiza un título y una lista markdown
- [x] 5.2 Implementar el autoguardado (1 s tras la última pulsación) con el indicador **Saving… / Saved / Not saved** y `flushDraft()` al cambiar de borrador, cambio, repo o vista, en `blur` y en `visibilitychange` (design D-6) — verificación: tests con temporizadores falsos de un solo guardado tras varias pulsaciones, de guardado forzado al cambiar de vista y de que un fallo conserva el texto y muestra «Not saved»
- [x] 5.3 Añadir el contador `n / 4000`, la advertencia «n / 4000: shorten the draft to send it» y la deshabilitación de **Explore** y **Propose** por encima del límite o de **Propose** con el contenido vacío, más el atajo `Ctrl/Cmd+Enter` para **Propose** — verificación: tests con 3200 y 4210 caracteres y con el contenido vacío
- [x] 5.4 Implementar la vista de un enviado: solo lectura, modo y fecha de envío, sin botones de envío; **Duplicate** abre la copia, y **Delete** pide confirmación con `Dialog` y cierra el editor — verificación: tests de renderer de solo lectura, de duplicar (abre «… (copy)») y de borrar con confirmación y con cancelación
- [x] 5.5 Documentar la función en `README.md` (sección Features) y en `OpenSpecControl_Features.md` — verificación: las dos secciones describen Drafts, la búsqueda, el autoguardado, el límite de 4000 y el envío como Explore o Propose
- [x] 5.6 Criterio de aceptación del grupo: los escenarios de «Contenido de un borrador», «Autoguardado», «Límite de caracteres para enviar», «Borrador enviado», «Duplicar un borrador» y «Borrar un borrador» pasan en tests — verificación: `npm run typecheck`, `npm run lint` (0 errores) y `npm test` en verde

## 6. Verificación en la app real

- [x] 6.1 Escribir `test/e2e/drafts.mjs` (CDP con `agent-browser`, agente ACP falso, `OSC_DATA` y `--user-data-dir` temporales) que recorra crear, escribir, autoguardar, buscar sin acentos, superar 4000 (envío bloqueado), recortar, **Propose** (el agente falso recibe el comando), ver el enviado en solo lectura, duplicar, borrar y reiniciar la app con los borradores conservados — verificación: el script termina con todos los pasos OK y deja capturas en `test/e2e/captures/`
- [x] 6.2 Comprobar que el repositorio del usuario queda intacto tras el recorrido — verificación: `git status --porcelain` del repo de prueba vacío antes y después de crear y editar borradores
- [x] 6.3 Criterio de aceptación del cambio: el recorrido E2E pasa en Windows, `npm run build` termina sin errores y `openspec validate add-proposal-drafts --strict` sigue pasando — verificación: salidas de los tres comandos

## Workflow follow-up

- Revisar la propuesta con Ricardo antes de implementar (`/opsx:apply`).
- Archivar el cambio cuando se cumplan los requisitos de revisión del proyecto (`/opsx:archive`).

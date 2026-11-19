# Tasks

## 1. Protocolo y núcleo

- [x] 1.1 Añadir `{ type: 'unsubscribe'; repo }` a `ClientMsg` en `src/shared/protocol.ts` y su esquema en `src/main/core/schemas.ts` — verificación: `test/main/schemas.test.ts` acepta el mensaje válido y rechaza uno sin `repo`
- [x] 1.2 Implementar `OscCore.unsubscribeRepo(sub, repo)` y manejar `unsubscribe` en `handleClientMsg`; el vigilante del repo se detiene si no quedan suscriptores ni agente — verificación: prueba en `test/main/osc-core.test.ts`: tras `unsubscribe` ya no llegan mensajes de ese repo, y siguen llegando los de otro repo suscrito
- [x] 1.3 Comprobar que `src/main/ipc.ts` deja pasar el mensaje nuevo por el canal `osc:client-msg` — verificación: `test/main/ipc.test.ts` con un `unsubscribe`
- [x] 1.4 Criterio de aceptación de la fase: `npm run typecheck`, `npm run lint` y `npm test` pasan; `grep -n unsubscribe src/shared/protocol.ts src/main/core/osc-core.ts` muestra el mensaje y el método

## 2. Estado por repo en el store

- [x] 2.1 Añadir `openRepos`, `views` (`RepoView`) y `collapsed` al `store`, con `MAX_OPEN_REPOS = 8` y las claves de `localStorage` `open-repos` y `rail-collapsed` — verificación: prueba de renderer que serializa y restaura las claves, e ignora JSON inválido
- [x] 2.2 Implementar `openRepo(id)`, `activateRepo(id)` y `closeRepo(id)`: guardar y restaurar la proyección del activo, revalidar al activar, y respetar el límite de 8 con un aviso — verificación: pruebas con dos repos: el cambio y la pestaña abiertos en A se conservan al ir a B y volver; el noveno repo no se abre
- [x] 2.3 Reescribir `onServer` para enrutar por repo (activo / en segundo plano / no abierto) según la tabla del diseño, con `loadChangesFor(repo)` y debounce por repo — verificación: pruebas donde un `session`, un `artifacts_changed` y un `turn_end` de B actualizan solo `views.B` sin tocar los campos del activo
- [x] 2.4 Dar un parámetro `repo` opcional a `loadChanges`, `loadGit`, `startAgent`, `stopAgent` y `runAction`; las acciones sobre un repo en segundo plano lo activan primero — verificación: una respuesta de A que llega tras activar B no modifica lo que ve B (prueba con promesas diferidas)
- [x] 2.5 Cierre ordenado: `closeRepo` pide confirmación si hay sesión viva, envía `stop` y `unsubscribe`, y activa el siguiente repo o el estado vacío — verificación: pruebas de cierre con y sin agente, cancelando y confirmando
- [x] 2.6 `boot()` restaura `open-repos` y el activo, se suscribe a cada repo abierto, escalona la carga de cambios y descarta los repos que ya no existen en el workspace (también en `applyWorkspace` y `removeRoot`) — verificación: pruebas de arranque con 2 repos y con uno desaparecido; la clave antigua `repo` siembra la lista
- [x] 2.7 Criterio de aceptación de la fase: `npm run typecheck`, `npm run lint` y `npm test` pasan y los tests existentes del store no cambian; con un solo repo abierto el comportamiento es el de antes

## 3. Secciones del rail

- [x] 3.1 Extraer el contenido de `RepoRail` a `RepoSection` leyendo de la `RepoView` de cada repo (activo: proyección; en segundo plano: `views[repo]`), con `NewChangeButton`, filtro, etapas, `SpecsSection` y `ArchivedSection` — verificación: pruebas de renderer con dos repos: cada sección muestra sus cambios y no los del otro
- [x] 3.2 Cabecera de sección: chevron de plegado, nombre, rama, estado del agente con número de decisiones pendientes y botón de cerrar; borde de acento en la activa; un `ErrorBoundary` por sección — verificación: prueba de que plegar oculta el cuerpo y recuerda el estado, y de que una sección que falla no tira a las demás
- [x] 3.3 Convertir `RepoPicker` en «abrir repo»: marca los abiertos, abre y activa al elegir, mantiene `AddFolderButton` y `ExplorerButton` junto al selector — verificación: prueba de renderer: elegir un segundo repo lo añade al rail sin cerrar el primero
- [x] 3.4 `ChangeCard` en un repo en segundo plano: clic y acciones del menú activan primero ese repo — verificación: prueba de que «Build (apply)» en la tarjeta de B llama a la acción con el repo B
- [x] 3.5 Confirmación de cierre para repos con agente (`Dialog` con «Cancel» y «Close and disconnect») — verificación: prueba de renderer del diálogo en ambos caminos
- [x] 3.6 Criterio de aceptación de la fase: `npm run typecheck`, `npm run lint` y `npm test` pasan; con un solo repo abierto el rail se ve como antes con una sección

## 4. Avisos en segundo plano

- [x] 4.1 Los avisos de decisión pendiente y de fin de turno de un repo no activo incluyen el nombre del repo; la ventana con foco no genera notificación del sistema — verificación: prueba de renderer con `window.osc.notify` simulado y `document.hasFocus` en ambos valores
- [x] 4.2 El título de la ventana cuenta las decisiones pendientes de todos los repos abiertos — verificación: prueba con dos repos con 1 y 2 decisiones: título «(3) Needs you · OpenSpecControl»
- [x] 4.3 Criterio de aceptación de la fase: `npm test` pasa y los avisos del repo único no cambian

## 5. Verificación de extremo a extremo y documentación

- [x] 5.1 E2E con `agent-browser` por CDP (puerto propio) y dos repos de demostración: abrir ambos, ver las dos secciones, cambiar de repo conservando el cambio abierto, plegar, cerrar uno con y sin agente — verificación: informe de pasos OK/FALLA en `test/` y capturas fuera del repo versionado
- [x] 5.2 Con un agente en un repo en segundo plano, comprobar la marca de decisión pendiente en su sección y la notificación con su nombre — verificación: paso del E2E (la notificación del sistema se documenta como verificada o no verificada)
- [x] 5.3 Actualizar `docsplan/GUI_Spec.md` (secciones por repo, `RepoSection`, `RepoPicker` que abre) y `README.md`/`CLAUDE.md` si describen un solo repo — verificación: revisión del diff
- [x] 5.4 Criterio de aceptación del cambio: `npm run typecheck`, `npm run lint` (0 avisos), `npm test` y `npx electron-vite build` pasan, y el E2E 5.1 termina sin fallos

## Workflow follow-up

- Archivar el cambio cuando se cumplan los requisitos de revisión del proyecto (`/opsx:archive`).

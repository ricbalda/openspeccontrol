# Design

## Context

- `OscCore` ya trabaja con varios repos: guarda las sesiones de agente por repo (`hub`), los suscriptores por repo (`subscribers`) y un vigilante `chokidar` por repo; `onSessionChange` ya notifica los cambios de sesión de todos los repos (lo usa la insignia del icono). Un `subscribe` **suma** repos al mismo suscriptor; hoy no hay forma de quitar uno solo (`unsubscribe` quita al suscriptor de todos).
- El renderer guarda un solo repo en el `store` (`repo`, `session`, `events`, `changes`, `archived`, `specs`, `git`, `change`, `file`, `content`, `comments`, `rounds`, `browse`…). `selectRepo` lo reinicia todo, y `onServer` descarta los mensajes cuyo `repo` no sea el activo. Las acciones (`runAction`, `startAgent`, `sendPrompt`, `loadChanges`…) leen `get().repo`.
- `DocReview`, `AgentPanel` y los diálogos leen los campos del nivel superior del `store`; reescribirlos para que reciban un repo explícito sería mucho cambio y riesgo para poca ganancia.
- La lista fría de cambios con 40 cambios tarda 1,9–3,1 s en la primera carga (pendiente de la Fase 11); mostrar el estado guardado mientras se revalida lo disimula.

## Goals / Non-Goals

**Goals**
- Varios repos abiertos en el rail, un único repo activo en el centro y en el agente.
- Estado independiente por repo que sobreviva al cambio de repo.
- Enterarse de lo que pasa en los repos en segundo plano (decisiones pendientes, turnos terminados, archivos que cambian).
- Cerrar un repo de forma ordenada (confirmación si hay agente, dejar de vigilarlo).
- Cambios mínimos en `DocReview` y `AgentPanel`.

**Non-Goals**
- Ver dos repos a la vez en el centro o en el agente (paneles divididos, varias ventanas).
- Cambiar el núcleo de sesiones, el modelo de datos de la base o los workflows de OpenSpec.
- Agrupar o reordenar repos por carpeta, o arrastrar secciones para reordenarlas.

## Decisions

### D-A. El estado por repo vive en un mapa; los campos de nivel superior son la «proyección» del activo
`store` añade `openRepos: string[]`, `views: Record<string, RepoView>` y `collapsed: string[]`. `RepoView` guarda lo que el rail y el cambio de repo necesitan: `session`, `changes`, `archived`, `specs`, `workflows`, `reviewInRepo`, `git`, `changesLoaded`, `change`, `file`, `browse`. Los campos actuales (`changes`, `session`, `change`…) siguen siendo los del repo activo, de modo que `DocReview`, `AgentPanel` y los diálogos no cambian.

- Al **activar** otro repo: se guarda la proyección del anterior en `views[anterior]`, se restaura `views[nuevo]` (o un estado vacío si es la primera vez) y se revalida en segundo plano.
- Mientras un repo no es el activo, su `views[repo]` se actualiza directamente (lista de cambios, sesión, rama).
- **Alternativa descartada**: un `store` por repo con un contexto de React. Obliga a tocar todos los componentes y a duplicar suscripciones.

### D-B. El transcript y los comentarios no se cachean: se recargan al activar
Los eventos del agente (hasta 2000) y los comentarios/rondas se recargan al activar un repo: `subscribe` ya devuelve `session` + `replay`, y `loadReview()` lee los comentarios. Así no se duplican en memoria los transcripts de varios repos.

- **Consecuencia aceptada**: un borrador de comentario que se esté escribiendo en el `Composer` se pierde al cambiar de repo (los comentarios ya guardados no). Igual que hoy.
- Los avisos de turno terminado y de decisión pendiente salen de `SessionState.pendingInteractions` y de los mensajes `event` del repo, sin guardar el transcript.

### D-C. `onServer` procesa todos los repos abiertos
Se sustituye `if (m.repo !== get().repo) return` por un enrutado por repo:

| Mensaje | Repo activo | Repo en segundo plano |
| --- | --- | --- |
| `session` | `set` de proyección + `views` | solo `views[repo].session` |
| `event` | transcript con batching | solo avisos: permiso/elicitación → atención; `turn_end` → aviso de fin de turno |
| `replay` | reemplaza `events` | se ignora |
| `artifacts_changed` | `loadChanges` + `reloadFile` | `loadChangesFor(repo)` con debounce por repo |
| `review_changed` | `loadReview` si es el cambio abierto + `loadChanges` | `loadChangesFor(repo)` |

Los mensajes de un repo que no está en `openRepos` se ignoran.

### D-D. Acciones con `repo` explícito
`loadChanges`, `loadGit`, `startAgent`, `stopAgent`, `runAction` y las que usa `ChangeCard` aceptan un `repo` opcional (por defecto el activo). Cuando se ejecutan sobre un repo en segundo plano, **primero se activa** ese repo y luego se ejecuta la acción: así la respuesta, el transcript y el centro quedan coherentes con lo que el usuario ve. Las cargas en segundo plano (`loadChangesFor`) escriben solo en `views[repo]` y comprueban que el repo siga abierto al volver la respuesta.

### D-E. Cierre ordenado y `unsubscribe`
Nuevo `ClientMsg { type: 'unsubscribe'; repo }` (con su esquema zod) y `OscCore.unsubscribeRepo(sub, repo)`, que quita al suscriptor de ese repo y llama a `syncWatcher` (el vigilante se detiene si no hay suscriptores ni agente). Cerrar un repo en el renderer:

1. Si tiene sesión viva (`starting`, `ready`, `busy`): confirmación («Close *<repo>* and disconnect its agent?»); si se acepta, `stop` y luego `unsubscribe`.
2. Quita el repo de `openRepos` y de `views`; si era el activo, activa el primero de la lista o vuelve al estado «Pick a repository».

El `stop` en el núcleo ya detiene el agente; `unsubscribe` solo afecta al vigilante.

### D-F. Rail: una `RepoSection` por repo
`RepoRail` pasa a ser el contenedor; su contenido por repo se extrae a `RepoSection`:

- **Cabecera**: chevron (plegar), nombre del repo, rama, `AgentStatusDot`/insignia (`Working`, `Needs you` con el número de decisiones, `Ready`), botón de cerrar. La sección activa lleva borde de acento.
- **Cuerpo** (si no está plegada): `NewChangeButton`, filtro, secciones por etapa con `ChangeCard`, `SpecsSection` y `ArchivedSection`, tal como hoy pero leyendo de la `RepoView` de ese repo.
- Cada sección va en un `ErrorBoundary` con su propio nombre.
- Por defecto solo la sección activa está expandida; el usuario puede expandir otras. El estado de plegado se guarda en `localStorage` (`rail-collapsed`).

### D-G. `RepoPicker` abre, no cambia
El botón principal sigue mostrando «Repository» y el nombre del activo; su menú lista los repos del workspace, marca los abiertos y, al elegir uno, lo **abre y lo activa** (sin cerrar los otros). `AddFolderButton` y `ExplorerButton` se quedan junto al selector. La casilla «Keep review history in…» sigue actuando sobre el repo activo.

### D-H. Persistencia
`localStorage`: `open-repos` (JSON, lista de ids), `repo` (el activo, ya existe), `rail-collapsed` (JSON). Al arrancar, `boot()` abre cada id de `open-repos` que siga existiendo en `repos` y activa `repo`. La clave antigua `repo` (sin `open-repos`) siembra la lista con un solo repo. Cada repo abierto se suscribe (`subscribe`) al arrancar; las cargas de cambios de los repos en segundo plano se escalonan (de uno en uno) para no saturar `openspec list`.

### D-I. Límite de 8 repos abiertos
Constante `MAX_OPEN_REPOS = 8`. Cada repo abierto cuesta un vigilante de archivos y, con agente, un proceso hijo; 8 acota ambos sin molestar al uso real. Pasarse muestra un aviso (`toast`) y no abre el repo.

### D-J. Avisos de segundo plano
Se reutiliza `notify()` (Fase 5.3): el aviso de decisión pendiente y el de fin de turno incluyen el nombre del repo cuando no es el activo. Con la ventana con foco no hay notificación del sistema: basta la marca en la sección. El título de la ventana cuenta las decisiones pendientes de **todos** los repos abiertos («(n) Needs you · OpenSpecControl»), no solo del activo. La insignia del icono ya suma todos los repos (Fase 5) y no cambia.

## Comportamiento por sistema operativo

Windows, macOS y Linux se comportan igual: el cambio es de interfaz y de estado, sin rutas, procesos ni integraciones nativas nuevas. Las notificaciones del sistema ya tienen su propio comportamiento por sistema (Fase 5).

## Hallazgos del spike

No aplica: no hay spike en este cambio.

## Risks / Trade-offs

- **Dos fuentes de verdad** (campos de nivel superior y `views[activo]`) → las escrituras siempre pasan por funciones `saveView`/`restoreView`, y una prueba comprueba que ninguna carga en segundo plano toca los campos del activo.
- **Respuestas que llegan tarde** → cada carga compara el repo (y el alcance de git) al volver, como ya hace `loadChanges`.
- **Coste de `openspec list` por repo** → debounce por repo (200 ms), escalonado al arrancar y reutilización de la caché de cambios del núcleo (`changes-cache`).
- **Rail largo** → secciones plegables; solo la activa se expande por defecto.
- **Pérdida del borrador del `Composer` al cambiar de repo** → aceptada, igual que hoy; los comentarios guardados no se pierden.

## Migration Plan

Sin migración de datos. `localStorage`: si existe `repo` y no `open-repos`, la lista abierta es `[repo]`. Reversible: quitar las claves nuevas devuelve la app a un solo repo.

## Open Questions

Ninguna que cambie specs, enfoque o tareas.

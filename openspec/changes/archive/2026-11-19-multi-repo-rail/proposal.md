# Proposal

## Why

Hoy la app solo tiene **un repositorio activo**: `selectRepo` borra los cambios, los comentarios, el documento y el chat, y el renderer descarta los mensajes de los demás repos (`m.repo !== get().repo`). Quien trabaja con varios repos pierde su contexto al cambiar, y si un agente sigue trabajando o pide un permiso en otro repo no se entera. El núcleo (`OscCore`) ya mantiene sesiones y suscripciones por repo, así que el límite está en el renderer y en el `RepoRail`.

## What Changes

- El `RepoRail` muestra **varios repos abiertos a la vez**, cada uno como una sección plegable (`RepoSection`) con su nombre, rama, estado del agente y decisiones pendientes, y debajo sus cambios agrupados por etapa, specs y archivados.
- El `store` guarda el estado **por repo** (cambios, cambio y archivo abiertos, rama, sesión) y deja de borrarlo al cambiar de repo; sigue habiendo **un solo repo activo** en el centro (`DocReview`) y en el agente (`AgentPanel`).
- `RepoPicker` pasa de «cambiar de repo» a «**abrir** un repo»: elegir uno lo añade a la lista de abiertos y lo activa; no cierra los demás. Cada sección tiene un botón para **cerrar** el repo.
- La lista de repos abiertos, el repo activo y las secciones plegadas se **recuerdan** entre sesiones.
- El renderer procesa los mensajes de **todos** los repos abiertos: actualiza el estado de su sección y avisa (notificación del sistema con el nombre del repo) cuando un agente en segundo plano pide una decisión o termina un turno.
- Nuevo mensaje `unsubscribe` en el protocolo y `OscCore.unsubscribeRepo`, para dejar de vigilar un repo al cerrarlo.
- Se añade un límite de repos abiertos a la vez (8) para acotar vigilantes de archivos y sesiones.
- Al activar un repo ya abierto se muestra al instante su estado guardado y se revalida en segundo plano (stale-while-revalidate), lo que de paso cubre el pendiente de la lista fría lenta con muchos cambios.

## Capabilities

### New Capabilities
- `multi-repo-workspace`: varios repositorios abiertos a la vez en el rail, con un repo activo, estado independiente por repo, avisos en segundo plano y cierre ordenado.

### Modified Capabilities

(ninguna: el cambio `migrate-to-electron-desktop` aún no se ha archivado, así que `openspec/specs/` está vacío)

## Impact

- **Código**: `src/renderer/src/store.ts` (estado por repo, activar/abrir/cerrar, enrutado de mensajes), `src/renderer/src/panes/RepoRail.tsx` (secciones), `RepoPicker`, `DocReview.tsx` y `AgentPanel.tsx` (solo lectura del repo activo, sin cambios de comportamiento), `src/shared/protocol.ts` y `src/main/core/schemas.ts` (`unsubscribe`), `src/main/core/osc-core.ts` (`unsubscribeRepo`), `src/main/ipc.ts` si el canal valida mensajes, `docsplan/GUI_Spec.md`.
- **Usuarios**: cambia el rail: ahora lista repos abiertos en lugar de uno. Quien solo usa un repo ve una única sección, casi igual que hoy.
- **Dependencias**: ninguna.
- **Migración**: la clave `repo` de `localStorage` siembra la primera entrada de la lista de repos abiertos; no hay datos en disco que migrar.

## Estimación

**M** (≈ 4 oleadas pequeñas): protocolo y núcleo (S), estado por repo en el store (M, la parte delicada), secciones del rail (M) y avisos en segundo plano con verificación E2E con dos repos (S).

## Riesgos

- **Fugas de estado entre repos** (un cambio o comentario que aparece en el repo equivocado) → cada acción recibe el `repo` explícito, el estado se guarda en un mapa por id y hay pruebas con dos repos y respuestas que llegan tarde.
- **Carga de red/CPU al vigilar varios repos** (`openspec list`, `chokidar` por repo) → límite de 8 repos, recarga con debounce por repo y reutilización de la caché de cambios del núcleo.
- **Agentes huérfanos** al cerrar un repo con sesión viva → confirmar el cierre y desconectar el agente.
- **Rail demasiado largo con varios repos** → secciones plegables y recordadas; solo la activa se expande por defecto.

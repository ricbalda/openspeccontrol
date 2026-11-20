# Proposal

## Why

Hoy la única forma de pedir un cambio al agente es el diálogo **New change**: un cuadro de tres líneas que se envía al instante y no se guarda en ninguna parte. Una idea a medio pensar se pierde si cierras el diálogo, no se puede redactar con calma ni recuperar después lo que se pidió. Hacen falta borradores persistentes, con historial consultable, que se envíen a OpenSpec cuando estén listos.

## What Changes

- Nuevos **borradores de proposal por repositorio**, guardados en la base de datos local de la app (nunca en el repo), con título, contenido en markdown, fecha de creación y fecha de modificación.
- Nueva sección plegable **Drafts** en la sección de cada repositorio del rail: crear un borrador, listar el historial y buscar por título o contenido.
- **Editor de borradores** en el panel central, con vista previa del markdown y **autoguardado** mientras se escribe (sin botón Guardar).
- **Envío a OpenSpec como Explore o Propose** al agente del repositorio, con el mismo comando nativo que usa hoy **New change**.
- **Límite de 4000 caracteres** para enviar (el que ya aplica el núcleo a las acciones del agente): contador visible, advertencia al superarlo y envío bloqueado hasta recortarlo. Guardar no tiene ese límite.
- Un borrador enviado queda en el historial como **enviado** (modo y fecha de envío), en **solo lectura**, con **Duplicate** para crear un borrador nuevo editable a partir de él.
- Borrar un borrador desde el historial, con confirmación.
- Nuevos métodos en el contrato `window.osc` (`OscApi`) para listar, buscar, crear, guardar, duplicar, borrar y enviar borradores. Son cambios aditivos; ningún método existente cambia.

## Capabilities

### New Capabilities

- `proposal-drafts`: redacción, persistencia local, historial con búsqueda y envío a OpenSpec (Explore o Propose) de borradores de proposal por repositorio.

### Modified Capabilities

Ninguna. La sección **Drafts** se añade dentro de la sección de repositorio que ya define `multi-repo-workspace` sin cambiar sus requisitos.

## Impact

- **Código**:
  - Núcleo: `src/main/core/db.ts` (tabla de borradores con índice de texto completo), un módulo nuevo `src/main/core/drafts.ts`, `osc-core.ts` (métodos y envío) y `schemas.ts` (validación).
  - Puente IPC: `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` y `src/renderer/src/lib/api.ts`.
  - Renderer: `store.ts`, `panes/RepoSection.tsx` (sección Drafts), un panel nuevo de editor de borradores y `DocReview.tsx` (mostrarlo en el centro).
  - Tests en `test/main` y `test/renderer`.
- **Usuarios**: funcionalidad nueva; el diálogo **New change** sigue igual.
- **Dependencias**: ninguna nueva. La búsqueda usa el módulo de texto completo de SQLite (FTS5) que ya trae el `node:sqlite` de Electron 45, comprobado en esta máquina.
- **Migración**: la tabla y el índice se crean con `CREATE … IF NOT EXISTS` al abrir la base. Una base existente los recibe sin pasos manuales y no se toca ningún dato previo.
- **Configuración del proyecto**: las reglas de `openspec/config.yaml` (decisiones D1–D11, capacidades de la sección 7 del plan, fases 0–12) son propias de la migración `migrate-to-electron-desktop`. Este cambio no forma parte de ese plan, así que define su propia capacidad y su propia numeración de tareas. Respeta el contexto común: español, prefijo `osc` y datos en `~/.openspeccontrol`.

## Estimación

Tamaño **M**, unos 3–4 días de trabajo:

| Bloque | Tiempo |
| --- | --- |
| Persistencia y búsqueda | 0,5 días |
| Contrato IPC | 0,5 días |
| Envío al agente | 0,5 días |
| Sección Drafts en el rail | 0,5–1 día |
| Editor con autoguardado | 1 día |
| Verificación E2E y documentación | 0,5 días |

## Riesgos

- **Pérdida del último segundo de escritura** si la ventana se cierra o se recarga antes del autoguardado. Mitigación: forzar el guardado al cambiar de borrador, de repo o de vista y al perder la ventana el foco.
- **Envío que el agente rechaza** (por ejemplo, porque ya está trabajando). Mitigación: el borrador solo pasa a enviado cuando el núcleo acepta la acción; si falla, sigue editable y se muestra el error.
- **Búsqueda con términos muy cortos**: el índice de texto completo necesita al menos 3 caracteres. Mitigación: con 1–2 caracteres se filtra por subcadena sin índice (ver `design.md`).
- **Crecimiento de la base de datos** con borradores largos. Mitigación: tope de tamaño por borrador, validado en el núcleo.

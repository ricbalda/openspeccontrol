# Design

## Context

- **New change** (`src/renderer/src/panes/RepoRail.tsx`, `NewChangeDialog`) llama a `runAction('propose' | 'explore', undefined, text)`. Esa función activa el repositorio, conecta el agente si hace falta (`ensureAgent`, hasta 90 s) e invoca `api.action`. En el núcleo, `OscCore.action` arma el comando del agente (`agent.command(action, args)`) y lo envía. Desde ahí, ningún texto se guarda.
- `actionBody.text` está limitado a **4000 caracteres** con `capped(4000)` (`src/main/core/schemas.ts`): lo que exceda se **recorta sin avisar**.
- La base de datos (`src/main/core/db.ts`, `node:sqlite`, WAL) crea su esquema con `CREATE … IF NOT EXISTS` en `openDb()` y expone almacenes simples (`sessions`, `events`, `comments`, `rounds`, `cliViews`).
- El panel central decide qué mostrar según `browse` en `store.ts` (`{ kind: 'spec' }`, `{ kind: 'archived' }` o un cambio). Las secciones plegables **Specs** y **Archived** viven en `RepoSection.tsx`.
- Cada capacidad nueva sigue el flujo de `CLAUDE.md`: método en `OscCore` → zod + `handle(...)` en `src/main/ipc.ts` → firma en `OscApi` → función explícita en el preload → `lib/api.ts`.

## Goals / Non-Goals

**Goals:**

- Borradores locales por repositorio con búsqueda de texto completo, sin dependencias nuevas.
- Reutilizar el camino de envío existente (`OscCore.action`), sin un segundo modo de hablar con el agente.
- Que el núcleo, no solo la UI, imponga las reglas (límite de 4000, enviado inmutable).

**Non-Goals:**

- Sincronizar borradores entre máquinas o guardarlos en el repositorio.
- Historial de versiones de un mismo borrador (la duplicación cubre la iteración).
- Detectar qué cambio OpenSpec creó el agente a partir de un borrador enviado.
- Plantillas de borrador o editor WYSIWYG.
- Cambiar el diálogo **New change**.

## Decisions

### D-1. Tabla `drafts` en la base de la app, con índice FTS5 de contenido externo

```sql
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,            -- uuid
  repo TEXT NOT NULL,             -- id del repo (ruta absoluta), como el resto de tablas
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'sent'
  sent_mode TEXT,                 -- 'explore' | 'propose' (solo si sent)
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS drafts_by_repo ON drafts (repo, updated_at);
CREATE VIRTUAL TABLE IF NOT EXISTS drafts_fts USING fts5(
  title, body, content='drafts', content_rowid='rowid',
  tokenize='trigram remove_diacritics 1'
);
-- triggers AFTER INSERT / AFTER DELETE / AFTER UPDATE OF title, body mantienen drafts_fts
```

- **Por qué FTS5 con `trigram`:** encuentra subcadenas («export» en «Exportación»), y `remove_diacritics 1` ignora acentos y mayúsculas. Lo comprobé en el `node:sqlite` de Electron 45.3.4 (SQLite 3.54.1): «busqueda» encuentra «Búsqueda», y «BÚSQ», «csv del» e «informe» también encuentran el borrador.
- **Contenido externo con triggers:** el texto se guarda una sola vez (en `drafts`) y el índice se actualiza dentro de la misma transacción.
- **Columnas reales, no un `json`** como en `comments`: hacen falta ordenar por `updated_at`, filtrar por `repo` y unir con el índice.
- **Alternativas descartadas:**
  - `LIKE '%q%'` siempre: correcto pero sin índice y sensible a acentos.
  - Tokenizador `unicode61`: no encuentra fragmentos dentro de una palabra.
  - Un archivo JSON en `OSC_DATA`: sin búsqueda y sin transacciones.

### D-2. Términos de búsqueda de menos de 3 caracteres

El tokenizador `trigram` no indexa términos de 1–2 caracteres. Para esos se usa `LIKE` sobre `title` y `body`, escapando `%` y `_`. Para no distinguir mayúsculas se normaliza en JavaScript (NFD sin marcas diacríticas y en minúsculas). Con pocos borradores por repo, el costo es irrelevante.

La consulta FTS se arma como una frase entre comillas, escapando las comillas internas. Así el texto del usuario nunca se interpreta como sintaxis FTS (`OR`, `NEAR`, `*`, `-`).

### D-3. Módulo `src/main/core/drafts.ts` sin `electron`

Contiene las funciones `list(repo, query?)`, `get(id)`, `create(repo)`, `save(id, { title, body })`, `duplicate(id)`, `remove(id)` y `markSent(id, mode)`. Usa `getDb()` y no importa nada de Electron, igual que el resto del núcleo. `OscCore` las expone y comprueba el repositorio con `repoOf()`.

**Reglas que impone el núcleo:**

| Situación | Respuesta |
| --- | --- |
| `save` sobre un borrador enviado | `OscError('conflict')` |
| `send` con más de 4000 caracteres | `OscError('too_large')` (no recorta) |
| Id inexistente | `OscError('not_found')` |

### D-4. Contrato IPC aditivo

```ts
interface DraftSummary { id; repo; title; status: 'draft' | 'sent'; sentMode: 'explore' | 'propose' | null;
  createdAt; updatedAt; sentAt: string | null; length: number }
interface Draft extends DraftSummary { body: string }

drafts(repo: string, query?: string): Promise<DraftSummary[]>
draft(id: string): Promise<Draft>
createDraft(repo: string): Promise<Draft>
saveDraft(id: string, patch: { title?: string; body?: string }): Promise<Draft>
duplicateDraft(id: string): Promise<Draft>
deleteDraft(id: string): Promise<{ ok: true }>
sendDraft(id: string, mode: 'explore' | 'propose'): Promise<Draft>
```

- **Validación zod:** título hasta 200 caracteres, `body` hasta 100 000 (tope de almacenamiento; el límite de envío es aparte), consulta hasta 200 caracteres y `mode` como `enum`. A diferencia de `capped()`, un texto que excede los topes se **rechaza** con `too_large`, no se recorta: recortar en silencio un borrador perdería texto del usuario.
- **Límite compartido:** `MAX_ACTION_TEXT = 4000` se mueve a `src/shared/ipc.ts`. Lo usan el contador del editor y `actionBody` (que sigue usando `capped(MAX_ACTION_TEXT)`, sin cambio de comportamiento para **New change**).
- **Sin `ServerMsg` nuevo:** hay una sola ventana y el renderer recarga la lista tras cada operación propia.

### D-5. Envío reutilizando `OscCore.action`

`sendDraft(id, mode)` en el núcleo sigue estos pasos:

1. Carga el borrador y exige `status = 'draft'`.
2. Exige `body.trim().length ≤ 4000`, y que no esté vacío si el modo es `propose`.
3. Llama a `this.action({ repo, action: mode, text: body.trim() })`.
4. Si `action` no lanza, ejecuta `markSent`.

Si no hay sesión o el agente está ocupado, `action` lanza y el borrador queda intacto.

- **Qué se envía:** solo el contenido. El título sirve para organizar el historial y no se envía, para que el agente reciba lo mismo que con **New change**.
- **Conexión del agente:** el renderer ejecuta antes `ensureAgent()` (como `runAction`), porque la conexión depende del estado de la UI (agente elegido por repo).

### D-6. UI: sección Drafts y editor en el panel central

- **`DraftsSection` en `RepoSection.tsx`:** se coloca junto a **Specs** y **Archived**, plegable, con el mismo estado local de plegado que esas dos. Incluye **New draft**, un buscador (con espera de 250 ms entre teclas) y la lista con título (o «Untitled draft»), fecha relativa y una insignia «Sent · explore/proposal».
- **Apertura en el centro:** `browse: { kind: 'draft', id }` en `store.ts`, y `DocReview.tsx` muestra `DraftEditor`.
- **`DraftEditor`:** tiene título, un `textarea` de contenido, un conmutador **Edit / Preview** (reutiliza el renderizado markdown de `ReadOnlyDoc`), el contador `n / 4000`, el indicador **Saving… / Saved / Not saved** y los botones **Explore**, **Propose**, **Duplicate** y **Delete**. Un borrador enviado muestra el contenido en solo lectura, con su modo y su fecha, y solo **Duplicate** y **Delete**.
- **Autoguardado:** espera de 1 s tras la última pulsación. La función `flushDraft()` del store fuerza el guardado pendiente y se llama al cambiar `browse`, al activar otro repo, en `blur` de los campos y en `visibilitychange`/`beforeunload` (intento de mejor esfuerzo).
- **Borrar:** usa el `Dialog` de confirmación existente.
- **Idioma:** la interfaz está en inglés, como el resto de la app que no es menú nativo.

### D-7. Seguridad

No hay archivos nuevos ni rutas del renderer: todo vive en la base local. Los handlers siguen el patrón de siempre: `makeTrustedSender`, zod y el envelope `IpcResult`. El contenido de un borrador llega al agente por el mismo camino que el texto de **New change**, así que los permisos del agente no cambian.

## Hallazgos del spike

No hubo spike formal (la regla de `config.yaml` sobre la tarea 0.6 es de la migración). Lo comprobado durante el análisis:

- **FTS5 disponible:** `node:sqlite` de Electron 45.3.4 (SQLite 3.54.1) crea tablas `fts5` con los tokenizadores `trigram remove_diacritics 1` y `unicode61 remove_diacritics 2`.
- **Búsqueda sin acentos:** con contenido externo y `rebuild`, las búsquedas «busqueda», «BÚSQ», «csv del» e «informe» encuentran el texto «Añadir Búsqueda / Exportar CSV del informe».

## Comportamiento por plataforma

No difiere entre Windows, macOS y Linux: todo ocurre en la base local y en la UI. La única diferencia es el atajo de envío del editor, `Ctrl+Enter` o `Cmd+Enter`, como en el resto de la app.

## Risks / Trade-offs

- **[Cierre con texto sin guardar]** → `flushDraft()` en `blur`, `visibilitychange` y cambio de vista. Puede perderse como máximo el último segundo si el proceso muere.
- **[Envío aceptado pero el turno falla después]** → El borrador queda «enviado» porque el comando sí llegó, igual que **New change**. **Duplicate** permite reintentar.
- **[Índice FTS desincronizado]** → Los triggers van en la misma transacción. Un test verifica insertar, editar y borrar, y si hiciera falta existe `INSERT INTO drafts_fts(drafts_fts) VALUES('rebuild')`.
- **[Borradores huérfanos de repos que ya no existen]** → Se conservan a propósito: el requisito pide que reaparezcan al volver a añadir la carpeta. Limpiarlos queda fuera de alcance.

## Migration Plan

- La tabla, el índice y los triggers se crean con `IF NOT EXISTS` en `openDb()`, así que no hay versión de esquema que subir.
- La base importada de Studio no tiene borradores y no se ve afectada.
- **Vuelta atrás:** una versión anterior de la app ignora las tablas nuevas.

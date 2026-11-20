import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Eye,
  GitBranch,
  GitMerge,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react'
import type {
  ChangeStage,
  ChangeSummary,
  LifecycleAction,
  OptionalWorkflow,
  SessionState,
  SpecSummary
} from '@shared/protocol.ts'
import {
  activateRepo,
  createDraft,
  loadDrafts,
  openArchived,
  openChange,
  openDraft,
  openSpec,
  runAction,
  toggleCollapsed,
  useStore
} from '../store.ts'
import { issueCounts } from '../review/ValidationPanel.tsx'
import { Badge, Button, cx, IconButton, Menu, MenuItem, timeAgo } from '../lib/ui.tsx'

const STAGES: { id: ChangeStage; label: string; hint: string }[] = [
  { id: 'draft', label: 'Drafting', hint: 'Planning artifacts in progress' },
  { id: 'review', label: 'In review', hint: 'Read and comment' },
  { id: 'ready', label: 'Ready to build', hint: 'Reviewed, not implemented' },
  { id: 'applying', label: 'Building', hint: 'Tasks in progress' },
  { id: 'done', label: 'Done', hint: 'Sync specs and archive' }
]

// Valores por defecto estables: los selectores del store devuelven estas refs cuando
// el repo aún no tiene RepoView (evita re-renders y objetos nuevos en cada set).
const NO_CHANGES: ChangeSummary[] = []
const NO_LIST: string[] = []
const NO_SPECS: SpecSummary[] = []
const NO_WORKFLOWS: OptionalWorkflow[] = []

/** Clic o acción sobre algo de un repo en segundo plano: se activa antes (D-D,
 *  spec «Abrir un cambio de otro repositorio»), y luego se ejecuta sobre él. */
function withRepo(repo: string, run: () => void) {
  if (useStore.getState().repo !== repo) activateRepo(repo)
  run()
}

/** Estado del agente en la cabecera de una sección (D-F): Working / Needs you con
 *  el número de decisiones pendientes / Ready; sin sesión viva no hay marca. */
function AgentStatusBadge({ session }: { session: SessionState | null }) {
  if (!session) return null
  if (session.status !== 'starting' && session.status !== 'ready' && session.status !== 'busy')
    return null
  const pending = session.pendingInteractions
  if (pending > 0)
    return (
      <span
        className="shrink-0"
        title={`${pending} decision${pending === 1 ? '' : 's'} pending in this repository`}
      >
        <Badge tone="warn" className="whitespace-nowrap">
          Needs you · {pending}
        </Badge>
      </span>
    )
  if (session.status === 'busy' || session.status === 'starting')
    return (
      <Badge tone="info" className="shrink-0 whitespace-nowrap">
        Working
      </Badge>
    )
  return (
    <Badge tone="ok" className="shrink-0 whitespace-nowrap">
      Ready
    </Badge>
  )
}

const ART_LABEL: Record<string, string> = {
  proposal: 'Proposal',
  specs: 'Specs',
  design: 'Design',
  tasks: 'Tasks'
}

/** Planning artifacts as labeled chips, so they don't read as a progress bar. */
function ArtifactChips({ c }: { c: ChangeSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {c.artifacts.map((a) => {
        const done = a.status === 'done'
        return (
          <span
            key={a.id}
            title={`${ART_LABEL[a.id] ?? a.id}: ${done ? 'written' : a.status === 'ready' ? 'not written yet' : 'blocked'}`}
            className={cx(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-[10.5px] font-medium',
              done ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-muted'
            )}
          >
            {done ? (
              <Check size={10} strokeWidth={3} />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full border border-current" />
            )}
            {ART_LABEL[a.id] ?? a.id}
          </span>
        )
      })}
    </div>
  )
}

function primaryAction(
  c: ChangeSummary,
  go: {
    change: () => void
    action: (a: LifecycleAction, change?: string, text?: string) => void
    archive: () => void
  }
): { label: string; icon: typeof Play; run: () => void } {
  switch (c.stage) {
    case 'draft':
      return {
        label: 'Continue',
        icon: Pencil,
        run: () => go.action('update', c.name, 'Continue creating the missing planning artifacts.')
      }
    case 'review':
      return { label: 'Review', icon: Eye, run: go.change }
    case 'ready':
      return { label: 'Build it', icon: Play, run: () => go.action('apply', c.name) }
    case 'applying':
      return { label: 'Continue', icon: Play, run: () => go.action('apply', c.name) }
    case 'done':
      return { label: 'Archive', icon: Archive, run: go.archive }
  }
}

/** A small mark when `openspec validate` found problems in the change. */
function ValidationMark({ c }: { c: ChangeSummary }) {
  const { errors, warnings } = issueCounts(c)
  if (!errors && !warnings) return null
  return (
    <span
      className={cx('flex items-center gap-0.5', errors ? 'text-bad' : 'text-warn')}
      title={`openspec validate: ${errors} error(s), ${warnings} warning(s). Open the change to see them.`}
    >
      <ShieldAlert size={11} /> {errors || warnings}
    </span>
  )
}

/** Tarjeta de un cambio. Pertenece a la sección de su repo: el clic y las acciones
 *  sobre la tarjeta de un repo en segundo plano activan ese repo primero (tarea 3.4). */
function ChangeCard({
  c,
  repo,
  onArchive
}: {
  c: ChangeSummary
  repo: string
  onArchive: (repo: string, name: string) => void
}) {
  // lo abierto y la sesión/flows son los DEL repo de la tarjeta (proyección si es el activo)
  const active = useStore((s) => s.repo === repo && s.change === c.name)
  const session = useStore((s) => (s.repo === repo ? s.session : (s.views[repo]?.session ?? null)))
  const hasVerify = useStore((s) =>
    (s.repo === repo ? s.workflows : (s.views[repo]?.workflows ?? NO_WORKFLOWS)).includes('verify')
  )
  const busy = session?.status === 'busy'
  const go = {
    change: () => withRepo(repo, () => void openChange(c.name)),
    // runAction ya activa el repo (D-D); pasarle el repo evita reactivarlo aquí
    action: (a: LifecycleAction, change?: string, text?: string) =>
      void runAction(a, change, text, repo),
    archive: () => withRepo(repo, () => onArchive(repo, c.name))
  }
  const p = primaryAction(c, go)
  const pct = c.totalTasks ? Math.round((c.completedTasks / c.totalTasks) * 100) : 0
  return (
    <div
      onClick={go.change}
      className={cx(
        'group cursor-pointer rounded-xl border bg-surface p-2.5 transition hover:shadow-sm',
        active ? 'border-accent ring-2 ring-accent/15' : 'border-line hover:border-line-strong'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold" title={c.name}>
            {c.name}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            <span>{timeAgo(c.lastModified)}</span>
            {c.openComments > 0 && (
              <span className="flex items-center gap-0.5 text-warn">
                <MessageSquare size={11} /> {c.openComments}
              </span>
            )}
            <ValidationMark c={c} />
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Menu
            align="right"
            trigger={(t) => (
              <IconButton
                title="More actions"
                onClick={t}
                className="opacity-60 group-hover:opacity-100"
              >
                <MoreHorizontal size={15} />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Eye />}
                  onClick={() => {
                    go.change()
                    close()
                  }}
                >
                  Open for review
                </MenuItem>
                <MenuItem
                  icon={<Compass />}
                  disabled={busy}
                  onClick={() => {
                    go.action('explore', undefined, `the change "${c.name}"`)
                    close()
                  }}
                >
                  Explore with agent
                </MenuItem>
                <MenuItem
                  icon={<Sparkles />}
                  disabled={busy}
                  onClick={() => {
                    go.action('update', c.name)
                    close()
                  }}
                >
                  Check coherence
                </MenuItem>
                <MenuItem
                  icon={<Play />}
                  disabled={busy}
                  onClick={() => {
                    go.action('apply', c.name)
                    close()
                  }}
                >
                  Build (apply)
                </MenuItem>
                <MenuItem
                  icon={<ShieldCheck />}
                  disabled={busy || !hasVerify}
                  hint={hasVerify ? undefined : 'not installed'}
                  onClick={() => {
                    go.action('verify', c.name)
                    close()
                  }}
                >
                  Verify implementation
                </MenuItem>
                <MenuItem
                  icon={<GitMerge />}
                  disabled={busy}
                  onClick={() => {
                    go.action('sync', c.name)
                    close()
                  }}
                >
                  Sync specs
                </MenuItem>
                <MenuItem
                  icon={<Archive />}
                  danger
                  disabled={busy}
                  onClick={() => {
                    go.archive()
                    close()
                  }}
                >
                  Archive…
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
      <div className="mt-2">
        <ArtifactChips c={c} />
      </div>
      {c.totalTasks > 0 && (
        <div
          className="mt-2 flex items-center gap-2"
          title="Implementation tasks done (tasks.md checkboxes)"
        >
          <span className="text-[10.5px] font-medium text-muted">Build</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10.5px] tabular-nums text-muted">
            {c.completedTasks}/{c.totalTasks} tasks
          </span>
        </div>
      )}
      {(c.stage === 'ready' || c.stage === 'applying') && c.nextTask && (
        <div
          className="mt-1 truncate text-[11px] text-muted"
          title={`Next task in tasks.md: ${c.nextTask}`}
        >
          Next: {c.nextTask}
        </div>
      )}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1.5">
          {c.stage === 'done' && hasVerify && (
            <Button
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => go.action('verify', c.name)}
              title="Ask the agent to check the code against the specs, tasks and design before archiving"
            >
              <ShieldCheck size={13} /> Verify
            </Button>
          )}
          <Button
            size="sm"
            variant={c.stage === 'review' ? 'secondary' : 'primary'}
            className="flex-1"
            disabled={busy && c.stage !== 'review'}
            onClick={p.run}
          >
            <p.icon size={13} /> {p.label}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The section's own "New change" button (D-F): it targets this repository. */
function NewChangeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" size="lg" className="w-full" onClick={onClick}>
      <Plus size={16} /> New change
    </Button>
  )
}

function SpecsSection({
  repo,
  specs,
  current
}: {
  repo: string
  specs: SpecSummary[]
  current: string | null
}) {
  const [show, setShow] = useState(false)
  return (
    <section>
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg-2"
        title="The main specs: what the system does today (openspec/specs)"
      >
        {show ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Specs{' '}
        <span className="font-normal">{specs.length}</span>
      </button>
      {show && (
        <ul className="mt-1.5 space-y-0.5">
          {specs.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => withRepo(repo, () => void openSpec(s.name))}
                title={`openspec/${s.file}`}
                className={cx(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.5px] hover:bg-surface-2',
                  current === s.name ? 'bg-accent-soft text-accent' : 'text-fg-2'
                )}
              >
                <BookOpen size={13} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate font-mono">{s.name}</span>
                <span className="text-[10.5px] tabular-nums text-muted">{s.requirements} req</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ArchivedSection({
  repo,
  archived,
  current
}: {
  repo: string
  archived: string[]
  current: string | null
}) {
  const [show, setShow] = useState(false)
  return (
    <section>
      <button
        onClick={() => setShow(!show)}
        className="flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg-2"
      >
        {show ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Archived{' '}
        <span className="font-normal">{archived.length}</span>
      </button>
      {show && (
        <ul className="mt-1.5 space-y-0.5">
          {archived.map((a) => (
            <li key={a}>
              <button
                type="button"
                onClick={() => withRepo(repo, () => void openArchived(a))}
                title={`openspec/changes/archive/${a}`}
                className={cx(
                  'w-full truncate rounded-lg px-2 py-1 text-left font-mono text-[11.5px] hover:bg-surface-2',
                  current === a ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg-2'
                )}
              >
                {a}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** add-proposal-drafts (D-6): espera del buscador de la sección Drafts, en ms. */
const DRAFT_SEARCH_DEBOUNCE_MS = 250

/**
 * add-proposal-drafts (D-6): sección Drafts del rail, junto a Specs y Archived y
 * plegable como ellas. «New draft» crea un borrador de este repo (en un repo en
 * segundo plano lo activa antes, D-D); el buscador espera 250 ms entre teclas y
 * la búsqueda sin acentos la resuelve el núcleo (D-2); cada entrada muestra su
 * título (o «Untitled draft»), la fecha relativa y, si se envió, la insignia
 * «Sent · explore/propose». Interfaz en inglés, como el resto de la app.
 */
function DraftsSection({ repo, current }: { repo: string; current: string | null }) {
  const [show, setShow] = useState(false)
  const [q, setQ] = useState('')
  // undefined = aún sin cargar (sección recién desplegada): ni lista ni avisos
  const drafts = useStore((s) => s.draftsByRepo[repo])
  // carga al desplegar y, con 250 ms de espera entre teclas, tras cada consulta
  useEffect(() => {
    if (!show) return
    const t = setTimeout(() => void loadDrafts(repo, q.trim()), q ? DRAFT_SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(t)
  }, [show, q, repo])
  return (
    <section>
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg-2"
        title="Proposal drafts kept in OpenSpecControl (never written to the repository)"
      >
        {show ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Drafts{' '}
        <span className="font-normal">{drafts?.length ?? 0}</span>
      </button>
      {show && (
        <div className="mt-1.5 space-y-1.5">
          <Button
            size="sm"
            className="w-full"
            onClick={() => void createDraft(repo)}
            title="Create an empty draft for this repository and open it in the editor"
          >
            <Plus size={13} /> New draft
          </Button>
          {drafts && drafts.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1">
              <Search size={13} className="text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search drafts…"
                aria-label="Search drafts"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  title="Clear search"
                  className="text-muted hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <ul className="space-y-0.5">
            {(drafts ?? []).map((d) => (
              <li key={d.id} data-draft-id={d.id}>
                <button
                  type="button"
                  onClick={() => withRepo(repo, () => openDraft(d.id))}
                  title={d.title || 'Untitled draft'}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.5px] hover:bg-surface-2',
                    current === d.id ? 'bg-accent-soft text-accent' : 'text-fg-2'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{d.title || 'Untitled draft'}</span>
                  {d.status === 'sent' && d.sentMode && (
                    <Badge tone="ok" className="shrink-0 whitespace-nowrap">
                      Sent · {d.sentMode}
                    </Badge>
                  )}
                  <span
                    className="shrink-0 text-[10.5px] tabular-nums text-muted"
                    title={`Last modified ${d.updatedAt}`}
                  >
                    {timeAgo(d.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {drafts && drafts.length === 0 && !q.trim() && (
            <div className="px-2 py-2 text-center text-[11px] text-muted">No drafts yet.</div>
          )}
          {drafts && drafts.length === 0 && q.trim() && (
            <div className="px-2 py-2 text-center text-[11px] text-muted">
              No drafts match &quot;{q.trim()}&quot;.{' '}
              <button
                type="button"
                onClick={() => setQ('')}
                className="text-accent hover:underline"
              >
                Clear search
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * multi-repo-rail (D-F): una sección plegable por repo abierto. La cabecera lleva
 * chevron, nombre, rama, estado del agente y botón de cerrar (la activa, borde de
 * acento); el cuerpo, «New change», filtro, cambios por etapa, specs y archivados.
 * La sección del repo activo lee la proyección del store; las demás, su RepoView.
 */
export function RepoSection({
  id,
  onNewChange,
  onArchive,
  onClose
}: {
  id: string
  /** «New change» de esta sección: activa el repo y abre el diálogo. */
  onNewChange: (repo: string) => void
  /** «Archive…» de una tarjeta: activa el repo y pide confirmación. */
  onArchive: (repo: string, name: string) => void
  /** Cierra la sección (con confirmación si su agente está conectado). */
  onClose: (repo: string) => void
}) {
  const active = useStore((s) => s.repo === id)
  const collapsed = useStore((s) => s.collapsed.includes(id))
  const info = useStore((s) => s.repos.find((r) => r.id === id))
  const session = useStore((s) => (s.repo === id ? s.session : (s.views[id]?.session ?? null)))
  const git = useStore((s) => (s.repo === id ? s.git : (s.views[id]?.git ?? null)))
  const changes = useStore((s) =>
    s.repo === id ? s.changes : (s.views[id]?.changes ?? NO_CHANGES)
  )
  const archived = useStore((s) =>
    s.repo === id ? s.archived : (s.views[id]?.archived ?? NO_LIST)
  )
  const specs = useStore((s) => (s.repo === id ? s.specs : (s.views[id]?.specs ?? NO_SPECS)))
  const browse = useStore((s) => (s.repo === id ? s.browse : (s.views[id]?.browse ?? null)))
  const changesLoaded = useStore((s) =>
    s.repo === id ? s.changesLoaded : (s.views[id]?.changesLoaded ?? false)
  )
  // tarea 11.5: inferred (not yet confirmed) list, and why a refresh failed
  const changesStale = useStore((s) =>
    s.repo === id ? s.changesStale : (s.views[id]?.changesStale ?? false)
  )
  const changesError = useStore((s) =>
    s.repo === id ? s.changesError : (s.views[id]?.changesError ?? null)
  )
  const [filter, setFilter] = useState('')
  const name = info?.name ?? id
  const branch = git?.repo ? git.branch : null
  // newest first within a stage; the filter matches the change name
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const shown = changes
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    return STAGES.map((s) => ({ ...s, items: shown.filter((c) => c.stage === s.id) })).filter(
      (g) => g.items.length
    )
  }, [changes, filter])

  return (
    <div
      data-repo={id}
      className={cx('rounded-xl border', active ? 'border-accent' : 'border-transparent')}
    >
      <div className="flex items-center gap-0.5 py-1 pr-1">
        <IconButton
          title={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          onClick={() => toggleCollapsed(id)}
          className="shrink-0"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </IconButton>
        <button
          type="button"
          onClick={() => {
            if (!active) activateRepo(id)
          }}
          title={active ? name : `Show ${name}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-surface-2"
        >
          <span className="min-w-0 truncate text-[12.5px] font-semibold" title={id}>
            {name}
          </span>
          {branch && (
            <span
              className="flex min-w-0 items-center gap-0.5 font-mono text-[10.5px] text-muted"
              title={`Current branch: ${branch}`}
            >
              <GitBranch size={10} className="shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
          <AgentStatusBadge session={session} />
        </button>
        <IconButton
          title={`Close ${name}`}
          onClick={() => onClose(id)}
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          <X size={13} />
        </IconButton>
      </div>
      {!collapsed && info?.openspec && (
        <div className="space-y-3 px-2 pb-2.5">
          {changesLoaded && changesError && (
            <div
              className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-warn"
              title={changesError}
            >
              <ShieldAlert size={12} className="mt-px shrink-0" />
              <span>Couldn&apos;t confirm with the openspec CLI — showing local state.</span>
            </div>
          )}
          {changesLoaded && !changesError && changesStale && (
            <div
              className="flex items-center gap-1.5 px-1 text-[11px] text-muted"
              data-stale-changes=""
              title="The list is read from the repo folder; the openspec CLI (validation, exact artifact states) is still checking and will replace it"
            >
              <Loader2 size={11} className="animate-spin" />
              Checking changes with the openspec CLI…
            </div>
          )}
          <NewChangeButton onClick={() => onNewChange(id)} />
          {!changesLoaded &&
            [0, 1].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-line bg-surface"
              />
            ))}
          {changesLoaded && !changes.length && (
            <div className="px-2 py-6 text-center text-xs text-muted">No active changes yet.</div>
          )}
          {changes.length >= 4 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1">
              <Search size={13} className="text-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter changes…"
                aria-label="Filter changes"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  title="Clear filter"
                  className="text-muted hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {changes.length > 0 && !grouped.length && (
            <div className="px-2 py-3 text-center text-xs text-muted">
              No change matches &quot;{filter}&quot;.
            </div>
          )}
          {grouped.map((g) => (
            <section key={g.id}>
              <div className="mb-1.5 flex items-baseline gap-2 px-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-2">
                  {g.label}
                </h3>
                <span className="text-[11px] text-muted">{g.items.length}</span>
              </div>
              <div className="space-y-2">
                {g.items.map((c) => (
                  <ChangeCard key={c.name} c={c} repo={id} onArchive={onArchive} />
                ))}
              </div>
            </section>
          ))}
          {specs.length > 0 && (
            <SpecsSection
              repo={id}
              specs={specs}
              current={browse?.kind === 'spec' ? browse.name : null}
            />
          )}
          {archived.length > 0 && (
            <ArchivedSection
              repo={id}
              archived={archived}
              current={browse?.kind === 'archived' ? browse.name : null}
            />
          )}
          <DraftsSection repo={id} current={browse?.kind === 'draft' ? browse.id : null} />
        </div>
      )}
    </div>
  )
}

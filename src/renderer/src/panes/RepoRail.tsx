import { useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  Compass,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import type { RepoInfo } from '@shared/protocol.ts'
import {
  activateRepo,
  closeRepo,
  loadRepos,
  openAddFolder,
  openRepo,
  removeRoot,
  runAction,
  setReviewInRepo,
  showRepoInExplorer,
  toggleCollapsed,
  useStore
} from '../store.ts'
import { ErrorBoundary } from '../lib/ErrorBoundary.tsx'
import { RepoSection } from './RepoSection.tsx'
import { Badge, Button, Chip, cx, Dialog, IconButton, useDismiss } from '../lib/ui.tsx'

/** Keep the end of a long path, which is the part that tells folders apart. */
const shortPath = (p: string, max = 46) => (p.length > max ? `…${p.slice(-(max - 1))}` : p)

function RepoPicker() {
  const { repos, repo, roots, reposLoaded, reviewInRepo, git, openRepos } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const match = (r: RepoInfo) => `${r.name} ${r.rel}`.toLowerCase().includes(q.toLowerCase())
  const cur = repos.find((r) => r.id === repo)
  // multi-repo-rail (D-G): elegir un repo lo ABRE y lo activa; no cierra los demás
  const pick = (id: string) => {
    const wasOpen = openRepos.includes(id)
    if (openRepo(id) && !wasOpen) {
      // D-F: por defecto solo la sección activa queda expandida; el usuario puede
      // reexpandir las otras (se recuerda en 'rail-collapsed')
      const { openRepos: now, collapsed } = useStore.getState()
      for (const r of now) {
        if (r === id ? collapsed.includes(r) : !collapsed.includes(r)) toggleCollapsed(r)
      }
    }
    setOpen(false)
    setQ('')
  }
  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-sm hover:border-line-strong"
        >
          <FolderGit2 size={17} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-muted">Repository</span>
            <span className="block truncate text-[13.5px] font-semibold" title={cur?.id}>
              {cur?.name ?? 'Choose a repo'}
            </span>
            {cur && git?.repo && (
              <span
                className={cx(
                  'flex min-w-0 items-center gap-1 font-mono text-[11px]',
                  git.onBase || !git.branch ? 'text-warn' : 'text-muted'
                )}
                title={
                  !git.branch
                    ? 'HEAD is detached: commits will not be on any branch'
                    : git.onBase
                      ? `On ${git.branch}, the main branch: changes and builds land on it directly. Work on a branch per change.`
                      : `Current branch: ${git.branch}`
                }
              >
                <GitBranch size={11} className="shrink-0" />{' '}
                <span className="min-w-0 truncate">{git.branch ?? 'detached HEAD'}</span>
              </span>
            )}
          </span>
          <ChevronDown size={15} className="shrink-0 text-muted" />
        </button>
        <IconButton title="Add folder…" onClick={() => openAddFolder()} className="shrink-0">
          <FolderPlus size={14} />
        </IconButton>
        {cur && (
          <IconButton
            title={`Show ${cur.name} in the file manager`}
            onClick={showRepoInExplorer}
            className="shrink-0"
          >
            <FolderOpen size={14} />
          </IconButton>
        )}
      </div>
      {open && (
        <div className="absolute inset-x-0 z-40 mt-1 w-[min(420px,calc(100vw-24px))] rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <Search size={14} className="text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
              className="flex-1 bg-transparent text-[13px] outline-none"
            />
            <IconButton title="Rescan folders" onClick={() => loadRepos(true)}>
              <RefreshCw size={13} />
            </IconButton>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1">
            {reposLoaded && !roots.length && (
              <div className="px-3 py-5 text-center text-[12.5px] text-muted">
                No folders yet. Add the folder that holds your repos.
              </div>
            )}
            {roots.map((root) => {
              const list = repos.filter((r) => r.root === root.path && match(r))
              return (
                <div key={root.path} className="mb-1">
                  <div className="group flex items-center gap-1.5 px-2.5 pb-0.5 pt-2 text-[11px] text-muted">
                    <span className="min-w-0 flex-1 truncate font-mono" title={root.path}>
                      {shortPath(root.path)}
                    </span>
                    {root.truncated && (
                      <span
                        className="text-warn"
                        title="Scanning stopped early: this folder is very large. Add a more specific folder."
                      >
                        partial
                      </span>
                    )}
                    {root.fromEnv ? (
                      <span title="Set by the REPOS_ROOT environment variable">
                        <Badge>REPOS_ROOT</Badge>
                      </span>
                    ) : (
                      <button
                        title="Remove this folder from OpenSpecControl (nothing is deleted on disk)"
                        onClick={() => removeRoot(root.path)}
                        className="rounded p-0.5 opacity-0 hover:bg-surface-2 hover:text-bad group-hover:opacity-100 focus:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {list.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => pick(r.id)}
                      title={r.id}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2',
                        r.id === repo && 'bg-accent-soft'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{r.name}</span>
                        {r.rel.includes('/') && (
                          <span className="block truncate text-[11px] text-muted">{r.rel}</span>
                        )}
                      </span>
                      {openRepos.includes(r.id) && (
                        <Badge tone="accent" className="shrink-0">
                          open
                        </Badge>
                      )}
                      {r.session && (
                        <span className="h-2 w-2 rounded-full bg-ok" title="agent connected" />
                      )}
                      {r.openspec ? (
                        <Badge tone="accent">OpenSpec</Badge>
                      ) : (
                        <span className="text-[11px] text-muted">not set up</span>
                      )}
                    </button>
                  ))}
                  {!list.length && (
                    <div className="px-2.5 py-1.5 text-[12px] text-muted">
                      {q ? 'No match' : 'No repos found in this folder'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="border-t border-line p-1">
            <button
              onClick={() => {
                setOpen(false)
                openAddFolder()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-accent hover:bg-surface-2"
            >
              <FolderPlus size={14} /> Add folder…
            </button>
            {repo && cur && (
              <label
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] hover:bg-surface-2"
                title="Write each change's comments and review rounds to openspec/changes/<change>/.openspeccontrol-review.json, so they can be committed with the branch and stay with the change when it is archived"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={reviewInRepo}
                  onChange={(e) => setReviewInRepo(e.target.checked)}
                />
                <span>
                  Keep review history in <b className="font-medium">{cur.name}</b>
                  <span className="block text-[11px] text-muted">
                    as .openspeccontrol-review.json in each change folder
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const IDEAS = [
  'Add a feature: ',
  'Fix a bug: ',
  'Refactor ',
  'Improve performance of ',
  'Add tests for '
]

function NewChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const git = useStore((s) => s.git)
  const [text, setText] = useState('')
  const [explore, setExplore] = useState(false)
  const go = () => {
    if (!text.trim() && !explore) return
    runAction(explore ? 'explore' : 'propose', undefined, text.trim())
    setText('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New change"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!text.trim() && !explore} onClick={go}>
            {explore ? (
              <>
                <Compass size={14} /> Explore
              </>
            ) : (
              <>
                <Sparkles size={14} /> Propose
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex gap-1.5">
        <Chip active={!explore} onClick={() => setExplore(false)}>
          Propose: agent drafts proposal, specs, design, tasks
        </Chip>
        <Chip active={explore} onClick={() => setExplore(true)}>
          Explore first: think it through together
        </Chip>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go()
        }}
        placeholder={
          explore
            ? 'What do you want to explore? (optional)'
            : 'What should change? One sentence is enough.'
        }
        className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {IDEAS.map((i) => (
          <Chip key={i} onClick={() => setText((t) => (t ? t : i))}>
            {i.trim()}
          </Chip>
        ))}
      </div>
      {git?.onBase && (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-muted">
          <GitBranch size={13} className="mt-px shrink-0 text-warn" />
          <span>
            You are on <b className="font-mono font-medium text-fg-2">{git.branch}</b>. Once the
            agent has named the change, open it and use{' '}
            <b className="font-medium text-fg-2">Create branch</b> to move it onto its own branch.
          </span>
        </p>
      )}
    </Dialog>
  )
}

function ArchiveDialog({ name, onClose }: { name: string | null; onClose: () => void }) {
  const hasVerify = useStore((s) => s.workflows.includes('verify'))
  return (
    <Dialog
      open={!!name}
      onClose={onClose}
      title="Archive change"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              runAction('archive', name!)
              onClose()
            }}
          >
            <Archive size={14} /> Archive
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-fg-2">
        The agent checks that <b className="text-fg">{name}</b> is complete, merges its delta specs
        into the main specs, and moves it to
        <code className="mx-1 rounded bg-surface-2 px-1 font-mono text-xs">
          openspec/changes/archive/
        </code>
        .
      </p>
      <p className="mt-2 text-[12.5px] text-muted">
        {hasVerify ? (
          'Tip: run Verify first, so the agent checks the code against the specs and tasks before the change is archived.'
        ) : (
          <>
            Tip: OpenSpec&apos;s optional <b>verify</b> workflow checks the code against the specs
            before archiving. Enable it with{' '}
            <code className="rounded bg-surface-2 px-1 font-mono text-xs">
              openspec config profile
            </code>
            , then run{' '}
            <code className="rounded bg-surface-2 px-1 font-mono text-xs">openspec update</code> in
            the repo.
          </>
        )}
      </p>
    </Dialog>
  )
}

/** Confirmación de cierre de un repo con sesión viva (D-E, tarea 3.5). Cancelar lo
 *  deja todo como estaba; cerrar manda `stop` y luego `unsubscribe`. */
function CloseRepoDialog({
  ask,
  settle
}: {
  ask: { repo: string } | null
  settle: (ok: boolean) => void
}) {
  const name = useStore((s) =>
    ask ? (s.repos.find((r) => r.id === ask.repo)?.name ?? ask.repo) : ''
  )
  return (
    <Dialog
      open={!!ask}
      onClose={() => settle(false)}
      title="Close repository"
      footer={
        <>
          <Button variant="ghost" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => settle(true)}>
            <Power size={14} /> Close and disconnect
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-fg-2">
        Close <b className="text-fg">{name}</b> and disconnect its agent?
      </p>
      <p className="mt-2 text-[12.5px] text-muted">
        The agent session stops and the repository stops being watched. Opening it again from the
        picker brings its changes back.
      </p>
    </Dialog>
  )
}

/**
 * multi-repo-rail (D-F): el rail es el contenedor: selector arriba y una
 * `RepoSection` plegable por repo abierto, cada una en su propio ErrorBoundary
 * para que una sección que falle no tire las demás.
 */
export function RepoRail() {
  const openRepos = useStore((s) => s.openRepos)
  const repos = useStore((s) => s.repos)
  const [newOpen, setNewOpen] = useState(false)
  const [archiveName, setArchiveName] = useState<string | null>(null)
  const [closeAsk, setCloseAsk] = useState<{ repo: string; resolve: (ok: boolean) => void } | null>(
    null
  )

  /** Interactuar con la sección de un repo en segundo plano lo activa antes (D-D). */
  const focusRepo = (repo: string) => {
    if (useStore.getState().repo !== repo) activateRepo(repo)
  }
  const askClose = (repo: string) => {
    // closeRepo solo llama a confirm si hay sesión viva (D-E): sin agente se cierra directo
    void closeRepo(repo, {
      confirm: () => new Promise<boolean>((resolve) => setCloseAsk({ repo, resolve }))
    })
  }
  const settleClose = (ok: boolean) => {
    closeAsk?.resolve(ok)
    setCloseAsk(null)
  }

  return (
    <nav className="flex h-full min-h-0 flex-col border-r border-line bg-bg">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
          <Check size={14} strokeWidth={3} />
        </div>
        <span className="text-[14px] font-bold tracking-tight">OpenSpecControl</span>
      </div>
      <div className="px-3 pb-3">
        <RepoPicker />
      </div>
      {openRepos.length > 0 && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-14 pt-1">
          {openRepos.map((id) => {
            const name = repos.find((r) => r.id === id)?.name ?? id
            return (
              <ErrorBoundary key={id} name={`Repository ${name}`}>
                <RepoSection
                  id={id}
                  onNewChange={(repo) => {
                    focusRepo(repo)
                    setNewOpen(true)
                  }}
                  onArchive={(repo, change) => {
                    focusRepo(repo)
                    setArchiveName(change)
                  }}
                  onClose={askClose}
                />
              </ErrorBoundary>
            )
          })}
        </div>
      )}
      <NewChangeDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <ArchiveDialog name={archiveName} onClose={() => setArchiveName(null)} />
      <CloseRepoDialog ask={closeAsk} settle={settleClose} />
    </nav>
  )
}

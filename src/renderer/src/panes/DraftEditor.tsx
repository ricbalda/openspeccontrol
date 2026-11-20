import { useCallback, useEffect, useRef, useState } from 'react'
import { Compass, Copy, Eye, PencilLine, Send, Sparkles, Trash2 } from 'lucide-react'
import { MAX_ACTION_TEXT, type Draft, type DraftMode } from '@shared/ipc.ts'
import { api } from '../lib/api.ts'
import { loadDrafts, openDraft, sendDraft, setDraftFlusher, toast, useStore } from '../store.ts'
import { Badge, Button, cx, Dialog, Spinner } from '../lib/ui.tsx'
import { ReadOnlyDoc } from './ReadOnlyDoc.tsx'

/** D-6: el autoguardado espera este tiempo tras la última pulsación. */
const AUTOSAVE_MS = 1000

/** El indicador de guardado del editor (D-6): Saving… / Saved / Not saved. */
type SaveState = { status: 'saving' | 'saved' | 'error'; message: string | null }

/**
 * El editor de borradores del panel central (fase 5, design D-6): título,
 * contenido en Markdown conmutando Edit / Preview (el preview reutiliza el
 * renderizado de ReadOnlyDoc), autoguardado a 1 s con su indicador, contador
 * n / 4000 con bloqueo de envío por encima del límite, envío como Explore o
 * Propose (Ctrl/Cmd+Enter para Propose), duplicado y borrado con confirmación.
 * Un borrador enviado se muestra en solo lectura, con su modo y su fecha.
 */
export function DraftEditor({ id }: { id: string }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [save, setSave] = useState<SaveState>({ status: 'saved', message: null })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'send' | 'dup' | 'del' | null>(null)

  // Autoguardado (D-6): el parche pendiente se fusiona entre pulsaciones y el
  // temporizador se reinicia; `flushDraft()` del store fuerza el guardado.
  const pending = useRef<{ title?: string; body?: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Los guardados se encadenan: nunca dos en vuelo sobre el mismo borrador.
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))

  useEffect(() => {
    let alive = true
    api
      .draft(id)
      .then((d) => {
        if (!alive) return
        setDraft(d)
        setTitle(d.title)
        setBody(d.body)
      })
      .catch((e) => {
        if (alive) toast((e as Error).message, 'error')
      })
    return () => {
      alive = false
    }
  }, [id])

  /** Guarda ahora el parche pendiente; false si el guardado falla (lo conserva para reintentar). */
  const doSave = useCallback((): Promise<boolean> => {
    const patch = pending.current
    if (!patch) return chain.current
    pending.current = null
    setSave({ status: 'saving', message: null })
    chain.current = chain.current.then(() =>
      api.saveDraft(id, patch).then(
        (d) => {
          setSave({ status: 'saved', message: null })
          setDraft(d) // fechas nuevas para la cabecera
          void loadDrafts(d.repo) // D-4: recargar la lista tras cada operación propia
          return true
        },
        (e: Error) => {
          // conserva lo no guardado (el texto sigue en el editor) y el motivo
          pending.current = { ...patch, ...pending.current }
          setSave({ status: 'error', message: e.message })
          return false
        }
      )
    )
    return chain.current
  }, [id])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    void doSave()
  }, [doSave])

  /** Encola un cambio del título o del contenido: fusiona y reinicia el temporizador. */
  const queue = useCallback(
    (patch: { title?: string; body?: string }) => {
      pending.current = { ...pending.current, ...patch }
      setSave({ status: 'saving', message: null })
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [flush]
  )

  // flushDraft() del store delega aquí; al desmontar se guarda lo pendiente
  useEffect(() => {
    setDraftFlusher(flush)
    return () => {
      clearTimeout(timer.current)
      void doSave()
      setDraftFlusher(null)
    }
  }, [flush, doSave])

  // D-6: también al perder el documento la visibilidad o al cerrar la ventana
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [flush])

  const sent = draft?.status === 'sent'
  const len = body.length
  const over = len > MAX_ACTION_TEXT
  const empty = body.trim().length === 0

  /** Envía el borrador (fase 3): guarda antes lo pendiente y refresca tras el intento. */
  const onSend = useCallback(
    async (m: DraftMode) => {
      if (!draft || sent || over || busy) return
      if (m === 'propose' && empty) return
      if (!(await doSave())) return // no enviar algo distinto de lo que se ve
      setBusy('send')
      try {
        await sendDraft(id, m, draft.repo)
        const d = await api.draft(id).catch(() => null)
        if (d) {
          setDraft(d)
          setTitle(d.title)
          setBody(d.body)
        }
      } finally {
        setBusy(null)
      }
    },
    [draft, sent, over, busy, empty, doSave, id]
  )

  /** Duplica el borrador (con lo que se ve: guarda antes) y abre la copia. */
  const onDuplicate = useCallback(async () => {
    if (!draft || busy) return
    if (!(await doSave())) return
    setBusy('dup')
    try {
      const copy = await api.duplicateDraft(id)
      openDraft(copy.id)
      void loadDrafts(draft.repo)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }, [draft, busy, doSave, id])

  /** Borra el borrador (ya confirmado) y cierra el editor. */
  const onDelete = useCallback(async () => {
    if (!draft) return
    setBusy('del')
    try {
      await api.deleteDraft(id)
      setConfirming(false)
      useStore.setState({ browse: null })
      void loadDrafts(draft.repo)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }, [draft, id])

  if (!draft)
    return (
      <main className="flex h-full items-center justify-center gap-2 bg-bg text-muted">
        <Spinner /> Loading draft…
      </main>
    )

  const sentLabel = draft.sentMode === 'propose' ? 'proposal' : 'explore'
  const readOnly = sent || mode === 'preview'

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="border-b border-line bg-surface px-6 pt-3">
        <div className="flex items-center gap-3">
          {sent ? (
            <h1 className="truncate text-[17px] font-semibold tracking-tight">
              {title || 'Untitled draft'}
            </h1>
          ) : (
            <input
              aria-label="Draft title"
              value={title}
              disabled={busy !== null}
              onChange={(e) => {
                setTitle(e.target.value)
                queue({ title: e.target.value })
              }}
              onBlur={flush}
              placeholder="Untitled draft"
              className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold tracking-tight outline-none placeholder:text-muted"
            />
          )}
          {sent ? (
            <Badge tone="ok" className="shrink-0">
              <Send size={12} /> Sent as {sentLabel}
              {draft.sentAt ? ` · ${new Date(draft.sentAt).toLocaleString()}` : ''}
            </Badge>
          ) : (
            <Badge className="shrink-0">Draft</Badge>
          )}
          <span
            className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px]"
            title={save.status === 'error' ? (save.message ?? 'Not saved') : undefined}
          >
            {save.status === 'saving' ? (
              <>
                <Spinner /> Saving…
              </>
            ) : save.status === 'error' ? (
              <span className="text-bad">Not saved{save.message ? ` · ${save.message}` : ''}</span>
            ) : (
              <span className="text-ok">Saved</span>
            )}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2.5">
          {!sent && (
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={cx(
                  'flex items-center gap-1.5 border-b-2 px-3 pb-1.5 pt-1 text-[13px] transition',
                  mode === 'edit'
                    ? 'border-accent font-medium text-fg'
                    : 'border-transparent text-muted hover:text-fg'
                )}
              >
                <PencilLine size={13} /> Edit
              </button>
              <button
                type="button"
                onClick={() => setMode('preview')}
                className={cx(
                  'flex items-center gap-1.5 border-b-2 px-3 pb-1.5 pt-1 text-[13px] transition',
                  mode === 'preview'
                    ? 'border-accent font-medium text-fg'
                    : 'border-transparent text-muted hover:text-fg'
                )}
              >
                <Eye size={13} /> Preview
              </button>
            </div>
          )}
          {!sent && (
            <span
              className={cx('text-[11.5px]', over ? 'text-warn' : 'text-muted')}
              aria-live="polite"
            >
              {len} / {MAX_ACTION_TEXT}
              {over && ': shorten the draft to send it'}
            </span>
          )}
          <span className="text-[11.5px] text-muted">
            Created {new Date(draft.createdAt).toLocaleString()} · Modified{' '}
            {new Date(draft.updatedAt).toLocaleString()}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void onDuplicate()}
              title="Create a new draft with this content"
            >
              {busy === 'dup' ? <Spinner /> : <Copy size={13} />} Duplicate
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={13} /> Delete
            </Button>
            {!sent && (
              <>
                <Button
                  size="sm"
                  disabled={over || busy !== null}
                  onClick={() => void onSend('explore')}
                  title="Send to the agent as an exploration"
                >
                  {busy === 'send' ? <Spinner /> : <Compass size={13} />} Explore
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={over || empty || busy !== null}
                  onClick={() => void onSend('propose')}
                  title="Send to the agent as a proposal (Ctrl/Cmd+Enter)"
                >
                  <Sparkles size={13} /> Propose
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {readOnly ? (
        <ReadOnlyDoc
          title={title || 'Untitled draft'}
          content={body}
          badges={
            sent ? (
              <Badge tone="ok">
                <Send size={12} /> Sent as {sentLabel}
              </Badge>
            ) : (
              <Badge tone="info">Preview</Badge>
            )
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <textarea
            aria-label="Draft content"
            value={body}
            disabled={busy === 'send'}
            onChange={(e) => {
              setBody(e.target.value)
              queue({ body: e.target.value })
            }}
            onBlur={flush}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void onSend('propose')
              }
            }}
            placeholder="Write the draft in Markdown. One clear sentence is a good start."
            className="mx-auto block h-full w-full max-w-[760px] resize-none bg-bg px-8 py-6 text-[13.5px] leading-6 outline-none placeholder:text-muted"
          />
        </div>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete draft"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy === 'del'} onClick={() => void onDelete()}>
              {busy === 'del' ? <Spinner /> : <Trash2 size={14} />} Delete
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-fg-2">
          Delete <b className="font-medium">{title || 'Untitled draft'}</b> from the draft history?
          This cannot be undone.
        </p>
      </Dialog>
    </div>
  )
}

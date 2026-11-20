import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { Loader2, Minus, Play, Plus, Rows3, Sparkles, TriangleAlert, Volume2 } from 'lucide-react'
import type { Actor, Segment, Voice } from '@shared/types'
import { ACTOR_COLORS } from '@shared/defaults'
import { patchSegments, sortSegments, updateSegments, useActiveEpisode, useProject } from '@/store/project'
import { playerApi, useUi } from '@/store/ui'
import { useVoices } from '@/lib/hooks'
import { mediaUrl } from '@/lib/api'
import { cn, formatTime, isTyping } from '@/lib/utils'
import { generateVoices, notify, shortenSegment, voiceFor } from '@/lib/pipeline'
import { GridToolbar } from './GridToolbar'

const ROW_H = 58

export const actorColor = (cast: Actor[], id?: string) => {
  const i = cast.findIndex((a) => a.id === id)
  return i < 0 ? '#64748b' : ACTOR_COLORS[i % ACTOR_COLORS.length]
}

/** "1:02.5", "62.5", "00:01:02.50" → seconds */
export function parseTime(s: string): number | null {
  const parts = s.trim().split(':').map((x) => x.replace(',', '.'))
  if (!parts.length || parts.some((p) => p === '' || isNaN(Number(p)))) return null
  return Math.round(parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 100) / 100
}

function TimeCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [edit, setEdit] = useState<string | null>(null)
  if (edit !== null)
    return (
      <input
        autoFocus
        className="h-6 w-[84px] rounded border bg-background px-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
        value={edit}
        onChange={(e) => setEdit(e.target.value)}
        onBlur={() => {
          const v = parseTime(edit)
          if (v !== null && v !== value) onCommit(v)
          setEdit(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEdit(null)
          e.stopPropagation()
        }}
      />
    )
  return (
    <button className="w-[84px] text-left font-mono text-[11px] tabular-nums hover:text-primary" onDoubleClick={() => setEdit(formatTime(value).slice(3))} title="Double-click to edit">
      {formatTime(value).slice(3)}
    </button>
  )
}

interface RowProps {
  s: Segment
  index: number
  selected: boolean
  focused: boolean
  editing: boolean
  playing: boolean
  cast: Actor[]
  voices: Voice[]
  maxSpeed: number
  epId: string
  onRowClick: (e: React.MouseEvent, s: Segment, index: number) => void
}

const Row = memo(function Row({ s, index, selected, focused, editing, playing, cast, voices, maxSpeed, epId, onRowClick }: RowProps) {
  const { t } = useTranslation()
  const setUi = useUi((st) => st.set)
  const [draft, setDraft] = useState(s.textTarget)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(s.textTarget), [s.textTarget, editing])
  const actor = cast.find((a) => a.id === s.actorId)
  const color = actorColor(cast, s.actorId)
  const eff = (s.fitSpeed ?? 1) * s.speed

  const commit = () => {
    if (draft !== s.textTarget) patchSegments(epId, [s.id], { textTarget: draft, audioPath: undefined, fitWarning: undefined, fitSpeed: undefined })
    setUi({ editingId: null })
  }

  const play = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const p = playerApi()
    if (!p) return
    if (s.audioPath) p.playAudio(`${await mediaUrl(s.audioPath)}&v=${s.audioDur ?? ''}`, s.start)
    else p.playRange(s.start, s.end)
  }

  return (
    <div
      onClick={(e) => onRowClick(e, s, index)}
      className={cn(
        'group flex h-full items-center gap-2 border-b px-2 text-sm',
        selected ? 'bg-primary/10' : index % 2 ? 'bg-muted/30' : '',
        focused && 'ring-1 ring-inset ring-primary/60',
        playing && 'border-l-2 border-l-primary'
      )}
    >
      <input type="checkbox" checked={selected} readOnly className="pointer-events-none size-3.5 accent-[hsl(var(--primary))]" />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{index + 1}</span>
      <div className="flex w-[84px] shrink-0 flex-col gap-0.5">
        <TimeCell value={s.start} onCommit={(v) => updateSegments(epId, (segs) => sortSegments(segs.map((x) => (x.id === s.id ? { ...x, start: Math.min(v, x.end - 0.05) } : x))))} />
        <TimeCell value={s.end} onCommit={(v) => patchSegments(epId, [s.id], { end: Math.max(v, s.start + 0.05) })} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="truncate text-[11px] text-muted-foreground" title={s.textOriginal}>
          {s.textOriginal || '—'}
        </div>
        {editing ? (
          <textarea
            autoFocus
            rows={1}
            value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commit()
              }
              if (e.key === 'Escape') {
                setDraft(s.textTarget)
                setUi({ editingId: null })
              }
            }}
            className="w-full resize-none rounded border bg-background px-1.5 py-0.5 font-hanuman text-[15px] leading-snug outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <div
            className={cn('truncate font-hanuman text-[15px] leading-snug', !s.textTarget && 'italic text-muted-foreground')}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setUi({ editingId: s.id })
            }}
            title={s.textTarget}
          >
            {s.textTarget || t('grid.untranslated', 'double-click to type the dub line')}
          </div>
        )}
      </div>
      <button
        className="flex w-12 shrink-0 items-center justify-center rounded px-1 py-0.5 font-mono text-[11px] font-semibold text-white"
        style={{ background: color }}
        title={actor ? `${actor.label}${actor.name ? ` · ${actor.name}` : ''} (${actor.gender})` : t('grid.noActor', 'No actor')}
        onClick={(e) => {
          e.stopPropagation()
          const ids = cast.map((a) => a.id)
          const next = ids[(ids.indexOf(s.actorId ?? '') + 1) % Math.max(1, ids.length)]
          if (next) patchSegments(epId, [s.id], { actorId: next, audioPath: undefined })
        }}
      >
        {actor?.label ?? '—'}
      </button>
      <select
        className="h-7 w-36 shrink-0 truncate rounded border bg-background px-1 text-xs outline-none"
        value={s.voiceId ?? ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => patchSegments(epId, [s.id], { voiceId: e.target.value || undefined, audioPath: undefined })}
        title={voiceFor(s, cast)}
      >
        <option value="">{t('grid.actorVoice', 'Actor voice')}</option>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <div className="flex w-[92px] shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button className="rounded p-0.5 hover:bg-accent" onClick={() => patchSegments(epId, [s.id], { speed: Math.max(0.5, Math.round((s.speed - 0.05) * 100) / 100), audioPath: undefined })}>
          <Minus className="size-3" />
        </button>
        <span
          className={cn('w-10 text-center font-mono text-[11px] tabular-nums', s.fitWarning && 'font-semibold text-warning')}
          title={s.fitSpeed ? `base ${s.speed}× · auto-fit ${s.fitSpeed}×` : `${s.speed}×`}
        >
          {eff.toFixed(2)}
        </span>
        <button className="rounded p-0.5 hover:bg-accent" onClick={() => patchSegments(epId, [s.id], { speed: Math.min(2, Math.round((s.speed + 0.05) * 100) / 100), audioPath: undefined })}>
          <Plus className="size-3" />
        </button>
        {s.fitWarning && (
          <button
            className="rounded p-0.5 text-warning hover:bg-accent"
            title={t('grid.tooFast', 'Too fast (> {{max}}×) — click for AI shorten', { max: maxSpeed })}
            onClick={async () => {
              setBusy(true)
              try {
                const txt = await shortenSegment(s.id, epId)
                if (txt) toast.success(txt)
              } catch (e) {
                notify(e)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <TriangleAlert className="size-3.5" />}
          </button>
        )}
      </div>
      <div className="flex w-14 shrink-0 items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button className="rounded p-1 hover:bg-accent" title={s.audioPath ? t('grid.playDub', 'Play dub line') : t('grid.playOrig', 'Play original')} onClick={play}>
          {s.audioPath ? <Volume2 className="size-4 text-primary" /> : <Play className="size-4" />}
        </button>
        <button
          className="rounded p-1 opacity-0 hover:bg-accent group-hover:opacity-100"
          title={t('grid.generateLine', 'Generate this line')}
          onClick={() => generateVoices([s.id], epId).catch(notify)}
        >
          <Sparkles className="size-3.5" />
        </button>
      </div>
    </div>
  )
})

export function SegmentGrid() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const cast = useProject((s) => s.project?.cast ?? [])
  const maxSpeed = useProject((s) => s.project?.settings.maxSpeed ?? 1.6)
  const selected = useProject((s) => s.selected)
  const focusId = useProject((s) => s.focusId)
  const editingId = useUi((s) => s.editingId)
  const time = useUi((s) => s.time)
  const playing = useUi((s) => s.playing)
  const setUi = useUi((s) => s.set)
  const [voices] = useVoices()
  const [filter, setFilter] = useState<'all' | 'warn' | 'untranslated' | 'novoice'>('all')
  const parentRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)

  const rows = useMemo(() => {
    const segs = ep?.segments ?? []
    if (filter === 'warn') return segs.filter((s) => s.fitWarning)
    if (filter === 'untranslated') return segs.filter((s) => !s.textTarget.trim())
    if (filter === 'novoice') return segs.filter((s) => s.textTarget.trim() && !s.audioPath)
    return segs
  }, [ep?.segments, filter])

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_H, overscan: 12 })
  const playingIdx = useMemo(() => rows.findIndex((s) => time >= s.start && time < s.end), [rows, time])

  // follow playback
  useEffect(() => {
    if (playing && playingIdx >= 0) virt.scrollToIndex(playingIdx, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingIdx, playing])

  // scroll to focused row (e.g. selected from timeline)
  useEffect(() => {
    const i = rows.findIndex((s) => s.id === focusId)
    if (i >= 0 && !playing) virt.scrollToIndex(i, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const onRowClick = useCallback(
    (e: React.MouseEvent, s: Segment, index: number) => {
      const cur = new Set(useProject.getState().selected)
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
        rows.slice(a, b + 1).forEach((r) => cur.add(r.id))
      } else if (e.ctrlKey || e.metaKey || (e.target as HTMLElement).tagName === 'INPUT') {
        if (cur.has(s.id)) cur.delete(s.id)
        else cur.add(s.id)
        anchor.current = index
      } else {
        cur.clear()
        cur.add(s.id)
        anchor.current = index
        playerApi()?.seek(s.start)
      }
      useProject.setState({ selected: cur, focusId: s.id })
    },
    [rows]
  )

  // keyboard: ↑/↓, Enter, Delete, Ctrl+Enter, Ctrl+A
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !ep || document.querySelector('[role="dialog"]')) return
      const idx = rows.findIndex((s) => s.id === useProject.getState().focusId)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = Math.max(0, Math.min(rows.length - 1, (idx < 0 ? -1 : idx) + (e.key === 'ArrowDown' ? 1 : -1)))
        const s = rows[n]
        if (!s) return
        useProject.setState({ focusId: s.id, selected: e.shiftKey ? new Set([...useProject.getState().selected, s.id]) : new Set([s.id]) })
        anchor.current = n
        virt.scrollToIndex(n, { align: 'auto' })
        playerApi()?.seek(s.start)
      } else if (e.key === 'Enter' && !e.ctrlKey && idx >= 0) {
        e.preventDefault()
        setUi({ editingId: rows[idx].id })
      } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault()
        const ids = [...useProject.getState().selected]
        generateVoices(ids.length ? ids : undefined, ep.id).catch(notify)
      } else if (e.key === 'Delete') {
        const ids = useProject.getState().selected
        if (!ids.size) return
        e.preventDefault()
        updateSegments(ep.id, (segs) => segs.filter((s) => !ids.has(s.id)))
        useProject.setState({ selected: new Set() })
      } else if (e.key.toLowerCase() === 'a' && e.ctrlKey) {
        e.preventDefault()
        useProject.setState({ selected: new Set(rows.map((s) => s.id)) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, ep, virt, setUi])

  if (!ep) return null
  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.id))

  return (
    <div className="flex h-full flex-col">
      <GridToolbar filter={filter} setFilter={setFilter} />
      <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-muted/40 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-[hsl(var(--primary))]"
          checked={allSelected}
          onChange={() => useProject.setState({ selected: allSelected ? new Set() : new Set(rows.map((s) => s.id)) })}
        />
        <span className="w-9 text-right">#</span>
        <span className="w-[84px]">{t('grid.time', 'Start / End')}</span>
        <span className="flex-1">{t('grid.text', 'Original → Dub line')}</span>
        <span className="w-12 text-center">{t('grid.actor', 'Actor')}</span>
        <span className="w-36">{t('grid.voice', 'Voice')}</span>
        <span className="w-[92px]">{t('grid.speed', 'Speed')}</span>
        <span className="w-14" />
      </div>
      {rows.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground">
          <div className="flex max-w-sm flex-col items-center gap-2">
            <Rows3 className="size-8 opacity-50" />
            <p className="text-sm">
              {ep.segments.length
                ? t('grid.noneMatch', 'No lines match this filter.')
                : ep.videoPath
                  ? t('grid.emptyHint', 'No lines yet. Use Transcribe (bottom bar), Import SRT/VTT, Read Screen, or Add line.')
                  : t('grid.emptyNoVideo', 'Import a video to start, or import an SRT/VTT file.')}
            </p>
          </div>
        </div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) => {
              const s = rows[vi.index]
              return (
                <div key={s.id} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)` }}>
                  <Row
                    s={s}
                    index={vi.index}
                    selected={selected.has(s.id)}
                    focused={focusId === s.id}
                    editing={editingId === s.id}
                    playing={vi.index === playingIdx}
                    cast={cast}
                    voices={voices}
                    maxSpeed={maxSpeed}
                    epId={ep.id}
                    onRowClick={onRowClick}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

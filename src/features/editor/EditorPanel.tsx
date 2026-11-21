import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Captions,
  Check,
  Clapperboard,
  Eraser,
  FolderInput,
  GripVertical,
  Layers,
  Link,
  Loader2,
  Music,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Video,
  Wand2,
  X
} from 'lucide-react'
import type { Aspect, EditState, Episode } from '@shared/types'
import { addRemoved, effectiveClips, fullClip, moveClip, normalize, outputDuration, restoreRange, splitClipAt, totalDuration } from '@shared/ranges'
import { AI_EDIT_PRESETS, findFillers, removedLineIds, silenceCuts } from '@shared/editor'
import { Button } from '@/components/ui/button'
import { Slider, Switch, Toggle } from '@/components/ui/controls'
import { sortSegments, updateEpisode, useActiveEpisode, useProject } from '@/store/project'
import { useSettings } from '@/store/settings'
import { playerApi, useUi } from '@/store/ui'
import { applyEditPlan, detectSilences, editAllEpisodes, importBgm, importFolder, importVideo, newClipId, notify, planEpisodeEdit, type EditPlan } from '@/lib/pipeline'
import { cn, formatTime } from '@/lib/utils'
import { CaptionStyleEditor } from './CaptionStyleEditor'
import { AiCreator } from './AiCreator'
import { useBackendThumb } from './thumbs'

function Section({ icon: Icon, title, children, right }: { icon: React.ElementType; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex-1" />
        {right}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

const fmt = (s: number) => formatTime(s).slice(s >= 3600 ? 0 : 3, 8)

export function EditorPanel() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  if (!ep) return null
  if (!ep.videoPath)
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div className="flex max-w-md flex-col items-center gap-3">
          <Clapperboard className="size-8 opacity-50" />
          <div className="text-base font-medium text-foreground">{t('editor.noVideoTitle', 'AI Video starts from your episode')}</div>
          <p>
            {t(
              'editor.noVideo2',
              'The AI cuts new videos (shorts, trailer, recap) out of an episode: it reads the lines, picks the best moments and exports them with your dub. Import the episode video first — the lines are made automatically — then press Generate videos.'
            )}
          </p>
          <ol className="list-decimal space-y-0.5 text-left text-xs">
            <li>{t('editor.step1', 'Import a video (file, folder or link)')}</li>
            <li>{t('editor.step2', 'Wait for the lines (Listen + Read runs by itself)')}</li>
            <li>{t('editor.step3', 'AI Video → Generate videos')}</li>
          </ol>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => importVideo(ep.id).catch(notify)}>
              <Video /> {t('tools.importVideo', 'Import Video')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => useUi.getState().set({ dialog: 'link' })}>
              <Link /> {t('tools.importLink', 'Import Link')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => importFolder().catch(notify)}>
              <FolderInput /> {t('tools.importFolder', 'Import Folder')}
            </Button>
          </div>
        </div>
      </div>
    )
  return <EditorBody ep={ep} />
}

function EditorBody({ ep }: { ep: Episode }) {
  const { t } = useTranslation()
  const previewEdit = useUi((s) => s.previewEdit)
  const setUi = useUi((s) => s.set)
  const lang = useSettings((s) => s.lang)
  const edit = ep.edit
  const clips = useMemo(() => effectiveClips(edit), [edit])
  const outDur = edit.enabled ? outputDuration(clips) : ep.durationSec

  const setEdit = (fn: (e: EditState) => EditState, undo = true) =>
    updateEpisode(ep.id, (x) => {
      const base = x.edit.clips.length ? x.edit : { ...x.edit, clips: fullClip(x.durationSec) }
      return { ...x, edit: { ...fn(base), enabled: true } }
    }, { undo })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        <Switch
          checked={edit.enabled}
          onChange={(v) => updateEpisode(ep.id, (x) => ({ ...x, edit: { ...x.edit, enabled: v, clips: x.edit.clips.length ? x.edit.clips : fullClip(x.durationSec) } }))}
          label={<span className="font-medium">{t('editor.enable', 'Apply edits on export')}</span>}
        />
        <Toggle on={previewEdit} onClick={() => setUi({ previewEdit: !previewEdit })} title={t('editor.previewHint', 'Player skips cut parts and follows clip order')}>
          <Scissors /> {t('editor.preview', 'Preview edited cut')}
        </Toggle>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {t('editor.duration', 'Duration')}: <span className="font-mono">{fmt(ep.durationSec)}</span> →{' '}
          <span className={cn('font-mono font-semibold', edit.enabled && outDur < ep.durationSec && 'text-primary')}>{fmt(outDur)}</span>
          {edit.enabled && ep.durationSec > 0 && <span> (−{Math.round((1 - outDur / ep.durationSec) * 100)}%)</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          title={t('editor.reset', 'Reset all edits')}
          onClick={() => confirm(t('editor.resetConfirm', 'Reset all cuts, order and format?')) && setEdit(() => ({ ...edit, clips: fullClip(ep.durationSec), removed: [], aspect: 'source', fadeIn: 0, fadeOut: 0 }))}
        >
          <RotateCcw />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-3 p-3 xl:grid-cols-2">
          <div className="flex flex-col gap-3">
            <AiCommand ep={ep} lang={lang} />
            <AiCreator ep={ep} />
            <QuickTools ep={ep} setEdit={setEdit} />
            <Transcript ep={ep} setEdit={setEdit} />
          </div>
          <div className="flex flex-col gap-3">
            <ClipList ep={ep} setEdit={setEdit} />
            <Format ep={ep} setEdit={setEdit} />
            <Section icon={Captions} title={t('editor.captions', 'Captions style')}>
              <CaptionStyleEditor />
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

type SetEdit = (fn: (e: EditState) => EditState, undo?: boolean) => void

// ───────── AI prompt commands ─────────
function AiCommand({ ep, lang }: { ep: Episode; lang: string }) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<EditPlan | null>(null)
  const project = useProject((s) => s.project!)

  const [allProgress, setAllProgress] = useState<string | null>(null)
  const epCount = project.episodes.filter((e) => e.videoPath && e.segments.length).length

  const run = async () => {
    if (!prompt.trim()) return
    setBusy(true)
    setPlan(null)
    try {
      setPlan(await planEpisodeEdit(ep.id, prompt))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!plan) return
    applyEditPlan(ep.id, plan)
    useUi.getState().set({ previewEdit: true })
    setPlan(null)
    toast.success(t('editor.applied', 'Edit applied — press Space to preview'))
  }

  // the same command on every episode, applied directly (each episode's edit can still be undone / reset)
  const runAll = async () => {
    if (!prompt.trim()) return
    if (!confirm(t('editor.allConfirm', 'Apply this AI edit to all {{n}} episodes that have lines? Each episode’s current cuts are replaced.', { n: epCount }))) return
    setBusy(true)
    setPlan(null)
    try {
      const r = await editAllEpisodes(prompt, (done, total, label) =>
        setAllProgress(done < total ? t('editor.allProgress', '{{label}} ({{k}} of {{n}})…', { label, k: done + 1, n: total }) : null)
      )
      if (r.ok) toast.success(t('editor.allDone', 'AI edit applied to {{n}} episodes', { n: r.ok }))
      if (r.skipped.length) toast.info(t('editor.allSkipped', 'Skipped (no video or lines yet): {{list}}', { list: r.skipped.join(', ') }))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(false)
      setAllProgress(null)
    }
  }

  const newDur = plan?.keep.length ? totalDuration(plan.keep) : null

  return (
    <Section icon={Sparkles} title={t('editor.ai', 'AI edit command')}>
      <div className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && run()}
          rows={3}
          placeholder={t('editor.aiPlaceholder', 'Tell the AI what to do, e.g. “cut all parts where nobody speaks” or “make a 60 s highlight for TikTok”')}
          className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-wrap gap-1">
          {AI_EDIT_PRESETS.map((p) => (
            <button key={p.id} className="rounded-full border px-2.5 py-0.5 text-xs hover:border-primary/60 hover:bg-accent" onClick={() => setPrompt(lang === 'km' ? p.km : p.en)}>
              {lang === 'km' ? p.km : p.en}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={run} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('editor.plan', 'Plan edit (Ctrl+Enter)')}
          </Button>
          {epCount > 1 && (
            <Button size="sm" variant="outline" onClick={runAll} disabled={busy || !prompt.trim()} title={t('editor.allHint', 'Plan and apply this command for every episode, one by one')}>
              <Layers /> {t('editor.all', 'Apply to all {{n}} episodes', { n: epCount })}
            </Button>
          )}
          {allProgress && <span className="text-xs text-muted-foreground">{allProgress}</span>}
          {!ep.segments.length && <span className="text-xs text-warning">{t('editor.needTranscript', 'Tip: transcribe first so the AI can read what is said')}</span>}
        </div>
        {plan && (
          <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="text-sm">{plan.summary || t('editor.noSummary', 'Plan ready')}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {plan.keep.length > 0 && (
                <span>
                  {t('editor.planClips', '{{n}} clips', { n: plan.keep.length })} · {fmt(ep.durationSec)} → <b className="text-foreground">{fmt(newDur ?? 0)}</b>
                </span>
              )}
              {plan.aspect && <span>{t('editor.planAspect', 'Format')}: {plan.aspect}</span>}
              {(plan.fadeIn ?? 0) > 0 && <span>Fade in {plan.fadeIn}s</span>}
              {(plan.fadeOut ?? 0) > 0 && <span>Fade out {plan.fadeOut}s</span>}
              {plan.captionPreset && <span>{t('editor.planCaptions', 'Captions')}: {plan.captionPreset}</span>}
            </div>
            {plan.keep.length > 0 && (
              <div className="max-h-28 overflow-y-auto font-mono text-[11px] text-muted-foreground">
                {plan.keep.map((k, i) => (
                  <button key={i} className="mr-2 hover:text-primary" onClick={() => playerApi()?.playRange(k.start, k.end)} title={k.reason}>
                    {fmt(k.start)}–{fmt(k.end)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={apply}>
                <Check /> {t('editor.apply', 'Apply')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
                <X /> {t('editor.discard', 'Discard')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

// ───────── silence / filler removal ─────────
function QuickTools({ ep, setEdit }: { ep: Episode; setEdit: SetEdit }) {
  const { t } = useTranslation()
  const { silenceDb, silenceMin, set } = useSettings()
  const sourceLang = useProject((s) => s.project?.settings.sourceLang ?? 'en')
  const [busy, setBusy] = useState<string | null>(null)
  const hasWords = ep.segments.some((s) => s.words?.length)

  const removeSilences = async () => {
    setBusy('sil')
    try {
      const sil = await detectSilences(ep.id)
      const cuts = silenceCuts(sil, silenceMin)
      if (!cuts.length) return void toast.info(t('editor.noSilences', 'No silences found with these settings'))
      setEdit((e) => ({ ...e, removed: normalize([...e.removed, ...cuts]) }))
      toast.success(t('editor.silencesRemoved', 'Removed {{n}} silences ({{s}} s)', { n: cuts.length, s: Math.round(totalDuration(cuts)) }))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const removeFillers = () => {
    const f = findFillers(ep.segments, sourceLang === 'auto' ? 'en' : sourceLang)
    if (!f.length) return void toast.info(t('editor.noFillers', 'No filler words found'))
    setEdit((e) => ({ ...e, removed: normalize([...e.removed, ...f]) }))
    toast.success(t('editor.fillersRemoved', 'Removed {{n}} filler words', { n: f.length }))
  }

  return (
    <Section icon={Eraser} title={t('editor.quick', 'Quick clean-up')}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={removeSilences} disabled={!!busy}>
            {busy === 'sil' ? <Loader2 className="animate-spin" /> : <AudioLines />} {t('editor.removeSilences', 'Remove silences')}
          </Button>
          <Slider className="w-44" label={t('editor.threshold', 'Level')} min={-60} max={-20} step={1} value={silenceDb} onChange={(v) => set({ silenceDb: v })} format={(v) => `${v}dB`} />
          <Slider className="w-44" label={t('editor.minPause', 'Min pause')} min={0.3} max={3} step={0.1} value={silenceMin} onChange={(v) => set({ silenceMin: v })} format={(v) => `${v.toFixed(1)}s`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={removeFillers} disabled={!hasWords} title={hasWords ? '' : t('editor.needWords', 'Needs Whisper word timings')}>
            <Eraser /> {t('editor.removeFillers', 'Remove filler words (um, uh, អឺ…)')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit((e) => ({ ...e, removed: [] }))} disabled={!ep.edit.removed.length}>
            <RotateCcw /> {t('editor.restoreAll', 'Restore all cuts')} ({ep.edit.removed.length})
          </Button>
        </div>
      </div>
    </Section>
  )
}

// ───────── text-based cutting ─────────
function Transcript({ ep, setEdit }: { ep: Episode; setEdit: SetEdit }) {
  const { t } = useTranslation()
  const time = useUi((s) => s.time)
  const segs = useMemo(() => sortSegments(ep.segments), [ep.segments])
  const removed = useMemo(() => removedLineIds(segs, ep.edit.removed), [segs, ep.edit.removed])
  const [last, setLast] = useState<number | null>(null)

  const toggle = (i: number, shift: boolean) => {
    const range = shift && last !== null ? segs.slice(Math.min(last, i), Math.max(last, i) + 1) : [segs[i]]
    const cut = !removed.has(segs[i].id)
    setEdit((e) => ({
      ...e,
      removed: range.reduce((acc, s) => (cut ? addRemoved(acc, { start: s.start, end: s.end }) : restoreRange(acc, { start: s.start, end: s.end })), e.removed)
    }))
    setLast(i)
  }

  return (
    <Section
      icon={Scissors}
      title={t('editor.textCut', 'Edit by text')}
      right={<span className="text-xs text-muted-foreground">{t('editor.textCutHint', 'Click a line to cut/restore · Shift+click for a range')}</span>}
    >
      {segs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('editor.noLines', 'Transcribe the video to edit it like a document.')}</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto leading-7">
          {segs.map((s, i) => {
            const cut = removed.has(s.id)
            const now = time >= s.start && time < s.end
            return (
              <span key={s.id} className="group">
                <span
                  onClick={(e) => toggle(i, e.shiftKey)}
                  onDoubleClick={() => playerApi()?.seek(s.start)}
                  title={`${fmt(s.start)}–${fmt(s.end)} · ${t('editor.dblSeek', 'double-click to jump')}`}
                  className={cn(
                    'cursor-pointer rounded px-0.5 text-sm transition-colors',
                    cut ? 'bg-destructive/10 text-muted-foreground line-through decoration-destructive' : 'hover:bg-accent',
                    now && 'bg-primary/20'
                  )}
                >
                  {s.textOriginal || s.textTarget}
                </span>{' '}
              </span>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ───────── clips (timeline basics) ─────────
function ClipThumb({ path, t: at }: { path: string; t: number }) {
  const src = useBackendThumb(path, at)
  return src ? <img src={src} className="h-9 w-16 rounded object-cover" draggable={false} /> : <div className="h-9 w-16 rounded bg-muted" />
}

function ClipList({ ep, setEdit }: { ep: Episode; setEdit: SetEdit }) {
  const { t } = useTranslation()
  const time = useUi((s) => s.time)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const base = ep.edit.clips.length ? ep.edit.clips : fullClip(ep.durationSec)

  return (
    <Section
      icon={Clapperboard}
      title={t('editor.clips', 'Clips')}
      right={
        <Button size="sm" variant="outline" onClick={() => setEdit((e) => ({ ...e, clips: splitClipAt(e.clips, time, newClipId()) }))} title={t('editor.splitHint', 'Split the clip under the playhead')}>
          <Scissors /> {t('editor.split', 'Split at playhead')}
        </Button>
      }
    >
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {base.map((c, i) => {
          const pieces = effectiveClips({ clips: [c], removed: ep.edit.removed })
          const kept = totalDuration(pieces)
          const active = time >= c.start && time < c.end
          return (
            <div
              key={c.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== i) setEdit((e) => ({ ...e, clips: moveClip(e.clips, dragIdx, i) }))
                setDragIdx(null)
              }}
              className={cn('flex items-center gap-2 rounded-md border px-2 py-1 text-xs', active && 'border-primary/60 bg-primary/5', dragIdx === i && 'opacity-50')}
            >
              <GripVertical className="size-4 cursor-grab text-muted-foreground" />
              <span className="w-5 text-right font-mono text-muted-foreground">{i + 1}</span>
              <ClipThumb path={ep.videoPath} t={c.start + 0.2} />
              <button className="flex-1 text-left font-mono" onClick={() => playerApi()?.playRange(c.start, c.end)} title={t('editor.playClip', 'Play this clip')}>
                {fmt(c.start)} – {fmt(c.end)}
                <span className="ml-2 text-muted-foreground">
                  {Math.round(c.end - c.start)}s{kept < c.end - c.start - 0.1 ? ` → ${Math.round(kept)}s` : ''}
                </span>
              </button>
              <button className="rounded p-1 hover:bg-accent" disabled={i === 0} onClick={() => setEdit((e) => ({ ...e, clips: moveClip(e.clips, i, i - 1) }))}>
                <ArrowUp className="size-3.5" />
              </button>
              <button className="rounded p-1 hover:bg-accent" disabled={i === base.length - 1} onClick={() => setEdit((e) => ({ ...e, clips: moveClip(e.clips, i, i + 1) }))}>
                <ArrowDown className="size-3.5" />
              </button>
              <button
                className="rounded p-1 hover:bg-accent"
                title={t('editor.deleteClip', 'Delete clip')}
                onClick={() => setEdit((e) => ({ ...e, clips: e.clips.length > 1 ? e.clips.filter((x) => x.id !== c.id) : e.clips }))}
                disabled={base.length <= 1}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('editor.clipsHint', 'Drag to reorder. Cut parts inside clips are shown on the timeline with red stripes.')}</p>
    </Section>
  )
}

// ───────── format / reframe / fades / BGM ─────────
const ASPECTS: Array<[Aspect, string]> = [
  ['source', 'Source'],
  ['16:9', '16:9 YouTube'],
  ['9:16', '9:16 TikTok/Reels'],
  ['1:1', '1:1 Square'],
  ['4:5', '4:5 Feed']
]

function Format({ ep, setEdit }: { ep: Episode; setEdit: SetEdit }) {
  const { t } = useTranslation()
  const e = ep.edit
  return (
    <Section icon={Clapperboard} title={t('editor.format', 'Format & audio')}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {ASPECTS.map(([a, label]) => (
            <Toggle key={a} on={e.aspect === a} onClick={() => setEdit((x) => ({ ...x, aspect: a }))}>
              {label}
            </Toggle>
          ))}
        </div>
        {e.aspect !== 'source' && (
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">{t('editor.fit', 'Fit')}:</span>
            {(['crop', 'pad', 'blur'] as const).map((m) => (
              <Toggle key={m} on={e.fitMode === m} onClick={() => setEdit((x) => ({ ...x, fitMode: m }))}>
                {m === 'crop' ? t('editor.crop', 'Crop to fill') : m === 'pad' ? t('editor.pad', 'Black bars') : t('editor.blur', 'Blurred background')}
              </Toggle>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Fade in" min={0} max={3} step={0.1} value={e.fadeIn} onChange={(v) => setEdit((x) => ({ ...x, fadeIn: v }), false)} format={(v) => `${v.toFixed(1)}s`} />
          <Slider label="Fade out" min={0} max={3} step={0.1} value={e.fadeOut} onChange={(v) => setEdit((x) => ({ ...x, fadeOut: v }), false)} format={(v) => `${v.toFixed(1)}s`} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Music className="size-4 text-muted-foreground" />
          {e.bgm ? (
            <>
              <span className="max-w-[16ch] truncate text-xs" title={e.bgm.path}>
                {e.bgm.path.split(/[\\/]/).pop()}
              </span>
              <Slider className="w-40" label={t('editor.bgmVol', 'Volume')} min={0} max={1} step={0.05} value={e.bgm.volume} onChange={(v) => setEdit((x) => ({ ...x, bgm: { ...x.bgm!, volume: v } }), false)} format={(v) => `${Math.round(v * 100)}%`} />
              <Switch checked={e.bgm.loop} onChange={(v) => setEdit((x) => ({ ...x, bgm: { ...x.bgm!, loop: v } }))} label={<span className="text-xs">{t('editor.loop', 'Loop')}</span>} />
              <Button size="sm" variant="ghost" onClick={() => setEdit((x) => ({ ...x, bgm: undefined }))}>
                <X />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => importBgm(ep.id).catch(notify)}>
              {t('editor.addBgm', 'Add background music')}
            </Button>
          )}
        </div>
      </div>
    </Section>
  )
}

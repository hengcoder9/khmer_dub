import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle2, Circle, Film, Loader2, Pause, Play, Square, XCircle } from 'lucide-react'
import type { MediaInfo, SttEngine, Translator } from '@shared/types'
import { episodeLabel, newEpisode } from '@shared/defaults'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Select } from '@/components/ui/controls'
import { mutate, setEpisodeVideo, useProject, setActiveEpisode } from '@/store/project'
import { cancelJob, useJobs } from '@/store/jobs'
import { useSettings } from '@/store/settings'
import { post } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  appendLog,
  assignDefaultActor,
  autoMatchCast,
  fillVoices,
  staleLines,
  diarize,
  exportEpisode,
  generateVoices,
  separateVocals,
  transcribe,
  translate,
  VIDEO_FILTERS
} from '@/lib/pipeline'

type StepId = 'separate' | 'transcribe' | 'diarize' | 'translate' | 'cast' | 'tts' | 'export'
type StepState = 'wait' | 'run' | 'done' | 'skip' | 'error'

interface Preset {
  separate: boolean
  engine: SttEngine
  diarize: boolean
  translator: Translator
  autoCast: boolean
  tts: boolean
  export: boolean
  burn: boolean
  applyEdit: boolean
}

export function AutomateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const project = useProject((s) => s.project!)
  const dir = useProject((s) => s.dir!)
  const jobs = useJobs((s) => s.jobs)
  // every episode with a video (re-running an exported one is allowed)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(project.episodes.filter((e) => e.videoPath).map((e) => e.id)))
  const [preset, setPreset] = useState<Preset>({
    separate: true,
    engine: project.settings.sttEngine,
    diarize: false,
    translator: project.settings.translator,
    autoCast: true,
    tts: true,
    export: true,
    burn: project.settings.burnSubtitles,
    applyEdit: false
  })
  const [status, setStatus] = useState<Record<string, Partial<Record<StepId, StepState>>>>({})
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const ctl = useRef({ paused: false, stop: false })

  const steps: Array<[StepId, string, boolean]> = [
    ['separate', t('auto.separate', 'Remove BGM'), preset.separate],
    ['transcribe', t('auto.transcribe', 'Transcribe'), true],
    ['diarize', t('auto.diarize', 'Speakers'), preset.diarize],
    ['translate', t('auto.translate', 'Translate'), preset.engine !== 'gemini-direct'],
    ['cast', t('auto.cast', 'Apply cast'), preset.autoCast],
    ['tts', t('auto.tts', 'Voices + fit'), preset.tts],
    ['export', t('auto.export', 'Mix + export'), preset.export]
  ]

  const addVideos = async () => {
    const files = await window.api.openFiles({ filters: VIDEO_FILTERS })
    for (const f of files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const info = await post<MediaInfo>('/media/probe', { path: f })
      const p = useProject.getState().project!
      const empty = p.episodes.find((e) => !e.videoPath)
      let id = empty?.id
      if (!id) {
        const used = new Set(p.episodes.map((e) => e.label))
        let n = p.episodes.length + 1
        while (used.has(episodeLabel(n))) n++
        const ep = newEpisode(n)
        mutate((pp) => ({ ...pp, episodes: [...pp.episodes, ep] }), { undo: false })
        id = ep.id
      }
      setEpisodeVideo(id, info)
      setPicked((s) => new Set([...s, id!]))
    }
  }

  const waitIfPaused = async () => {
    while (ctl.current.paused && !ctl.current.stop) await new Promise((r) => setTimeout(r, 300))
    if (ctl.current.stop) throw new Error('Canceled')
  }

  const start = async () => {
    ctl.current = { paused: false, stop: false }
    setRunning(true)
    setPaused(false)
    const order = project.episodes.filter((e) => picked.has(e.id))
    const log = (line: string) => appendLog('automate.log', [`[${project.name}] ${line}`])
    log(`start: ${order.map((e) => e.label).join(', ')} preset=${JSON.stringify(preset)}`)
    mutate((p) => ({ ...p, settings: { ...p.settings, sttEngine: preset.engine, translator: preset.translator, burnSubtitles: preset.burn } }), { undo: false })

    // nice-to-have steps: a failure is a warning, the episode still gets dubbed
    const OPTIONAL: StepId[] = ['separate', 'diarize', 'cast']
    const firstLine = (err: unknown) => (err as Error).message.split(/\r?\n/)[0]

    const runEpisode = async (e: (typeof order)[number], first: boolean) => {
      const mark = (s: StepId, st: StepState) => setStatus((x) => ({ ...x, [e.id]: { ...x[e.id], [s]: st } }))
      if (first) setActiveEpisode(e.id)
      try {
        for (const [id, label, on] of steps) {
          await waitIfPaused()
          if (!on) {
            mark(id, 'skip')
            continue
          }
          mark(id, 'run')
          log(`${e.label} ${id}…`)
          const cur = () => useProject.getState().project!.episodes.find((x) => x.id === e.id)!
          try {
          switch (id) {
            case 'separate':
              if (!cur().stems.instrumental) await separateVocals(e.id)
              break
            case 'transcribe':
              // also redo lines that belong to a different (longer) video
              if (!cur().segments.length || staleLines(cur())) {
                try {
                  await transcribe(preset.engine, e.id, { chain: false, ask: false })
                } catch (err) {
                  // e.g. Gemini out of quota: Whisper runs on this PC
                  if (preset.engine === 'whisper' || ctl.current.stop) throw err
                  toast.warning(`${e.label}: ${preset.engine} failed (${firstLine(err)}) — using Whisper`)
                  log(`${e.label} transcribe fallback → whisper: ${firstLine(err)}`)
                  await transcribe('whisper', e.id, { chain: false, ask: false })
                }
              }
              break
            case 'diarize':
              await diarize(e.id)
              break
            case 'translate':
              try {
                await translate(e.id, undefined, preset.translator)
              } catch (err) {
                // bad key / no quota: the offline translator needs neither
                if (preset.translator === 'offline' || ctl.current.stop) throw err
                toast.warning(`${e.label}: ${preset.translator} failed (${firstLine(err)}) — translating offline`)
                log(`${e.label} translate fallback → offline: ${firstLine(err)}`)
                await translate(e.id, undefined, 'offline')
              }
              break
            case 'cast':
              await autoMatchCast()
              assignDefaultActor(e.id)
              await fillVoices()
              break
            case 'tts':
              await generateVoices(undefined, e.id)
              break
            case 'export':
              await exportEpisode(
                {
                  outDir: `${dir}\\exports\\${cur().label}`,
                  mp4: true,
                  srt: true,
                  vtt: false,
                  ass: false,
                  dubWav: false,
                  instrumental: false,
                  burn: preset.burn,
                  applyEdit: preset.applyEdit,
                  remix: true,
                  originalAudio: false,
                  cpu: false,
                  resolution: useSettings.getState().exportResolution
                },
                e.id
              )
              break
          }
          } catch (err) {
            if (!OPTIONAL.includes(id) || ctl.current.stop) throw err
            mark(id, 'error')
            log(`${e.label} ${id} skipped: ${firstLine(err)}`)
            toast.warning(`${e.label}: ${label} failed — skipped (${firstLine(err)})`)
            continue
          }
          mark(id, 'done')
          log(`${e.label} ${id} done`)
        }
      } catch (err) {
        const msg = firstLine(err)
        setStatus((x) => {
          const cur = x[e.id] ?? {}
          const runningStep = (Object.keys(cur) as StepId[]).find((k) => cur[k] === 'run')
          return runningStep ? { ...x, [e.id]: { ...cur, [runningStep]: 'error' } } : x
        })
        log(`${e.label} ERROR: ${msg}`)
        if (!ctl.current.stop) toast.error(`${e.label}: ${msg}`)
      }
    }

    // two episodes in flight: the next one's GPU steps (Remove BGM, Whisper) overlap this one's voices + export;
    // the backend job lanes keep each kind of work in order
    let next = 0
    const lane = async () => {
      while (next < order.length && !ctl.current.stop) {
        const i = next++
        await runEpisode(order[i], i === 0)
      }
    }
    await Promise.all([lane(), lane()])
    log('finished')
    setRunning(false)
    toast.success(t('auto.finished', 'Automate finished — log saved to automate.log'))
  }

  const stop = () => {
    ctl.current.stop = true
    Object.values(jobs)
      .filter((j) => j.status === 'running' || j.status === 'queued')
      .forEach((j) => cancelJob(j.id))
  }

  const icon = (s?: StepState) =>
    s === 'run' ? (
      <Loader2 className="size-4 animate-spin text-primary" />
    ) : s === 'done' ? (
      <CheckCircle2 className="size-4 text-success" />
    ) : s === 'error' ? (
      <XCircle className="size-4 text-destructive" />
    ) : (
      <Circle className={cn('size-4', s === 'skip' ? 'opacity-20' : 'opacity-40')} />
    )

  return (
    <Dialog open onOpenChange={(v) => !v && !running && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[860px] flex-col p-6">
        <DialogTitle>{t('auto.title', 'Automate — batch dub episodes')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">
          {t('auto.desc', 'Runs every step for each picked episode. The cast is shared, so the same actor keeps the same voice across episodes.')}
        </DialogDescription>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="text-sm font-medium">{t('auto.preset', 'Preset')}</div>
            <Checkbox checked={preset.separate} onChange={(v) => setPreset({ ...preset, separate: v })} label={t('auto.pSeparate', 'Remove BGM first (Demucs)')} />
            <label className="flex items-center gap-2 text-sm">
              {t('auto.pEngine', 'Transcribe with')}
              <Select
                className="flex-1"
                value={preset.engine}
                onChange={(v) => setPreset({ ...preset, engine: v as SttEngine })}
                options={[
                  { value: 'gemini-direct', label: 'Direct (Gemini)' },
                  { value: 'whisper', label: 'Whisper + Translate' },
                  { value: 'gemini-cast', label: 'Gemini Transcribe + Cast' },
                  { value: 'offline', label: 'Offline (Whisper)' }
                ]}
              />
            </label>
            <Checkbox checked={preset.diarize} onChange={(v) => setPreset({ ...preset, diarize: v })} label={t('auto.pDiarize', 'Detect speakers offline (match cast across episodes)')} />
            <label className="flex items-center gap-2 text-sm">
              {t('auto.pTranslator', 'Translator')}
              <Select
                className="flex-1"
                value={preset.translator}
                onChange={(v) => setPreset({ ...preset, translator: v as Translator })}
                options={[
                  { value: 'gemini', label: 'Gemini' },
                  { value: 'openrouter', label: 'OpenRouter' },
                  { value: 'claude', label: 'Claude' },
                  { value: 'offline', label: 'Offline (NLLB)' }
                ]}
              />
            </label>
            <Checkbox checked={preset.autoCast} onChange={(v) => setPreset({ ...preset, autoCast: v })} label={t('auto.pCast', 'Auto-match voices to actors')} />
            <Checkbox checked={preset.tts} onChange={(v) => setPreset({ ...preset, tts: v })} label={t('auto.pTts', 'Generate voices + auto-fit')} />
            <Checkbox checked={preset.export} onChange={(v) => setPreset({ ...preset, export: v })} label={t('auto.pExport', 'Mix and export MP4 + SRT')} />
            <Checkbox checked={preset.burn} onChange={(v) => setPreset({ ...preset, burn: v })} label={t('auto.pBurn', 'Burn styled captions')} />
            <Checkbox checked={preset.applyEdit} onChange={(v) => setPreset({ ...preset, applyEdit: v })} label={t('auto.pEdit', 'Apply AI-editor cuts')} />
          </div>
          <div className="flex min-h-0 flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{t('auto.episodes', 'Episodes')}</div>
              <Button size="sm" variant="outline" onClick={addVideos} disabled={running}>
                <Film /> {t('auto.addVideos', 'Add videos…')}
              </Button>
            </div>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {project.episodes.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.has(e.id)}
                    onChange={(v) => setPicked((s) => (v ? new Set([...s, e.id]) : new Set([...s].filter((x) => x !== e.id))))}
                    label={<span className="font-mono">{e.label}</span>}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{e.media?.name ?? t('auto.noVideo', 'no video')}</span>
                  <div className="flex gap-0.5">{steps.map(([id]) => <span key={id} title={id}>{icon(status[e.id]?.[id])}</span>)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">{t('auto.logHint', 'Log: %APPDATA%/KhmerDub Studio/logs/automate.log')}</span>
          {running ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  ctl.current.paused = !ctl.current.paused
                  setPaused(ctl.current.paused)
                }}
              >
                {paused ? <Play /> : <Pause />} {paused ? t('auto.resume', 'Resume') : t('auto.pause', 'Pause after step')}
              </Button>
              <Button variant="destructive" onClick={stop}>
                <Square /> {t('auto.stop', 'Stop')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t('common.close', 'Close')}
              </Button>
              <Button onClick={start} disabled={![...picked].some((id) => project.episodes.find((e) => e.id === id)?.videoPath)}>
                <Play /> {t('auto.start', 'Start ({{n}} episodes)', { n: [...picked].filter((id) => project.episodes.find((e) => e.id === id)?.videoPath).length })}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

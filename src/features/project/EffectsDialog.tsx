import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AudioLines, FileAudio, Loader2, Play, Plus, Sparkles, Trash2, Volume2, Wand2 } from 'lucide-react'
import type { Actor, SfxItem } from '@shared/types'
import { SFX_LIBRARY, VOICE_FX, VOICE_FX_IDS, type VoiceFx } from '@shared/fx'
import { uid } from '@shared/defaults'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/controls'
import { mutate, updateEpisode, useActiveEpisode, useProject } from '@/store/project'
import { playerApi, useUi } from '@/store/ui'
import { useSettings } from '@/store/settings'
import { mediaUrl, post } from '@/lib/api'
import { notify } from '@/lib/pipeline'
import { cn, formatTime } from '@/lib/utils'

const fmt = (s: number) => formatTime(s).slice(s >= 3600 ? 0 : 3, 10)
let playing: HTMLAudioElement | null = null
async function play(path: string) {
  playing?.pause()
  playing = new Audio(await mediaUrl(path))
  await playing.play()
}

/** Sound effects placed on the video, and voice effects on actors or lines. Heard in the mix / export. */
export function EffectsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const cast = useProject((s) => s.project?.cast ?? [])
  const selected = useProject((s) => s.selected)
  const [tab, setTab] = useState<'sfx' | 'voice'>('sfx')
  const [busy, setBusy] = useState<string | null>(null)
  if (!ep) return null
  const sfx = ep.sfx ?? []
  const now = () => useUi.getState().time

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }
  const setSfx = (list: SfxItem[]) => updateEpisode(ep.id, (e) => ({ ...e, sfx: [...list].sort((a, b) => a.start - b.start) }))
  const addSfx = (src: string, name: string) => {
    setSfx([...sfx, { id: uid(), src, name, start: Math.round(now() * 100) / 100, volume: 0.8 }])
    toast.success(t('fx.added', '“{{name}}” added at {{time}}', { name, time: fmt(now()) }))
  }
  const importSfx = async () => {
    const path = await window.api.openFile({ filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'] }] })
    if (path) addSfx(path, path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''))
  }
  const previewSfx = (src: string) => run(`p:${src}`, async () => play((await post<{ path: string }>('/fx/preview', { sfx: src })).path))

  /** an actor's own voiced line (or a voice sample) with the effect */
  const previewVoice = (a: Actor, fx: VoiceFx) =>
    run(`v:${a.id}`, async () => {
      let path = ep.segments.find((s) => s.actorId === a.id && s.audioPath)?.audioPath
      if (!path) {
        const st = useSettings.getState()
        path = (
          await post<{ path: string }>('/voices/preview', {
            voiceId: a.voiceId ?? (a.gender === 'female' ? 'default:female' : 'default:male'),
            text: a.sampleText || 'សួស្តី! នេះគឺជាសំឡេងរបស់ខ្ញុំ។',
            defaultMale: st.defaultMale,
            defaultFemale: st.defaultFemale
          })
        ).path
      }
      await play((await post<{ path: string }>('/fx/preview', { path, fx })).path)
    })
  const setActorFx = (id: string, fx?: VoiceFx) => mutate((p) => ({ ...p, cast: p.cast.map((a) => (a.id === id ? { ...a, fx } : a)) }))
  const setLinesFx = (fx: VoiceFx | 'none' | undefined) => {
    updateEpisode(ep.id, (e) => ({ ...e, segments: e.segments.map((s) => (selected.has(s.id) ? { ...s, fx } : s)) }))
    toast.success(t('fx.linesSet', 'Effect set on {{n}} lines', { n: selected.size }))
  }

  const fxOptions = (
    <>
      {VOICE_FX_IDS.map((id) => (
        <option key={id} value={id}>
          {t(`fx.v.${id}`, VOICE_FX[id].name)}
        </option>
      ))}
    </>
  )

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] w-[720px] overflow-y-auto p-6">
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" /> {t('fx.title', 'Sound & voice effects')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('fx.desc', 'Add sound effects at any moment, or put an effect on a voice. You hear them in the preview buttons here, and in the mix / export.')}
        </DialogDescription>

        <div className="mt-2 flex gap-4 border-b">
          {(
            [
              ['sfx', Volume2, t('fx.tabSfx', 'Sound effects')],
              ['voice', AudioLines, t('fx.tabVoice', 'Voice effects')]
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setTab(id)} className={cn('-mb-px flex h-9 items-center gap-1.5 border-b-2 text-sm', tab === id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {tab === 'sfx' ? (
          <div className="flex flex-col gap-4 pt-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('fx.atPlayhead', 'New sounds go at the playhead: {{time}} — move the playhead on the timeline first.', { time: fmt(now()) })}
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={importSfx}>
                <FileAudio /> {t('fx.import', 'Your own sound…')}
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {SFX_LIBRARY.map((s) => (
                <div key={s.id} className="group flex items-center gap-1 rounded-lg border bg-card p-1.5 pl-2.5 transition hover:border-primary/50">
                  <span className="min-w-0 flex-1 truncate text-sm">{t(`fx.s.${s.id}`, s.name)}</span>
                  <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('fx.listen', 'Listen')} onClick={() => previewSfx(`builtin:${s.id}`)}>
                    {busy === `p:builtin:${s.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  </button>
                  <button className="rounded p-1 text-primary hover:bg-primary/10" title={t('fx.add', 'Add at the playhead')} onClick={() => addSfx(`builtin:${s.id}`, t(`fx.s.${s.id}`, s.name))}>
                    <Plus className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <div className="studio-label">{t('fx.placed', 'In this episode ({{n}})', { n: sfx.length })}</div>
              {!sfx.length && <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{t('fx.none', 'No sound effects yet. Pick a moment on the timeline, then press + on a sound.')}</div>}
              {sfx.map((x) => (
                <div key={x.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                  <button className="font-mono text-xs text-primary hover:underline" title={t('fx.jump', 'Go to this moment')} onClick={() => playerApi()?.seek(x.start)}>
                    {fmt(x.start)}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm" title={x.src}>{x.name}</span>
                  <button className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" title={t('fx.moveHint', 'Move it to the playhead')} onClick={() => setSfx(sfx.map((y) => (y.id === x.id ? { ...y, start: Math.round(now() * 100) / 100 } : y)))}>
                    {t('fx.move', 'Move here')}
                  </button>
                  <Slider className="w-32" label="" min={0.1} max={1.5} step={0.05} value={x.volume} onChange={(v) => setSfx(sfx.map((y) => (y.id === x.id ? { ...y, volume: v } : y)))} format={(v) => `${Math.round(v * 100)}%`} />
                  <button className="rounded p-1 hover:bg-accent" onClick={() => previewSfx(x.src)} title={t('fx.listen', 'Listen')}>
                    <Play className="size-3.5" />
                  </button>
                  <button className="rounded p-1 hover:bg-accent" onClick={() => setSfx(sfx.filter((y) => y.id !== x.id))} title={t('fx.remove', 'Remove')}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-3">
            <div className="flex flex-col gap-1">
              <div className="studio-label">{t('fx.byActor', 'Per actor — every line of that character')}</div>
              {!cast.length && <div className="text-xs text-muted-foreground">{t('fx.noCast', 'No actors yet.')}</div>}
              {cast.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{a.name || a.label}</span>
                  <select className="h-7 w-44 rounded border bg-background px-1 text-xs" value={a.fx ?? ''} onChange={(e) => setActorFx(a.id, (e.target.value || undefined) as VoiceFx | undefined)}>
                    <option value="">{t('fx.noEffect', 'No effect')}</option>
                    {fxOptions}
                  </select>
                  <Button size="sm" variant="ghost" disabled={!a.fx || !!busy} onClick={() => a.fx && previewVoice(a, a.fx)} title={t('fx.listen', 'Listen')}>
                    {busy === `v:${a.id}` ? <Loader2 className="animate-spin" /> : <Play />}
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
              <Wand2 className="size-4 text-primary" />
              <span className="text-sm">{selected.size ? t('fx.forLines', 'Effect for the {{n}} selected lines', { n: selected.size }) : t('fx.selectLines', 'Select lines in the list to give only them an effect (e.g. a phone call)')}</span>
              <div className="flex-1" />
              <select
                className="h-7 w-44 rounded border bg-background px-1 text-xs"
                disabled={!selected.size}
                value=""
                onChange={(e) => e.target.value && setLinesFx(e.target.value === 'actor' ? undefined : (e.target.value as VoiceFx | 'none'))}
              >
                <option value="">{t('fx.choose', 'Choose…')}</option>
                <option value="actor">{t('fx.likeActor', "Same as the actor's")}</option>
                <option value="none">{t('fx.noEffect', 'No effect')}</option>
                {fxOptions}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('fx.mixNote', 'Effects are added when the audio is mixed — on Export (with "Re-mix audio") or the Mix button.')}</p>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Bot, FolderOpen, ImagePlus, ListPlus, Loader2, Music, Play, Rocket, Trash2, Wand2, X } from 'lucide-react'
import type { StoryBackground, StoryPlan, StoryStyle } from '@shared/story'
import { Button } from '@/components/ui/button'
import { Input, Select, Toggle } from '@/components/ui/controls'
import { useVoices } from '@/lib/hooks'
import { addEpisodeVideos, AUDIO_FILTERS, autoLines, notify, OMNI_USD_PER_SEC, planStoryVideo, renderStoryVideo, VIDEO_FILTERS } from '@/lib/pipeline'
import { cn } from '@/lib/utils'

const STYLES: Array<[StoryStyle, string]> = [
  ['story', 'Story'],
  ['explainer', 'Explainer'],
  ['motivation', 'Motivation'],
  ['news', 'News'],
  ['ad', 'Advert']
]

/**
 * Claude Video: Claude writes the scenes (narration, titles, colours, camera prompts); the app renders them with a
 * Khmer voice, animated titles and captions over moving colours, your photos/clips, or Omni-filmed shots.
 */
export function StoryVideo({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [voices] = useVoices()
  const [topic, setTopic] = useState('')
  const [style, setStyle] = useState<StoryStyle>('story')
  const [seconds, setSeconds] = useState(45)
  const [aspect, setAspect] = useState<'9:16' | '16:9'>('9:16')
  const [background, setBackground] = useState<StoryBackground>('colors')
  const [media, setMedia] = useState<string[]>([])
  const [music, setMusic] = useState<string | undefined>()
  const [voiceId, setVoiceId] = useState('default:female')
  const [plan, setPlan] = useState<StoryPlan | null>(null)
  const [busy, setBusy] = useState<'plan' | 'render' | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)

  const write = async () => {
    setBusy('plan')
    setFiles(null)
    try {
      const p = await planStoryVideo({ topic, style, seconds })
      setPlan(p)
      return p
    } catch (e) {
      notify(e)
      return null
    } finally {
      setBusy(null)
    }
  }

  const render = async (p: StoryPlan | null = plan) => {
    if (!p) return
    if (background === 'media' && !media.length) return toast.info(t('sv.needMedia', 'Add some photos or clips first (or choose Colours)'))
    setBusy('render')
    try {
      const out = await renderStoryVideo({ plan: p, aspect, background, media, musicPath: music, voiceId })
      setFiles(out)
      toast.success(t('sv.done', 'Claude video ready'))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const oneClick = async () => {
    const p = await write()
    if (p) await render(p)
  }

  const set = (i: number, patch: Partial<StoryPlan['scenes'][number]>) =>
    setPlan((p) => (p ? { ...p, scenes: p.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : p))
  const mp4 = files?.find((f) => f.endsWith('.mp4'))
  const omniCost = background === 'omni' && plan ? plan.scenes.length * 8 * OMNI_USD_PER_SEC['720p'] : null

  return (
    <section className={cn('rounded-lg border bg-card text-left', compact && 'w-full max-w-xl')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Bot className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('sv.title', 'Claude Video')}</h3>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{t('sv.subtitle', 'Claude writes · the app renders')}</span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          placeholder={t('sv.placeholder', 'What is the video about? e.g. “The history of Angkor Wat in 45 seconds” or “Why Cambodian rice is special” (Khmer or English)')}
          className="w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-32" value={style} onChange={(v) => setStyle(v as StoryStyle)} options={STYLES.map(([v, l]) => ({ value: v, label: t(`sv.style.${v}`, l) }))} />
          <Select className="w-24" value={String(seconds)} onChange={(v) => setSeconds(Number(v))} options={[20, 30, 45, 60, 90].map((s) => ({ value: String(s), label: `${s} s` }))} />
          <Toggle on={aspect === '9:16'} onClick={() => setAspect('9:16')}>
            9:16
          </Toggle>
          <Toggle on={aspect === '16:9'} onClick={() => setAspect('16:9')}>
            16:9
          </Toggle>
          <Select
            className="w-48"
            value={voiceId}
            onChange={setVoiceId}
            options={voices.filter((v) => !v.locale || v.locale.toLowerCase().startsWith('km')).map((v) => ({ value: v.id, label: v.name }))}
            title={t('sv.voice', 'Narrator voice')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('sv.bg', 'Background:')}</span>
          <Toggle on={background === 'colors'} onClick={() => setBackground('colors')}>
            {t('sv.colors', 'Colours (free)')}
          </Toggle>
          <Toggle on={background === 'media'} onClick={() => setBackground('media')}>
            {t('sv.media', 'My photos / clips')}
          </Toggle>
          <Toggle on={background === 'omni'} onClick={() => setBackground('omni')} title={t('sv.omniHint', 'Gemini Omni films each scene from Claude’s camera prompt — needs a paid Gemini key')}>
            {t('sv.omni', 'Omni films (paid)')}
          </Toggle>
          {background === 'media' && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const f = await window.api.openFiles({ filters: [{ name: 'Photos & clips', extensions: ['jpg', 'jpeg', 'png', 'webp', ...VIDEO_FILTERS[0].extensions] }] })
                if (f.length) setMedia(f)
              }}
            >
              <ImagePlus /> {media.length ? t('sv.mediaN', '{{n}} files', { n: media.length }) : t('sv.addMedia', 'Add…')}
            </Button>
          )}
          {music ? (
            <span className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" title={music}>
              <Music className="size-3.5" /> {music.split(/[\\/]/).pop()}
              <button onClick={() => setMusic(undefined)}>
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={async () => setMusic((await window.api.openFile({ filters: AUDIO_FILTERS })) ?? undefined)}>
              <Music /> {t('sv.music', 'Music')}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={oneClick} disabled={!!busy || !topic.trim()} title={t('sv.oneClickHint', 'Claude writes the scenes and the video is rendered straight away')}>
            {busy ? <Loader2 className="animate-spin" /> : <Rocket />} {t('sv.oneClick', 'Write & render')}
          </Button>
          <Button size="sm" variant="outline" onClick={write} disabled={!!busy || !topic.trim()}>
            <Wand2 /> {t('sv.write', 'Write scenes first')}
          </Button>
          {omniCost !== null && <span className="text-xs text-muted-foreground">≈ ${omniCost.toFixed(2)} Omni</span>}
          {busy === 'render' && <span className="text-xs text-muted-foreground">{t('sv.rendering', 'Rendering… progress is in the jobs panel')}</span>}
        </div>

        {plan && (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Input className="h-8 font-medium" value={plan.title} onChange={(e) => setPlan({ ...plan, title: e.target.value })} />
            {plan.scenes.map((s, i) => (
              <div key={i} className="flex gap-2 rounded border p-1.5">
                <div className="flex w-6 shrink-0 flex-col items-center gap-1 pt-1">
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="size-4 rounded" style={{ background: `linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]})` }} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input className="h-7 text-sm font-semibold" value={s.title} onChange={(e) => set(i, { title: e.target.value })} />
                  <textarea
                    rows={2}
                    value={s.narration}
                    onChange={(e) => set(i, { narration: e.target.value })}
                    className="w-full resize-y rounded border bg-background p-1.5 font-hanuman text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <button
                  className="self-start rounded p-1 hover:bg-accent"
                  disabled={plan.scenes.length <= 1}
                  onClick={() => setPlan({ ...plan, scenes: plan.scenes.filter((_, j) => j !== i) })}
                  title={t('sv.removeScene', 'Remove scene')}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="text-[11px] text-primary">{plan.hashtags.join(' ')}</div>
            <Button size="sm" className="self-start" onClick={() => render()} disabled={!!busy}>
              {busy === 'render' ? <Loader2 className="animate-spin" /> : <Rocket />} {t('sv.render', 'Render video')}
            </Button>
          </div>
        )}

        {mp4 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
            <span className="min-w-0 flex-1 truncate" title={mp4}>
              {mp4.split(/[\\/]/).pop()}
            </span>
            <Button size="sm" variant="ghost" onClick={() => window.api.openPath(mp4)}>
              <Play /> {t('pv.play', 'Play')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.api.showInFolder(mp4)}>
              <FolderOpen /> {t('export.show', 'Show')}
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  autoLines(await addEpisodeVideos([mp4]))
                  toast.success(t('pv.added', 'Added as a new episode — the lines are being made'))
                } catch (e) {
                  notify(e)
                }
              }}
            >
              <ListPlus /> {t('pv.addEpisode', 'Add as episode')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

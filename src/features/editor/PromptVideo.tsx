import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FolderOpen, ImagePlus, ListPlus, Loader2, Play, Sparkles, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, Toggle } from '@/components/ui/controls'
import { post } from '@/lib/api'
import {
  addEpisodeVideos,
  autoLines,
  generatePromptVideo,
  improveVideoPrompt,
  notify,
  OMNI_USD_PER_SEC,
  type PromptVideoOptions
} from '@/lib/pipeline'
import { cn } from '@/lib/utils'

const IDEAS = [
  { en: 'A young Khmer woman in a silk dress walks through Angkor Wat at sunrise, gentle music', km: 'នារីខ្មែរពាក់សំពត់សូត្រ ដើរកាត់អង្គរវត្តពេលថ្ងៃរះ ភ្លេងស្រទន់' },
  { en: 'Tuk-tuk ride through busy Phnom Penh streets at night, neon lights, city sounds', km: 'ជិះតុកតុកកាត់ផ្លូវភ្នំពេញពេលយប់ ភ្លើងនីអុង សំឡេងទីក្រុង' },
  { en: 'Close-up of a grandmother cooking amok in a village kitchen, steam and birdsong', km: 'ជីដូនចម្អិនអាម៉ុកនៅផ្ទះបាយភូមិ ចំហុយ និងសំឡេងបក្សី' }
]

/**
 * AI Video from prompt: Google Gemini Omni makes a new 3–15 s video (with sound) from a text prompt and an optional
 * reference image. Works without any episode video; the result can be added as an episode and dubbed.
 */
export function PromptVideo({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState<PromptVideoOptions['aspect']>('9:16')
  const [seconds, setSeconds] = useState(8)
  const [resolution, setResolution] = useState<PromptVideoOptions['resolution']>('720p')
  const [image, setImage] = useState<string | undefined>()
  const [busy, setBusy] = useState<'improve' | 'generate' | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const cost = OMNI_USD_PER_SEC[resolution] * seconds

  const improve = async () => {
    if (!prompt.trim()) return
    setBusy('improve')
    try {
      setPrompt(await improveVideoPrompt(prompt, { seconds, aspect }))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    if (!prompt.trim()) return
    setBusy('generate')
    setResult(null)
    try {
      const path = await generatePromptVideo({ prompt: prompt.trim(), aspect, seconds, resolution, imagePath: image })
      setResult(path)
      toast.success(t('pv.done', 'AI video ready'))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const addAsEpisode = async () => {
    if (!result) return
    try {
      const ids = await addEpisodeVideos([result])
      autoLines(ids)
      toast.success(t('pv.added', 'Added as a new episode — the lines are being made'))
    } catch (e) {
      notify(e)
    }
  }

  return (
    <section id="ai-video" className={cn('scroll-mt-3 rounded-lg border bg-card text-left', compact && 'w-full max-w-xl')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Wand2 className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('pv.title', 'AI Video from prompt')}</h3>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">Google Gemini Omni</span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && generate()}
          rows={4}
          placeholder={t('pv.placeholder', 'Describe the video: who, what happens, where, camera, light, sound… (English works best — write in Khmer and press “Improve prompt”)')}
          className="w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-wrap gap-1">
          {IDEAS.map((x) => (
            <button key={x.en} className="rounded-full border px-2.5 py-0.5 text-xs hover:border-primary/60 hover:bg-accent" onClick={() => setPrompt(i18n.language === 'km' ? x.km : x.en)}>
              {(i18n.language === 'km' ? x.km : x.en).slice(0, 38)}…
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={aspect === '9:16'} onClick={() => setAspect('9:16')}>
            9:16
          </Toggle>
          <Toggle on={aspect === '16:9'} onClick={() => setAspect('16:9')}>
            16:9
          </Toggle>
          <Select
            className="w-28"
            value={String(seconds)}
            onChange={(v) => setSeconds(Number(v))}
            options={[3, 4, 5, 6, 8, 10, 12, 15].map((s) => ({ value: String(s), label: `${s} s` }))}
            title={t('pv.length', 'Length')}
          />
          <Select
            className="w-28"
            value={resolution}
            onChange={(v) => setResolution(v as PromptVideoOptions['resolution'])}
            options={[
              { value: '360p', label: '360p' },
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' }
            ]}
            title={t('pv.quality', 'Quality')}
          />
          {image ? (
            <span className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" title={image}>
              <ImagePlus className="size-3.5" /> {image.split(/[\\/]/).pop()}
              <button onClick={() => setImage(undefined)}>
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              title={t('pv.imageHint', 'Optional: a picture the video starts from or should look like (JPG/PNG)')}
              onClick={async () => {
                const f = await window.api.openFile({ filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png'] }] })
                if (f) {
                  await post('/media/allow', { path: f }).catch(() => {})
                  setImage(f)
                }
              }}
            >
              <ImagePlus /> {t('pv.image', 'Image')}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={improve} disabled={!!busy || !prompt.trim()} title={t('pv.improveHint', 'The AI rewrites your idea as a detailed English prompt')}>
            {busy === 'improve' ? <Loader2 className="animate-spin" /> : <Sparkles />} {t('pv.improve', 'Improve prompt')}
          </Button>
          <Button size="sm" onClick={generate} disabled={!!busy || !prompt.trim()}>
            {busy === 'generate' ? <Loader2 className="animate-spin" /> : <Wand2 />} {t('pv.generate', 'Generate video')}
          </Button>
          <span className="text-xs text-muted-foreground" title={t('pv.costHint', 'Google charges per second of video on a paid (billing-enabled) Gemini key. Approximate — check Google’s pricing page.')}>
            ≈ ${cost.toFixed(2)} · {t('pv.paid', 'paid Gemini key')}
          </span>
        </div>
        {busy === 'generate' && <p className="text-xs text-muted-foreground">{t('pv.wait', 'Generating can take a few minutes. Progress is in the jobs panel.')}</p>}
        {result && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
            <span className="min-w-0 flex-1 truncate" title={result}>
              {result.split(/[\\/]/).pop()}
            </span>
            <Button size="sm" variant="ghost" onClick={() => window.api.openPath(result)}>
              <Play /> {t('pv.play', 'Play')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.api.showInFolder(result)}>
              <FolderOpen /> {t('export.show', 'Show')}
            </Button>
            <Button size="sm" onClick={addAsEpisode}>
              <ListPlus /> {t('pv.addEpisode', 'Add as episode')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

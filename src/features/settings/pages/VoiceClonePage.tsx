import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, FileAudio, HeartPulse, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import type { Gender, Voice } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Slider } from '@/components/ui/controls'
import { api, mediaUrl, post } from '@/lib/api'
import { useSettings } from '@/store/settings'
import { activeEpisode, useProject } from '@/store/project'
import { reloadVoices, useVoices } from '@/lib/hooks'
import { AUDIO_FILTERS, notify, VIDEO_FILTERS } from '@/lib/pipeline'

export function VoiceClonePage() {
  const { t } = useTranslation()
  const s = useSettings()
  const [voices] = useVoices()
  const clones = voices.filter((v) => v.engine === 'clone')
  const [health, setHealth] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [name, setName] = useState('')
  const [gender, setGender] = useState<Gender>('male')
  const [ref, setRef] = useState('')
  const [start, setStart] = useState(0)
  const [text, setText] = useState('')
  const [duration, setDuration] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const focus = useProject((st) => st.focusId)

  useEffect(() => {
    reloadVoices().catch(() => {})
  }, [])

  const applyConfig = (patch: Partial<typeof s>) => {
    s.set(patch)
    const n = { ...useSettings.getState(), ...patch }
    post('/engines/config', { cloneLanes: n.cloneLanes, clone: { engine: n.cloneEngine, model: n.cloneModel, ckptFile: n.cloneCkpt || undefined, vocabFile: n.cloneVocab || undefined } }).catch(() => {})
  }

  const check = async () => {
    setChecking(true)
    setHealth(null)
    try {
      const r = await api<{ ok: boolean; gpu?: boolean; device?: string; vram_gb?: number; model?: string; engine?: string; installed?: boolean }>('/engines/clone/health')
      if (r.engine === 'voxcpm2' && r.installed === false) setHealth(`✗ ${t('clone.notInstalled', 'VoxCPM2 is not installed — Settings → Engines → Voice cloning (VoxCPM2)')}`)
      else
        setHealth(
          `✓ ${r.model} · ${r.gpu ? `GPU ${r.device ?? ''}${r.vram_gb ? ` (${r.vram_gb} GB)` : ''}` : 'CPU'}` +
            (r.engine === 'voxcpm2' && r.vram_gb !== undefined && r.vram_gb < 8 ? ` — ${t('clone.lowVram', 'under 8 GB VRAM: VoxCPM2 may run out of memory')}` : '')
        )
    } catch (e) {
      setHealth(`✗ ${(e as Error).message}`)
    } finally {
      setChecking(false)
    }
  }

  const fromLine = () => {
    const ep = activeEpisode()
    const seg = ep?.segments.find((x) => x.id === focus)
    if (!ep || !seg) return toast.info(t('clone.pickLine', 'Select a line in the grid first'))
    setRef(ep.stems.vocals ?? ep.videoPath)
    setStart(seg.start)
    setDuration(Math.round((seg.end - seg.start) * 100) / 100)
    setText(seg.textOriginal)
    if (!name) setName(useProject.getState().project?.cast.find((a) => a.id === seg.actorId)?.name ?? 'Voice')
  }

  const create = async () => {
    setBusy('create')
    try {
      await post('/voices/clone', { name, gender, refPath: ref, refText: text, start, duration })
      await reloadVoices()
      setName('')
      setRef('')
      setText('')
      setStart(0)
      setDuration(undefined)
      toast.success(t('clone.created', 'Voice created'))
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const warmup = async () => {
    setBusy('warmup')
    const id = toast.loading(t('clone.warming', 'Loading the voice model… the first time downloads ~5 GB, this can take a while'))
    try {
      await post('/engines/clone/warmup', {})
      toast.success(t('clone.warm', 'Voice model ready'), { id })
    } catch (e) {
      toast.dismiss(id)
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  const preview = async (v: Voice) => {
    setBusy(v.id)
    try {
      const r = await post<{ path: string }>('/voices/preview', { voiceId: v.id, text: 'សួស្តី! នេះគឺជាសំឡេងរបស់ខ្ញុំ។ Hello, this is my voice.', defaultMale: s.defaultMale, defaultFemale: s.defaultFemale })
      new Audio(await mediaUrl(r.path)).play()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {s.cloneEngine === 'voxcpm2'
          ? t('clone.descVox', 'VoxCPM2 (OpenBMB, Apache-2.0) clones a voice from a 5–15 s clip and speaks Khmer, so an actor keeps their own voice in the dub. Install it in Engines; it needs an NVIDIA GPU with about 8 GB of VRAM. Only clone voices you have permission to use.')
          : t('clone.desc', 'Local voice cloning with F5-TTS (install it in Engines). The base model speaks English/Chinese; for Khmer, load a Khmer fine-tuned checkpoint below.')}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('clone.engine', 'Clone engine')}>
          <Select
            value={s.cloneEngine}
            onChange={(v) => applyConfig({ cloneEngine: v as 'voxcpm2' | 'f5' })}
            options={[
              { value: 'voxcpm2', label: t('clone.engineVox', 'VoxCPM2 — speaks Khmer (recommended)') },
              { value: 'f5', label: t('clone.engineF5', 'F5-TTS — English/Chinese, or a Khmer checkpoint') }
            ]}
          />
        </Field>
        <Field
          label={t('clone.lanes', 'Parallel GPU workers (lanes)')}
          hint={s.cloneEngine === 'voxcpm2' && s.cloneLanes > 1 ? t('clone.lanesVox', 'Each VoxCPM2 lane needs ~8 GB of VRAM') : undefined}
        >
          <Slider min={1} max={4} step={1} value={s.cloneLanes} onChange={(v) => applyConfig({ cloneLanes: v })} />
        </Field>
      </div>
      {s.cloneEngine === 'f5' && (
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('clone.model', 'Model')}>
          <Input value={s.cloneModel} onChange={(e) => applyConfig({ cloneModel: e.target.value })} />
        </Field>
        <div />
        <Field label={t('clone.ckpt', 'Custom checkpoint (.safetensors/.pt)')}>
          <div className="flex gap-1">
            <Input className="flex-1" value={s.cloneCkpt} onChange={(e) => applyConfig({ cloneCkpt: e.target.value })} />
            <Button variant="outline" size="icon" onClick={async () => { const f = await window.api.openFile({ filters: [{ name: 'Checkpoint', extensions: ['safetensors', 'pt'] }] }); if (f) applyConfig({ cloneCkpt: f }) }}>
              <FileAudio />
            </Button>
          </div>
        </Field>
        <Field label={t('clone.vocab', 'Vocab file (vocab.txt)')}>
          <div className="flex gap-1">
            <Input className="flex-1" value={s.cloneVocab} onChange={(e) => applyConfig({ cloneVocab: e.target.value })} />
            <Button variant="outline" size="icon" onClick={async () => { const f = await window.api.openFile({ filters: [{ name: 'Vocab', extensions: ['txt'] }] }); if (f) applyConfig({ cloneVocab: f }) }}>
              <FileAudio />
            </Button>
          </div>
        </Field>
      </div>
      )}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={check} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <HeartPulse />} {t('clone.check', 'Start & check engine')}
        </Button>
        <Button variant="outline" size="sm" onClick={warmup} disabled={!!busy}>
          {busy === 'warmup' ? <Loader2 className="animate-spin" /> : <Download />} {t('clone.warmup', 'Download & load model')}
        </Button>
        {health && <span className="text-sm text-muted-foreground">{health}</span>}
      </div>

      <section className="flex flex-col gap-3 rounded-md border p-3">
        <div className="text-sm font-medium">{t('clone.new', 'New cloned voice (5–15 s of clean speech)')}</div>
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder={t('clone.name', 'Name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={gender} onChange={(v) => setGender(v as Gender)} options={[{ value: 'male', label: '♂ Male' }, { value: 'female', label: '♀ Female' }]} />
          <Input type="number" step={0.1} min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} title={t('clone.start', 'Start time (s) in the file')} />
        </div>
        <div className="flex gap-2">
          <Input className="flex-1" placeholder={t('clone.ref', 'Reference audio/video file')} value={ref} readOnly />
          <Button variant="outline" size="sm" onClick={async () => { const f = await window.api.openFile({ filters: [...AUDIO_FILTERS, ...VIDEO_FILTERS] }); if (f) { await post('/media/allow', { path: f }); setRef(f); setDuration(undefined) } }}>
            {t('clone.browse', 'Browse…')}
          </Button>
          <Button variant="outline" size="sm" onClick={fromLine}>
            {t('clone.fromLine', 'Use selected line')}
          </Button>
        </div>
        <textarea rows={2} className="rounded-md border bg-background p-2 text-sm" placeholder={t('clone.transcript', 'Exact transcript of the reference clip')} value={text} onChange={(e) => setText(e.target.value)} />
        <Button className="self-start" size="sm" onClick={create} disabled={!name.trim() || !ref || !text.trim() || busy === 'create'}>
          {busy === 'create' ? <Loader2 className="animate-spin" /> : <Plus />} {t('clone.create', 'Create voice')}
        </Button>
      </section>

      <div className="flex flex-col divide-y rounded-md border">
        {clones.length === 0 && <div className="p-3 text-sm text-muted-foreground">{t('clone.none', 'No cloned voices yet')}</div>}
        {clones.map((v) => (
          <div key={v.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span>{v.gender === 'female' ? '♀' : '♂'}</span>
            <span className="flex-1">{v.name}</span>
            <button className="rounded p-1 hover:bg-accent" onClick={() => preview(v)}>
              {busy === v.id ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            </button>
            <button
              className="rounded p-1 hover:bg-accent"
              onClick={async () => {
                await api(`/voices/clone/${v.id.replace('clone:', '')}`, { method: 'DELETE' })
                reloadVoices()
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

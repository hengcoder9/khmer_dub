import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Cpu, Download, Loader2, RefreshCw } from 'lucide-react'
import { ENGINE_GROUPS } from '@shared/engines'
import { Button } from '@/components/ui/button'
import { Progress, Slider } from '@/components/ui/controls'
import { api, post } from '@/lib/api'
import { runJob, useJobs } from '@/store/jobs'
import { useSettings } from '@/store/settings'
import { notify } from '@/lib/pipeline'
import { reloadVoices } from '@/lib/hooks'

export function EnginesPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const [nvidia, setNvidia] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const jobs = useJobs((s) => s.jobs)
  const { gpuLanes, set } = useSettings()
  const installing = Object.values(jobs).find((j) => j.type === 'engines.install' && (j.status === 'running' || j.status === 'queued'))

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await api<{ groups: Record<string, boolean>; nvidia: boolean }>('/engines/status')
      setStatus(r.groups)
      setNvidia(r.nvidia)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  const install = async (groups: string[]) => {
    try {
      await runJob('engines.install', { groups })
      await refresh()
      if (groups.includes('core')) reloadVoices(true).catch(() => {})
    } catch (e) {
      notify(e)
    }
  }

  const recommended = ['core', 'whisper', 'torch', 'demucs']

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border p-3 text-sm">
        <Cpu className="size-5 text-primary" />
        {nvidia === null ? (
          <Loader2 className="size-4 animate-spin" />
        ) : nvidia ? (
          <span>{t('engines.nvidia', 'NVIDIA GPU detected — CUDA builds will be installed.')}</span>
        ) : (
          <span>{t('engines.cpu', 'No NVIDIA GPU — CPU builds will be installed (slower).')}</span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {installing && (
        <div className="flex flex-col gap-1 rounded-md border border-primary/40 p-3">
          <div className="flex justify-between text-xs">
            <span className="truncate">{installing.message || installing.label}</span>
            <span className="font-mono">{Math.round(installing.progress)}%</span>
          </div>
          <Progress value={installing.progress} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => install(recommended)} disabled={!!installing}>
          <Download /> {t('engines.recommended', 'Install recommended (Core, Whisper, PyTorch, Demucs)')}
        </Button>
      </div>

      <div className="flex flex-col divide-y rounded-md border">
        {ENGINE_GROUPS.map((g) => (
          <div key={g.id} className="flex items-center gap-3 px-3 py-2.5">
            {status[g.id] ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <div className="size-5 shrink-0 rounded-full border-2" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t(`engines.g.${g.id}`, g.label)}</div>
              <div className="text-xs text-muted-foreground">
                {g.description} · {g.sizeHint}
                {g.requires?.length ? ` · needs ${g.requires.join(', ')}` : ''}
              </div>
            </div>
            <Button size="sm" variant={status[g.id] ? 'ghost' : 'outline'} disabled={!!installing} onClick={() => install([g.id])}>
              {status[g.id] ? t('engines.reinstall', 'Update') : t('engines.install', 'Install')}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="text-sm font-medium">{t('engines.lanes', 'GPU lanes')}</div>
        <p className="text-xs text-muted-foreground">{t('engines.lanesHint', 'How many GPU jobs (transcribe, separate, voices) may run at once. Use 1 for GPUs with ≤ 8 GB VRAM.')}</p>
        <Slider
          className="w-72"
          min={1}
          max={4}
          step={1}
          value={gpuLanes}
          onChange={(v) => {
            set({ gpuLanes: v })
            post('/engines/config', { gpuLanes: v }).catch(() => {})
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('engines.where', 'Engines are installed into %APPDATA%\\KhmerDub Studio\\python; models download on first use into …\\models.')}</p>
    </div>
  )
}

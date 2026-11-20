import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import type { Voice } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { mediaUrl, post } from '@/lib/api'
import { useSettings } from '@/store/settings'
import { useVoices } from '@/lib/hooks'
import { notify } from '@/lib/pipeline'

const SAMPLE: Record<string, string> = {
  km: 'សួស្តី! ខ្ញុំរីករាយណាស់ដែលបានជួបអ្នក។',
  en: 'Hello! It is great to meet you.',
  th: 'สวัสดีครับ ยินดีที่ได้รู้จัก',
  vi: 'Xin chào! Rất vui được gặp bạn.',
  zh: '你好！很高兴认识你。',
  ko: '안녕하세요! 만나서 반갑습니다.',
  ja: 'こんにちは！はじめまして。'
}

export function OfflineVoicesPage() {
  const { t } = useTranslation()
  const [voices, reload] = useVoices()
  const s = useSettings()
  const [q, setQ] = useState('km')
  const [busy, setBusy] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    return voices.filter((v) => v.engine === 'edge' && !v.id.startsWith('default:') && (!k || `${v.name} ${v.locale}`.toLowerCase().includes(k)))
  }, [voices, q])

  const preview = async (v: Voice) => {
    setBusy(v.id)
    try {
      const r = await post<{ path: string }>('/voices/preview', { voiceId: v.id, text: SAMPLE[v.locale.slice(0, 2)] ?? SAMPLE.en, defaultMale: s.defaultMale, defaultFemale: s.defaultFemale })
      new Audio(await mediaUrl(r.path)).play()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('voices.desc', 'Microsoft Edge neural voices (free, needs internet). Set them as defaults or assign them to actors in Cast.')}</p>
      <div className="flex gap-2">
        <Input className="flex-1" placeholder={t('voices.filter', 'Filter: km, en-US, Thai…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button
          variant="outline"
          onClick={async () => {
            setRefreshing(true)
            await reload(true).catch(notify)
            setRefreshing(false)
          }}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : ''} /> {t('voices.refresh', 'Load all voices')}
        </Button>
      </div>
      <div className="flex flex-col divide-y rounded-md border">
        {list.map((v) => (
          <div key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            {v.gender === 'female' ? <span className="text-pink-500">♀</span> : <span className="text-sky-500">♂</span>}
            <span className="flex-1">{v.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{v.locale}</span>
            <button className="rounded p-1 hover:bg-accent" onClick={() => preview(v)}>
              {busy === v.id ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            </button>
            <Button
              size="sm"
              variant={(v.gender === 'female' ? s.defaultFemale : s.defaultMale) === v.id ? 'secondary' : 'ghost'}
              onClick={() => s.set(v.gender === 'female' ? { defaultFemale: v.id } : { defaultMale: v.id })}
            >
              {(v.gender === 'female' ? s.defaultFemale : s.defaultMale) === v.id ? t('voices.isDefault', 'Default') : t('voices.makeDefault', 'Set default')}
            </Button>
          </div>
        ))}
        {list.length === 0 && <div className="p-3 text-sm text-muted-foreground">{t('voices.none', 'No voices match')}</div>}
      </div>
    </div>
  )
}

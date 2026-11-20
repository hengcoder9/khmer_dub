import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { useSettings } from '@/store/settings'

/** Mirrors backend applyDictionary() so the user can see the effect. */
function apply(text: string, dict: Array<{ from: string; to: string }>) {
  let t = text
  for (const { from, to } of dict) {
    if (!from) continue
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = /^[\w\s'-]+$/.test(from) ? new RegExp(`\\b${esc}\\b`, 'gi') : new RegExp(esc, 'g')
    t = t.replace(re, to)
  }
  return t
}

export function PronunciationPage() {
  const { t } = useTranslation()
  const { dictionary, set } = useSettings()
  const [sample, setSample] = useState('OK, ទៅ AI Studio ជាមួយ John!')
  const update = (d: typeof dictionary) => set({ dictionary: d })

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('pron.desc', 'Words are replaced right before speech is generated (subtitles keep the original spelling). Use it for names, English words and abbreviations, e.g. “AI” → “អេ អាយ”.')}
      </p>
      <div className="flex flex-col gap-1">
        {dictionary.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="flex-1" value={d.from} placeholder={t('pron.word', 'Word')} onChange={(e) => update(dictionary.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <span className="text-muted-foreground">→</span>
            <Input className="flex-1 font-hanuman" value={d.to} placeholder={t('pron.say', 'Say as')} onChange={(e) => update(dictionary.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <button className="rounded p-1 hover:bg-accent" onClick={() => update(dictionary.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="self-start" onClick={() => update([...dictionary, { from: '', to: '' }])}>
          <Plus /> {t('pron.add', 'Add word')}
        </Button>
      </div>
      <div className="flex flex-col gap-1 rounded-md border p-3">
        <span className="text-xs text-muted-foreground">{t('pron.test', 'Test')}</span>
        <Input value={sample} onChange={(e) => setSample(e.target.value)} />
        <div className="font-hanuman text-sm">→ {apply(sample, dictionary)}</div>
      </div>
    </div>
  )
}

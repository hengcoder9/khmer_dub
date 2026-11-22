import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Plus, Trash2, XCircle, FlaskConical } from 'lucide-react'
import type { KeyEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/controls'
import { useSettings } from '@/store/settings'
import { useJobs } from '@/store/jobs'
import { post } from '@/lib/api'
import { codecraftDashboard } from '@shared/urls'

type TestResult = { id: string; ok: boolean; detail: string; models?: string[] }

function KeyList({ provider, keys, setKeys }: { provider: KeyEntry['provider']; keys: KeyEntry[]; setKeys: (k: KeyEntry[]) => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [testing, setTesting] = useState(false)
  const set = useSettings((s) => s.set)
  const mine = keys.filter((k) => k.provider === provider)

  const add = async () => {
    // allow pasting many keys at once (one per line / comma separated)
    const parts = value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
    try {
      let list = keys
      for (const p of parts) list = await window.api.keys.add(provider, p, label || undefined)
      setKeys(list)
      setValue('')
      setLabel('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await post<{ results: TestResult[] }>('/keys/test', { provider })
      setResults(Object.fromEntries(r.results.map((x) => [x.id, x])))
      const models = r.results.find((x) => x.models?.length)?.models
      if (provider === 'gemini' && models?.length) {
        const cur = useSettings.getState().geminiModel
        // Google still lists retired 1.x/2.x models, but they 404 for new keys — never auto-pick those
        const usable = models.filter((m) => !/^gemini-[12]\./.test(m))
        if (!models.includes(cur) || /^gemini-[12]\./.test(cur)) {
          const pick =
            usable.find((m) => /flash/.test(m) && !/lite|image|tts|live|embedding|preview|exp/.test(m)) ??
            usable.find((m) => /flash/.test(m) && !/image|tts|live|embedding/.test(m)) ??
            usable[0] ??
            models[0]
          set({ geminiModel: pick })
          toast.info(t('keys.modelSwitched', 'Model set to {{m}}', { m: pick }))
        }
        localStorage.setItem('kd-gemini-models', JSON.stringify(models))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {mine.map((k) => {
        const r = results[k.id]
        return (
          <div key={k.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <span className="font-mono">{k.masked}</span>
            {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
            <div className="flex-1" />
            {r && (r.ok ? <CheckCircle2 className="size-4 text-success" /> : <span className="flex items-center gap-1 text-xs text-destructive" title={r.detail}><XCircle className="size-4" /> {r.detail.slice(0, 40)}</span>)}
            <button className="rounded p-1 hover:bg-accent" onClick={async () => setKeys(await window.api.keys.remove(k.id))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )
      })}
      <div className="flex gap-2">
        <Input className="flex-1 font-mono" type="password" placeholder={{ gemini: 'AIza…', openrouter: 'sk-or-…', claude: 'sk-ant-…', codecraft: 'sk-…' }[provider]} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Input className="w-32" placeholder={t('keys.label', 'Label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button variant="outline" onClick={add} disabled={!value.trim()}>
          <Plus /> {t('keys.add', 'Add')}
        </Button>
        <Button variant="outline" onClick={test} disabled={!mine.length || testing}>
          {testing ? <Loader2 className="animate-spin" /> : <FlaskConical />} {t('keys.test', 'Test')}
        </Button>
      </div>
    </div>
  )
}

export function ApiKeysPage() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<KeyEntry[]>([])
  const s = useSettings()
  const pool = useJobs((st) => st.keys)
  const [models, setModels] = useState<string[]>([])
  useEffect(() => {
    window.api.keys.list().then(setKeys)
    try {
      setModels(JSON.parse(localStorage.getItem('kd-gemini-models') ?? '[]'))
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {t('keys.desc', 'Keys are encrypted with Windows DPAPI and kept only on this PC. Add several Gemini keys: the app rotates them and pauses a key for 60 s when it hits a rate limit.')}
      </p>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Google Gemini</h3>
          <span className="rounded bg-secondary px-2 py-0.5 text-xs">
            {t('keys.pool', 'Pool')} {pool.ready}/{pool.total}
          </span>
          <a className="ml-auto text-xs text-primary hover:underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
            {t('keys.getGemini', 'Get a free key →')}
          </a>
        </div>
        <KeyList provider="gemini" keys={keys} setKeys={setKeys} />
        <Field label={t('keys.geminiModel', 'Gemini model')} hint={t('keys.modelHint', 'Click Test to load the models your key can use')}>
          <Input list="gemini-models" value={s.geminiModel} onChange={(e) => s.set({ geminiModel: e.target.value.trim() })} />
          <datalist id="gemini-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">OpenRouter</h3>
          <a className="ml-auto text-xs text-primary hover:underline" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            {t('keys.getOpenRouter', 'Get a key →')}
          </a>
        </div>
        <KeyList provider="openrouter" keys={keys} setKeys={setKeys} />
        <Field label={t('keys.orModel', 'OpenRouter model')} hint="e.g. google/gemini-2.5-flash, anthropic/claude-sonnet-4.5, openai/gpt-4o-mini">
          <Input value={s.openrouterModel} onChange={(e) => s.set({ openrouterModel: e.target.value.trim() })} />
        </Field>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Anthropic Claude</h3>
          <a className="ml-auto text-xs text-primary hover:underline" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
            {t('keys.getClaude', 'Get a key →')}
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('keys.claudeUse', 'Used for translation, AI edit commands and shortening lines when the translator is set to Claude. Transcription and screen reading stay on Gemini.')}
        </p>
        <KeyList provider="claude" keys={keys} setKeys={setKeys} />
        <Field label={t('keys.claudeModel', 'Claude model')} hint={t('keys.claudeModelHint', 'Opus 5.5 = best quality · Sonnet 5.5 = faster · Haiku 5.5 = cheapest')}>
          <Input list="claude-models" value={s.claudeModel} onChange={(e) => s.set({ claudeModel: e.target.value.trim() })} />
          <datalist id="claude-models">
            {['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
      </section>
      <CodeCraftSection keys={keys} setKeys={setKeys} />
    </div>
  )
}

/** CodeCraft: an OpenAI-compatible AI gateway (base URL + key from its dashboard). */
function CodeCraftSection({ keys, setKeys }: { keys: KeyEntry[]; setKeys: (k: KeyEntry[]) => void }) {
  const { t } = useTranslation()
  const s = useSettings()
  const [models, setModels] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const dashboard = codecraftDashboard(s.codecraftBaseUrl)
  const saveUrl = (url: string) => {
    s.set({ codecraftBaseUrl: url.trim() })
    post('/llm/config', { codecraftBaseUrl: url.trim() }).catch(() => {})
  }
  const check = async () => {
    setChecking(true)
    setStatus(null)
    try {
      const r = await post<{ results: Array<{ ok: boolean; detail: string; models?: string[] }> }>('/keys/test', { provider: 'codecraft' })
      const ok = r.results.find((x) => x.ok)
      if (ok?.models?.length) setModels(ok.models)
      setStatus(ok ? `✓ ${ok.detail}` : `✗ ${r.results[0]?.detail ?? t('cc.noKey', 'Add a key first')}`)
    } catch (e) {
      setStatus(`✗ ${(e as Error).message}`)
    } finally {
      setChecking(false)
    }
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">CodeCraft</h3>
        <span className="text-xs text-muted-foreground">{t('cc.kind', 'OpenAI-compatible AI gateway')}</span>
        {dashboard ? (
          <a className="ml-auto text-xs text-primary hover:underline" href={dashboard} target="_blank" rel="noreferrer" title={dashboard}>
            {t('cc.getKey', 'Get API key →')}
          </a>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">{t('cc.getKeyHint', 'Paste the base URL to get the API key link')}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('cc.desc', 'Paste the base URL and an API key from your CodeCraft dashboard. Then choose CodeCraft as the translator (it is also used by the AI Creator, AI titles and polish), and/or for Read Screen below.')}
      </p>
      <Field label={t('cc.baseUrl', 'Base URL')} hint={t('cc.baseUrlHint', 'From your CodeCraft dashboard, usually ending in /v1 (…/chat/completions is added automatically)')}>
        <Input className="font-mono" placeholder="https://…/v1" defaultValue={s.codecraftBaseUrl} onBlur={(e) => saveUrl(e.target.value)} />
      </Field>
      <KeyList provider="codecraft" keys={keys} setKeys={setKeys} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('cc.model', 'Model')} hint={t('cc.modelHint', 'e.g. gemini-3.1-pro — “Check” loads the list')}>
          <Input list="codecraft-models" value={s.codecraftModel} onChange={(e) => s.set({ codecraftModel: e.target.value.trim() })} />
          <datalist id="codecraft-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t('cc.screen', 'Read Screen uses')}>
          <Select
            value={s.screenReader}
            onChange={(v) => s.set({ screenReader: v as 'gemini' | 'codecraft' })}
            options={[
              { value: 'gemini', label: 'Google Gemini' },
              { value: 'codecraft', label: 'CodeCraft' }
            ]}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={check} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <FlaskConical />} {t('cc.check', 'Check connection')}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </section>
  )
}


import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { APP_NAME, type UpdateInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/controls'
import { cn } from '@/lib/utils'
import { useSettings, type Lang, type Theme } from '@/store/settings'
import { useVoices } from '@/lib/hooks'
import { api } from '@/lib/api'

function Choice<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex self-start rounded-md border p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cn('rounded px-3 py-1 text-sm', v === value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function GeneralPage() {
  const { t } = useTranslation()
  const s = useSettings()
  const [voices] = useVoices()
  const [root, setRoot] = useState('')
  useEffect(() => {
    api<{ root: string }>('/projects/root').then((r) => setRoot(r.root)).catch(() => {})
  }, [])
  const real = voices.filter((v) => !v.id.startsWith('default:'))
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <Field label={t('general.language', 'Interface language')}>
        <Choice<Lang> value={s.lang} onChange={s.setLang} options={[['en', 'English'], ['km', 'ខ្មែរ']]} />
      </Field>
      <Field label={t('general.defaultMale', 'Default Male voice')} hint={t('general.defaultHint', 'Used by actors without their own voice')}>
        <Select value={s.defaultMale} onChange={(v) => s.set({ defaultMale: v })} options={real.filter((v) => v.gender === 'male').map((v) => ({ value: v.id, label: v.name }))} />
      </Field>
      <Field label={t('general.defaultFemale', 'Default Female voice')}>
        <Select value={s.defaultFemale} onChange={(v) => s.set({ defaultFemale: v })} options={real.filter((v) => v.gender === 'female').map((v) => ({ value: v.id, label: v.name }))} />
      </Field>
      <Field label={t('general.projects', 'Projects folder')}>
        <div className="text-sm text-muted-foreground">{root}</div>
      </Field>
    </div>
  )
}

export function ThemePage() {
  const { t } = useTranslation()
  const { theme, setTheme } = useSettings()
  return (
    <Field label={t('settings.theme', 'Theme')}>
      <Choice<Theme> value={theme} onChange={setTheme} options={[['dark', t('theme.dark', 'Dark')], ['light', t('theme.light', 'Light')], ['system', t('theme.system', 'System')]]} />
    </Field>
  )
}

export function AccountPage() {
  const { t } = useTranslation()
  return (
    <div className="flex max-w-xl flex-col gap-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-5 text-success" /> {t('account.local', 'Local mode — no account needed')}
      </div>
      <p className="text-muted-foreground">
        {t(
          'account.desc',
          'Your projects, voices and models stay on this PC. Cloud features (Gemini, OpenRouter, Edge-TTS) use your own API keys, which are encrypted with Windows DPAPI and never written into project files or logs.'
        )}
      </p>
    </div>
  )
}

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S', 'Save now (autosave runs every second)'],
  ['Ctrl+F', 'Find & replace (grid) · search (settings)'],
  ['↑ / ↓', 'Previous / next line (Shift = extend selection)'],
  ['Enter', 'Edit the focused dub line'],
  ['Ctrl+Enter', 'Generate voices for selected lines'],
  ['Delete', 'Delete selected lines'],
  ['Ctrl+A', 'Select all lines'],
  ['Ctrl+wheel', 'Zoom timeline'],
  ['Ctrl+,', 'Open settings']
]

export function ShortcutsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex max-w-xl flex-col divide-y rounded-md border">
      {SHORTCUTS.map(([k, d]) => (
        <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
          <span>{t(`shortcuts.${k}`, d)}</span>
          <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">{k}</kbd>
        </div>
      ))}
    </div>
  )
}

export function TutorialsPage() {
  const { t } = useTranslation()
  const steps: Array<[string, string]> = [
    [t('tut.s1', 'Install engines'), t('tut.s1d', 'Settings → Engines → Install “Core”. Add Whisper and Demucs for local transcription and BGM removal (NVIDIA GPU recommended).')],
    [t('tut.s2', 'Add API keys'), t('tut.s2d', 'Settings → API Keys → add one or more Gemini keys (free at aistudio.google.com). Several keys rotate automatically when one hits its limit.')],
    [t('tut.s3', 'Create a project'), t('tut.s3d', 'New project → pick one video (or many for a series). Each video becomes an episode tab at the bottom.')],
    [t('tut.s4', 'Remove BGM'), t('tut.s4d', 'Click “Remove BGM” to split voices from music. The instrumental (A2) stays under your dub.')],
    [t('tut.s5', 'Transcribe & translate'), t('tut.s5d', '“Transcribe” → Direct (Gemini) gives lines, speakers, gender and Khmer in one pass. Edit lines in the grid (double-click).')],
    [t('tut.s6', 'Cast voices'), t('tut.s6d', 'Cast → Auto-match gives each actor a distinct voice; preview with ▶ and change any voice.')],
    [t('tut.s7', 'Generate & fit'), t('tut.s7d', '“Generate Audio” voices every line and auto-fits it to its time slot. ▲ = too fast: click it to let AI shorten the line.')],
    [t('tut.s8', 'Edit the video (optional)'), t('tut.s8d', 'AI Video Editor tab: type a command (“make a 60 s TikTok”), remove silences, cut by text, reframe to 9:16, style captions.')],
    [t('tut.s9', 'Export'), t('tut.s9d', 'Export → MP4 with dub, SRT/VTT, burned captions. Use Automate to run everything for many episodes.')]
  ]
  return (
    <ol className="flex max-w-2xl flex-col gap-3">
      {steps.map(([title, d], i) => (
        <li key={i} className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
          <div>
            <div className="text-sm font-medium">{title}</div>
            <div className="text-sm text-muted-foreground">{d}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function AboutPage() {
  const { t } = useTranslation()
  const [version, setVersion] = useState('')
  const [u, setU] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    window.api.getAppInfo().then((i) => setVersion(i.version))
    return window.api.update.onStatus(setU)
  }, [])
  const check = async () => {
    setChecking(true)
    setU(await window.api.update.check())
    setChecking(false)
  }
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <p className="text-lg font-semibold">{APP_NAME}</p>
        <p className="text-sm text-muted-foreground">{t('settings.version', 'Version {{version}}', { version })}</p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={check} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('about.check', 'Check for updates')}
        </Button>
        {u?.state === 'none' && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> {u.error ?? t('about.latest', 'You have the latest version')}
          </span>
        )}
        {u?.state === 'error' && <span className="text-sm text-destructive">{u.error}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('about.credits', 'Uses ffmpeg (GPL build), faster-whisper, Demucs, Resemblyzer, NLLB-200, F5-TTS, Edge-TTS, Kantumruy Pro & Hanuman fonts (OFL).')}
      </p>
    </div>
  )
}

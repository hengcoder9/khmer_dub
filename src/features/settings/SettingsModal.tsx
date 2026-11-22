import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Cpu,
  HeartPulse,
  Info,
  KeyRound,
  Keyboard,
  Mic,
  Palette,
  Search,
  Settings2,
  SpellCheck,
  User,
  Users,
  type LucideIcon
} from 'lucide-react'
import { APP_NAME } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { HealthPage } from './HealthPage'
import { AboutPage, AccountPage, GeneralPage, ShortcutsPage, ThemePage, TutorialsPage } from './pages/BasicPages'
import { ApiKeysPage } from './pages/ApiKeysPage'
import { EnginesPage } from './pages/EnginesPage'
import { VoiceClonePage } from './pages/VoiceClonePage'
import { OfflineVoicesPage } from './pages/OfflineVoicesPage'
import { PronunciationPage } from './pages/PronunciationPage'

export type SectionId =
  | 'general'
  | 'account'
  | 'theme'
  | 'apiKeys'
  | 'engines'
  | 'shortcuts'
  | 'voiceClone'
  | 'offlineVoices'
  | 'pronunciation'
  | 'health'
  | 'tutorials'
  | 'about'

const SECTIONS: Array<{ id: SectionId; icon: LucideIcon; en: string; keywords: string }> = [
  { id: 'general', icon: Settings2, en: 'General', keywords: 'language default voice folder' },
  { id: 'account', icon: User, en: 'Account', keywords: 'profile local' },
  { id: 'theme', icon: Palette, en: 'Theme', keywords: 'dark light color' },
  { id: 'apiKeys', icon: KeyRound, en: 'API Keys', keywords: 'gemini openrouter claude codecraft model key pool base url' },
  { id: 'engines', icon: Cpu, en: 'Engines', keywords: 'python install whisper demucs torch gpu cuda lanes' },
  { id: 'shortcuts', icon: Keyboard, en: 'Shortcuts', keywords: 'keyboard hotkey' },
  { id: 'voiceClone', icon: Mic, en: 'Voice Clone Engine', keywords: 'f5 clone reference gpu lanes' },
  { id: 'offlineVoices', icon: Users, en: 'Voices', keywords: 'edge tts voices preview default' },
  { id: 'pronunciation', icon: SpellCheck, en: 'Pronunciation', keywords: 'dictionary word replace' },
  { id: 'health', icon: HeartPulse, en: 'Health', keywords: 'check status ffmpeg' },
  { id: 'tutorials', icon: BookOpen, en: 'Tutorials', keywords: 'help guide how' },
  { id: 'about', icon: Info, en: 'About', keywords: 'version update' }
]

interface Props {
  section: SectionId | null
  onSectionChange: (s: SectionId | null) => void
}

export function SettingsModal({ section, onSectionChange }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const visible = SECTIONS.filter((s) => !q || `${t(`settings.sections.${s.id}`, s.en)} ${s.en} ${s.keywords}`.toLowerCase().includes(q))

  return (
    <Dialog open={section !== null} onOpenChange={(o) => !o && onSectionChange(null)}>
      <DialogContent
        className="flex h-[680px] w-[1000px] max-w-[95vw] overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key.toLowerCase() === 'f') {
            e.preventDefault()
            searchRef.current?.focus()
          }
        }}
      >
        <nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-muted/40 p-3">
          <DialogTitle className="px-2 pb-2">{t('settings.title', 'Settings')}</DialogTitle>
          <DialogDescription className="sr-only">{APP_NAME}</DialogDescription>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.search', 'Search… (Ctrl+F)')}
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {visible.map(({ id, icon: Icon, en }) => (
            <button
              key={id}
              onClick={() => onSectionChange(id)}
              className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', id === section ? 'bg-primary/15 font-medium text-primary' : 'hover:bg-accent')}
            >
              <Icon className="size-4" />
              {t(`settings.sections.${id}`, en)}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
          {section && <h2 className="mb-4 text-lg font-semibold">{t(`settings.sections.${section}`, SECTIONS.find((s) => s.id === section)?.en ?? '')}</h2>}
          {section === 'general' && <GeneralPage />}
          {section === 'account' && <AccountPage />}
          {section === 'theme' && <ThemePage />}
          {section === 'apiKeys' && <ApiKeysPage />}
          {section === 'engines' && <EnginesPage />}
          {section === 'shortcuts' && <ShortcutsPage />}
          {section === 'voiceClone' && <VoiceClonePage />}
          {section === 'offlineVoices' && <OfflineVoicesPage />}
          {section === 'pronunciation' && <PronunciationPage />}
          {section === 'health' && <HealthPage />}
          {section === 'tutorials' && <TutorialsPage />}
          {section === 'about' && <AboutPage />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

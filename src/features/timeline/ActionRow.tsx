import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Captions, ChevronDown, Gauge, Languages, Loader2, Mic, ScanText, Sparkles, TriangleAlert, Volume1, Clock4, Merge } from 'lucide-react'
import type { SttEngine, Translator } from '@shared/types'
import { LANG_NAMES } from '@shared/translate'
import { Button } from '@/components/ui/button'
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, Select, Toggle } from '@/components/ui/controls'
import { mutate, useActiveEpisode, useProject } from '@/store/project'
import { generateVoices, syncDefaultVoices, listenReadSrt, remakeLines, staleLines, mixEpisode, notify, readScreen, transcribe, translate } from '@/lib/pipeline'
import { toast } from 'sonner'
import { useSettings } from '@/store/settings'

export function ActionRow() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const s = useProject((st) => st.project?.settings)
  const selected = useProject((st) => st.selected)
  const [busy, setBusy] = useState<string | null>(null)
  const autoOn = useSettings((st) => st.autoLines)
  const lang = s?.targetLang
  // default voices follow the target language
  useEffect(() => {
    if (lang) void syncDefaultVoices(lang)
  }, [lang])
  if (!ep || !s) return null
  const set = (patch: Partial<typeof s>) => mutate((p) => ({ ...p, settings: { ...p.settings, ...patch } }), { undo: false })
  const warn = ep.segments.filter((x) => x.fitWarning)

  const run = (key: string, fn: () => Promise<unknown>) => async () => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }
  const spin = (key: string, icon: React.ReactNode) => (busy === key ? <Loader2 className="animate-spin" /> : icon)

  const ENGINES: Array<[SttEngine, string, string]> = [
    ['gemini-direct', t('stt.direct', 'Direct (Gemini)'), t('stt.directHint', 'One pass: transcript + translation + speakers + gender')],
    ['whisper', t('stt.whisper', 'Whisper + Translate'), t('stt.whisperHint', 'Local faster-whisper, then your translator')],
    ['gemini-cast', t('stt.cast', 'Gemini Transcribe + Cast'), t('stt.castHint', 'Gemini finds who speaks when, then translate')],
    ['offline', t('stt.offline', 'Offline Speakers + Translate'), t('stt.offlineHint', 'Whisper + local speakers + offline translation — no internet')]
  ]
  const TRANSLATORS: Array<[Translator, string]> = [
    ['gemini', 'Gemini'],
    ['openrouter', 'OpenRouter'],
    ['claude', 'Claude'],
    ['codecraft', 'CodeCraft'],
    ['offline', t('tr.offline', 'Offline (NLLB)')]
  ]
  const sel = [...selected]

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-t px-2">
      <Select
        className="w-28"
        title={t('ar.target', 'Target language')}
        value={s.targetLang}
        onChange={(v) => set({ targetLang: v })}
        options={Object.entries(LANG_NAMES).map(([v, l]) => ({ value: v, label: `→ ${l}` }))}
      />
      <Toggle on={s.autoFit} onClick={() => set({ autoFit: !s.autoFit })} title={t('ar.autoFitHint', 'Squeeze each voice line into its time slot')}>
        <Gauge /> {t('ar.autoFit', 'Auto-Fit')} {s.autoFit ? 'ON' : 'OFF'}
      </Toggle>
      <Select
        className="w-20"
        title={t('ar.maxSpeed', 'Max speed-up')}
        value={String(s.maxSpeed)}
        onChange={(v) => set({ maxSpeed: Number(v) })}
        options={[1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2].map((v) => ({ value: String(v), label: `≤${v}×` }))}
      />
      {staleLines(ep) > 0 && (
        <button
          className="flex h-8 items-center gap-1 rounded-md border border-destructive/60 bg-destructive/10 px-2 text-xs text-destructive"
          disabled={!!busy}
          onClick={() => {
            if (confirm(t('ar.staleConfirm', 'These lines are from a different video. Replace all {{n}} lines with new ones made from this video?', { n: ep.segments.length }))) void run('lr', () => remakeLines())()
          }}
          title={t('ar.staleHint', 'Lines run past the end of this video — they belong to a different video')}
        >
          <TriangleAlert className="size-3.5" /> {t('ar.stale', '{{n}} lines past video end — make new lines', { n: staleLines(ep) })}
        </button>
      )}
      {warn.length > 0 && (
        <button
          className="flex h-8 items-center gap-1 rounded-md border border-warning/50 bg-warning/10 px-2 text-xs text-warning"
          onClick={() => useProject.setState({ selected: new Set(warn.map((w) => w.id)), focusId: warn[0].id })}
          title={t('ar.speedFixHint', 'Select them — then shorten text (▲) or raise max speed')}
        >
          <TriangleAlert className="size-3.5" /> {t('ar.speedFix', '{{n}} lines too fast', { n: warn.length })}
        </button>
      )}
      <Toggle on={s.syncEnd} onClick={() => set({ syncEnd: !s.syncEnd })} title={t('ar.syncEndHint', 'Let a line run on into the silence before the next one')}>
        <Clock4 /> {t('ar.syncEnd', 'Sync End')}
      </Toggle>
      <Toggle
        on={s.autoOriginal ?? true}
        onClick={() => set({ autoOriginal: !(s.autoOriginal ?? true) })}
        title={t('ar.autoOrigHint', 'Auto: original sound is muted while a dub line (A1) speaks and comes back on where there is no dub')}
      >
        <Volume1 /> {t('ar.autoOrig', 'Auto ORIG')} {s.autoOriginal ?? true ? 'ON' : 'OFF'}
      </Toggle>
      {!(s.autoOriginal ?? true) && (
        <Toggle on={s.ducking} onClick={() => set({ ducking: !s.ducking })} title={t('ar.duckingHint', 'Lower the background while dub voices speak')}>
          <Volume1 /> {t('ar.ducking', 'Ducking')} {s.ducking ? 'ON' : 'OFF'}
        </Toggle>
      )}
      <Toggle on={s.keepOriginal} onClick={() => set({ keepOriginal: !s.keepOriginal })} title={t('ar.origHint', 'Keep the original voices quietly under the dub instead of the instrumental')}>
        ORIG {Math.round(s.origVolume * 100)}%
      </Toggle>

      <div className="flex-1" />

      <Button
        size="sm"
        onClick={run('lr', () => listenReadSrt())}
        disabled={!!busy || !ep.videoPath}
        title={t('ar.lrHint', 'Listen to the speech and read on-screen subtitles together, merge them, translate, and save original + translated SRT files')}
      >
        {spin('lr', <Captions />)} {t('ar.lr', 'Listen + Read → SRT')}
      </Button>
      <Toggle
        on={autoOn}
        onClick={() => useSettings.getState().set({ autoLines: !autoOn })}
        title={t('ar.autoHint', 'Make dubbing lines automatically (Listen + Read, then translate) as soon as a video is imported')}
      >
        <Sparkles /> {t('ar.auto', 'Auto')}
      </Toggle>

      <Button variant="outline" size="sm" onClick={run('ocr', () => readScreen())} disabled={!!busy || !ep.videoPath} title={t('ar.ocrHint', 'Read hard-coded subtitles from the video with Gemini vision')}>
        {spin('ocr', <ScanText />)} {t('ar.ocr', 'Read Screen')}
      </Button>

      <DropdownMenu>
        <DropdownTrigger asChild>
          <Button variant="outline" size="sm" disabled={!!busy || !ep.videoPath}>
            {spin('stt', <Mic />)} {t('ar.transcribe', 'Transcribe')} <ChevronDown className="opacity-60" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end" className="w-80">
          <DropdownLabel>{t('ar.sttEngine', 'Speech-to-text engine')}</DropdownLabel>
          {ENGINES.map(([id, label, hint]) => (
            <DropdownItem
              key={id}
              onSelect={() => {
                set({ sttEngine: id })
                run('stt', () => transcribe(id))()
              }}
              className="flex-col items-start gap-0"
            >
              <span className="font-medium">
                {label} {s.sttEngine === id && '✓'}
              </span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownLabel>{t('ar.whisperModel', 'Whisper model')}</DropdownLabel>
          {['large-v3', 'large-v3-turbo', 'medium', 'small'].map((m) => (
            <DropdownItem key={m} onSelect={() => set({ whisperModel: m })}>
              {m} {s.whisperModel === m && '✓'}
            </DropdownItem>
          ))}
        </DropdownContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownTrigger asChild>
          <Button variant="outline" size="sm" disabled={!!busy || !ep.segments.length}>
            {spin('tr', <Languages />)} {t('ar.translate', 'Translate')} <ChevronDown className="opacity-60" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownLabel>{t('ar.translator', 'Translator')}</DropdownLabel>
          {TRANSLATORS.map(([id, label]) => (
            <DropdownItem key={id} onSelect={() => set({ translator: id })}>
              {label} {s.translator === id && '✓'}
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem onSelect={() => run('tr', () => translate())()}>{t('ar.trMissing', 'Translate untranslated lines')}</DropdownItem>
          <DropdownItem disabled={!sel.length} onSelect={() => run('tr', () => translate(undefined, sel))()}>
            {t('ar.trSelected', 'Re-translate selected ({{n}})', { n: sel.length })}
          </DropdownItem>
          <DropdownItem
            onSelect={() => confirm(t('ar.trAllConfirm', 'Re-translate ALL lines? Your edits will be replaced.')) && run('tr', () => translate(undefined, ep.segments.map((x) => x.id)))()}
          >
            {t('ar.trAll', 'Re-translate all')}
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownTrigger asChild>
          <Button size="sm" disabled={!!busy || !ep.segments.length}>
            {spin('tts', <Sparkles />)} {sel.length ? t('ar.genSelected', 'Generate Selected ({{n}})', { n: sel.length }) : t('ar.genAll', 'Generate Audio')} <ChevronDown className="opacity-70" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownItem disabled={!sel.length} onSelect={() => run('tts', () => generateVoices(sel))()}>
            {t('ar.genSel', 'Generate selected lines')}
          </DropdownItem>
          <DropdownItem onSelect={() => run('tts', () => generateVoices(ep.segments.filter((x) => !x.audioPath && x.textTarget).map((x) => x.id)))()}>
            {t('ar.genMissing', 'Generate missing lines')}
          </DropdownItem>
          <DropdownItem onSelect={() => run('tts', () => generateVoices())()}>{t('ar.genEvery', 'Regenerate all lines')}</DropdownItem>
          <DropdownSeparator />
          <DropdownItem
            onSelect={() =>
              run('mix', async () => {
                await mixEpisode()
                toast.success(t('ar.mixed', 'Dub mixed — preview it in Export or play lines'))
              })()
            }
          >
            <Merge /> {t('ar.mix', 'Mix dub track now')}
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>
    </div>
  )
}

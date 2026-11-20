import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp, BookA, Combine, Languages, ListPlus, Replace, Scissors, Sparkles, Trash2, Tv } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select
} from '@/components/ui/controls'
import { addEpisode, mutate, patchSegments, setActiveEpisode, sortSegments, updateSegments, useActiveEpisode, useProject } from '@/store/project'
import { useUi } from '@/store/ui'
import { newSegment } from '@shared/defaults'
import { generateVoices, notify, translate } from '@/lib/pipeline'
import { CastPopover } from '@/features/cast/CastPopover'

function FindReplace({ epId }: { epId: string }) {
  const { t } = useTranslation()
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [field, setField] = useState<'textTarget' | 'textOriginal'>('textTarget')
  const segs = useActiveEpisode()?.segments ?? []
  const hits = find ? segs.filter((s) => s[field].includes(find)) : []

  return (
    <div className="flex w-80 flex-col gap-2">
      <Input autoFocus placeholder={t('find.find', 'Find')} value={find} onChange={(e) => setFind(e.target.value)} />
      <Input placeholder={t('find.replace', 'Replace with')} value={repl} onChange={(e) => setRepl(e.target.value)} />
      <Select
        value={field}
        onChange={(v) => setField(v as typeof field)}
        options={[
          { value: 'textTarget', label: t('find.inDub', 'In dub lines') },
          { value: 'textOriginal', label: t('find.inOrig', 'In original lines') }
        ]}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('find.matches', '{{n}} lines match', { n: hits.length })}</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!hits.length}
            onClick={() => useProject.setState({ selected: new Set(hits.map((h) => h.id)), focusId: hits[0]?.id ?? null })}
          >
            {t('find.select', 'Select')}
          </Button>
          <Button
            size="sm"
            disabled={!hits.length}
            onClick={() =>
              patchSegments(
                epId,
                hits.map((h) => h.id),
                (s) => ({ [field]: s[field].split(find).join(repl), ...(field === 'textTarget' ? { audioPath: undefined } : {}) })
              )
            }
          >
            {t('find.replaceAll', 'Replace all')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function GridToolbar({ filter, setFilter }: { filter: string; setFilter: (f: 'all' | 'warn' | 'untranslated' | 'novoice') => void }) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const project = useProject((s) => s.project)
  const selected = useProject((s) => s.selected)
  const focusId = useProject((s) => s.focusId)
  const time = useUi((s) => s.time)
  const [findOpen, setFindOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!ep || !project) return null
  const sel = [...selected]
  const warnCount = ep.segments.filter((s) => s.fitWarning).length

  const addLine = () => {
    const segs = sortSegments(ep.segments)
    const after = segs.filter((s) => s.start <= time).pop()
    const start = Math.max(time, after && after.end > time ? after.end : time)
    const next = segs.find((s) => s.start > start)
    const end = Math.min(start + 2, next ? next.start - 0.05 : start + 2, ep.durationSec || start + 2)
    const s = newSegment(start, Math.max(end, start + 0.3))
    updateSegments(ep.id, (x) => sortSegments([...x, s]))
    useProject.setState({ selected: new Set([s.id]), focusId: s.id })
    useUi.getState().set({ editingId: s.id })
  }

  const split = () => {
    const s = ep.segments.find((x) => x.id === focusId) ?? ep.segments.find((x) => time > x.start && time < x.end)
    if (!s) return
    const at = time > s.start + 0.1 && time < s.end - 0.1 ? time : (s.start + s.end) / 2
    const ratio = (at - s.start) / (s.end - s.start)
    const cut = (txt: string) => {
      const i = Math.round(txt.length * ratio)
      const sp = txt.lastIndexOf(' ', i)
      const k = sp > 0 ? sp : i
      return [txt.slice(0, k).trim(), txt.slice(k).trim()]
    }
    const [o1, o2] = cut(s.textOriginal)
    const [t1, t2] = cut(s.textTarget)
    const a = { ...s, end: Math.round(at * 100) / 100, textOriginal: o1, textTarget: t1, audioPath: undefined, words: s.words?.filter((w) => w.end <= at) }
    const b = { ...newSegment(at, s.end, o2, t2), actorId: s.actorId, voiceId: s.voiceId, words: s.words?.filter((w) => w.start >= at) }
    updateSegments(ep.id, (x) => sortSegments(x.flatMap((y) => (y.id === s.id ? [a, b] : [y]))))
  }

  const merge = () => {
    const pick = sortSegments(ep.segments.filter((s) => selected.has(s.id)))
    if (pick.length < 2) return
    const m = {
      ...pick[0],
      end: pick[pick.length - 1].end,
      textOriginal: pick.map((s) => s.textOriginal).join(' ').trim(),
      textTarget: pick.map((s) => s.textTarget).join(' ').trim(),
      audioPath: undefined,
      words: pick.flatMap((s) => s.words ?? [])
    }
    const drop = new Set(pick.slice(1).map((s) => s.id))
    updateSegments(ep.id, (x) => x.filter((s) => !drop.has(s.id)).map((s) => (s.id === m.id ? m : s)))
    useProject.setState({ selected: new Set([m.id]) })
  }

  const remove = () => {
    if (!sel.length) return
    updateSegments(ep.id, (x) => x.filter((s) => !selected.has(s.id)))
    useProject.setState({ selected: new Set() })
  }

  const setVoice = (v: string) => patchSegments(ep.id, sel, { voiceId: v, audioPath: undefined })

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
      <Button variant="ghost" size="sm" onClick={addLine} title={t('grid.add', 'Add line at playhead')}>
        <ListPlus /> {t('grid.addShort', 'Add')}
      </Button>
      <Button variant="ghost" size="sm" onClick={split} title={t('grid.split', 'Split line at playhead')}>
        <Scissors /> {t('grid.splitShort', 'Split')}
      </Button>
      <Button variant="ghost" size="sm" onClick={merge} disabled={sel.length < 2} title={t('grid.merge', 'Merge selected lines')}>
        <Combine />
      </Button>
      <Button variant="ghost" size="sm" onClick={remove} disabled={!sel.length} title={t('grid.delete', 'Delete selected (Del)')}>
        <Trash2 />
      </Button>
      <Popover open={findOpen} onOpenChange={setFindOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" title={t('grid.find', 'Find & Replace (Ctrl+F)')}>
            <Replace />
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <FindReplace epId={ep.id} />
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="sm" onClick={() => updateSegments(ep.id, sortSegments)} title={t('grid.sort', 'Sort by time')}>
        <ArrowDownUp />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />

      <DropdownMenu>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="sm" title={t('grid.series', 'Series / episodes')}>
            <Tv /> {ep.label}
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownLabel>{project.name}</DropdownLabel>
          {project.episodes.map((e) => (
            <DropdownItem key={e.id} onSelect={() => setActiveEpisode(e.id)}>
              <span className="w-10 font-mono">{e.label}</span>
              <span className="truncate text-xs text-muted-foreground">{e.media?.name ?? '—'}</span>
              <span className="ml-auto text-[10px] uppercase text-muted-foreground">{e.status}</span>
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem onSelect={addEpisode}>+ {t('grid.addEpisode', 'Add episode')}</DropdownItem>
        </DropdownContent>
      </DropdownMenu>
      <CastPopover />
      <div className="mx-1 h-5 w-px bg-border" />

      <span className="text-xs text-muted-foreground">{t('grid.setVoice', 'Set voice:')}</span>
      <Button variant="ghost" size="sm" disabled={!sel.length} onClick={() => setVoice('default:male')} title={t('grid.setMale', 'Selected lines → Default Male')}>
        <span className="text-base text-sky-500">♂</span>
      </Button>
      <Button variant="ghost" size="sm" disabled={!sel.length} onClick={() => setVoice('default:female')} title={t('grid.setFemale', 'Selected lines → Default Female')}>
        <span className="text-base text-pink-500">♀</span>
      </Button>
      <Button variant="ghost" size="sm" disabled={!sel.length} onClick={() => translate(ep.id, sel).catch(notify)} title={t('grid.translateSel', 'Translate selected')}>
        <Languages />
      </Button>
      <Button variant="ghost" size="sm" disabled={!sel.length} onClick={() => generateVoices(sel, ep.id).catch(notify)} title={t('grid.generateSel', 'Generate selected (Ctrl+Enter)')}>
        <Sparkles />
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" title={t('grid.glossary', 'Glossary (character names)')}>
            <BookA /> {project.glossary.length}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96">
          <Glossary />
        </PopoverContent>
      </Popover>

      <div className="flex-1" />
      <Select
        className="w-40"
        value={filter}
        onChange={(v) => setFilter(v as 'all')}
        options={[
          { value: 'all', label: t('grid.fAll', 'All lines ({{n}})', { n: ep.segments.length }) },
          { value: 'warn', label: t('grid.fWarn', '▲ Too fast ({{n}})', { n: warnCount }) },
          { value: 'untranslated', label: t('grid.fUntranslated', 'Untranslated') },
          { value: 'novoice', label: t('grid.fNoVoice', 'Not voiced yet') }
        ]}
      />
      {sel.length > 0 && <span className="whitespace-nowrap text-xs text-muted-foreground">{t('grid.selected', '{{n}} selected', { n: sel.length })}</span>}
    </div>
  )
}

function Glossary() {
  const { t } = useTranslation()
  const glossary = useProject((s) => s.project?.glossary ?? [])
  const set = (g: typeof glossary) => mutate((p) => ({ ...p, glossary: g }))
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">{t('glossary.title', 'Glossary — names stay consistent in every episode')}</div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {glossary.map((g, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input className="flex-1" value={g.source} onChange={(e) => set(glossary.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))} />
            <span className="text-muted-foreground">→</span>
            <Input className="flex-1 font-hanuman" value={g.target} onChange={(e) => set(glossary.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
            <button className="rounded p-1 hover:bg-accent" onClick={() => set(glossary.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => set([...glossary, { source: '', target: '' }])}>
        + {t('glossary.add', 'Add name')}
      </Button>
    </div>
  )
}

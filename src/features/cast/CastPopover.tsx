import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, Play, Plus, Trash2, Users, Wand2, Check } from 'lucide-react'
import type { Actor } from '@shared/types'
import { ACTOR_COLORS } from '@shared/defaults'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls'
import { mutate, useActiveEpisode, useProject, updateEpisode } from '@/store/project'
import { useSettings } from '@/store/settings'
import { useVoices } from '@/lib/hooks'
import { addActor, autoMatchCast, diarize, generateVoices, notify, refreshCastStats } from '@/lib/pipeline'
import { mediaUrl, post } from '@/lib/api'
import { cn } from '@/lib/utils'

const GENDERS: Actor['gender'][] = ['male', 'female', 'unknown']

export function CastPopover() {
  const { t } = useTranslation()
  const cast = useProject((s) => s.project?.cast ?? [])
  const ep = useActiveEpisode()
  const [voices] = useVoices()
  const [busy, setBusy] = useState<string | null>(null)

  const patch = (id: string, p: Partial<Actor>) => mutate((pr) => ({ ...pr, cast: pr.cast.map((a) => (a.id === id ? { ...a, ...p } : a)) }))

  const preview = async (a: Actor) => {
    const voiceId = a.voiceId ?? (a.gender === 'female' ? 'default:female' : 'default:male')
    setBusy(a.id)
    try {
      const s = useSettings.getState()
      const r = await post<{ path: string }>('/voices/preview', {
        voiceId,
        text: a.sampleText || 'សួស្តី! នេះគឺជាសំឡេងរបស់ខ្ញុំ។',
        defaultMale: s.defaultMale,
        defaultFemale: s.defaultFemale
      })
      new Audio(await mediaUrl(r.path)).play()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }

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

  // "Apply cast": clear per-line voice overrides so each line uses its actor's voice, then regenerate
  const applyCast = run('apply', async () => {
    if (!ep) return
    updateEpisode(ep.id, (e) => ({ ...e, segments: e.segments.map((s) => (s.actorId ? { ...s, voiceId: undefined, audioPath: undefined } : s)) }))
    toast.success(t('cast.applied', 'Cast applied — regenerating voices'))
    await generateVoices(undefined, ep.id)
  })

  return (
    <Popover onOpenChange={(o) => o && refreshCastStats()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title={t('cast.title', 'Cast')}>
          <Users /> {t('cast.short', 'Cast')} ({cast.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[640px] p-0">
        <div className="flex items-center gap-2 border-b p-3">
          <div className="text-sm font-medium">{t('cast.title', 'Cast')}</div>
          <span className="text-xs text-muted-foreground">{t('cast.hint', 'Shared across all episodes')}</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={run('diar', () => diarize())} disabled={!!busy || !ep?.segments.length} title={t('cast.detectHint', 'Detect speakers & gender offline')}>
            {busy === 'diar' ? <Loader2 className="animate-spin" /> : <Users />} {t('cast.detect', 'Detect speakers')}
          </Button>
          <Button size="sm" variant="outline" onClick={run('match', autoMatchCast)} disabled={!!busy || !cast.length}>
            <Wand2 /> {t('cast.autoMatch', 'Auto-match')}
          </Button>
          <Button size="sm" onClick={applyCast} disabled={!!busy || !cast.length}>
            {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Check />} {t('cast.apply', 'Apply cast')}
          </Button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {cast.length === 0 && <div className="p-4 text-sm text-muted-foreground">{t('cast.empty', 'No actors yet. Transcribe with speakers (Gemini) or click “Detect speakers”.')}</div>}
          {cast.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-0">
              <span className="grid size-7 shrink-0 place-items-center rounded font-mono text-xs font-bold text-white" style={{ background: ACTOR_COLORS[i % ACTOR_COLORS.length] }}>
                {i + 1}
              </span>
              <div className="flex w-40 shrink-0 flex-col">
                <input
                  className="h-6 rounded border border-transparent bg-transparent px-1 text-sm hover:border-input focus:border-input focus:outline-none"
                  value={a.name ?? a.label}
                  onChange={(e) => patch(a.id, { name: e.target.value })}
                />
                <span className="truncate px-1 text-[11px] text-muted-foreground" title={a.sampleText}>
                  {a.lines} {t('cast.lines', 'lines')} · {a.totalSec}s · {a.sampleText || '—'}
                </span>
              </div>
              <div className="flex shrink-0 overflow-hidden rounded-md border text-[11px]">
                {GENDERS.map((g) => (
                  <button
                    key={g}
                    onClick={() => patch(a.id, { gender: g })}
                    className={cn('px-2 py-1', a.gender === g ? (g === 'male' ? 'bg-sky-500 text-white' : g === 'female' ? 'bg-pink-500 text-white' : 'bg-secondary') : 'hover:bg-accent')}
                  >
                    {g === 'male' ? '♂' : g === 'female' ? '♀' : '?'}
                  </button>
                ))}
              </div>
              <select
                className="h-7 min-w-0 flex-1 rounded border bg-background px-1 text-xs"
                value={a.voiceId ?? ''}
                onChange={(e) => patch(a.id, { voiceId: e.target.value || undefined })}
              >
                <option value="">{a.gender === 'female' ? 'Default Female' : 'Default Male'}</option>
                {voices
                  .filter((v) => !v.id.startsWith('default:'))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.gender === 'female' ? '♀' : '♂'}
                    </option>
                  ))}
              </select>
              <button className="rounded p-1 hover:bg-accent" title={t('cast.preview', 'Preview voice')} onClick={() => preview(a)}>
                {busy === a.id ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              </button>
              <button
                className="rounded p-1 hover:bg-accent"
                title={t('cast.remove', 'Remove actor')}
                onClick={() =>
                  mutate((p) => ({
                    ...p,
                    cast: p.cast.filter((x) => x.id !== a.id),
                    episodes: p.episodes.map((e) => ({ ...e, segments: e.segments.map((s) => (s.actorId === a.id ? { ...s, actorId: undefined } : s)) }))
                  }))
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t p-2">
          <Button size="sm" variant="ghost" onClick={() => addActor('male')}>
            <Plus /> ♂
          </Button>
          <Button size="sm" variant="ghost" onClick={() => addActor('female')}>
            <Plus /> ♀
          </Button>
          <div className="flex-1" />
          {useProject.getState().selected.size > 0 && cast.length > 0 && (
            <select
              className="h-8 rounded border bg-background px-2 text-xs"
              value=""
              onChange={(e) => {
                const sel = useProject.getState().selected
                if (ep && e.target.value) updateEpisode(ep.id, (x) => ({ ...x, segments: x.segments.map((s) => (sel.has(s.id) ? { ...s, actorId: e.target.value, audioPath: undefined } : s)) }))
              }}
            >
              <option value="">{t('cast.assignSel', 'Assign selected lines to…')}</option>
              {cast.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} {a.name ? `· ${a.name}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

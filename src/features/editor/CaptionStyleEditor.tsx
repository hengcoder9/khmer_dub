import { useTranslation } from 'react-i18next'
import type { CaptionMode, CaptionStyle } from '@shared/types'
import { CAPTION_PRESETS } from '@shared/captions'
import { Select, Slider, Switch, Toggle } from '@/components/ui/controls'
import { mutate, useProject } from '@/store/project'
import { cn } from '@/lib/utils'
import { setBurnSubtitles } from '@/features/player/burn'

const FONTS = ['Kantumruy Pro', 'Hanuman', 'Khmer UI', 'Leelawadee UI', 'Arial', 'Segoe UI', 'Impact', 'Tahoma']

const PRESET_LABEL: Record<string, string> = {
  classic: 'Classic',
  boldYellow: 'Bold Yellow',
  karaoke: 'Karaoke',
  wordPop: 'Word Pop',
  boxed: 'Boxed',
  minimal: 'Minimal'
}

function Color({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />
      <span className="text-muted-foreground">{label}</span>
    </label>
  )
}

export function CaptionStyleEditor() {
  const { t } = useTranslation()
  const style = useProject((s) => s.project?.settings.captions)
  const burn = useProject((s) => s.project?.settings.burnSubtitles ?? false)
  if (!style) return null
  const set = (patch: Partial<CaptionStyle>, undo = false) =>
    mutate((p) => ({ ...p, settings: { ...p.settings, captions: { ...p.settings.captions, ...patch } } }), { undo })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Switch
          checked={burn}
          onChange={(v) => setBurnSubtitles(v, false)}
          label={<span className="text-sm font-medium">{t('cap.burn', 'Burn captions into the video')}</span>}
        />
        <Select
          className="w-40"
          value={style.source}
          onChange={(v) => set({ source: v as CaptionStyle['source'] })}
          options={[
            { value: 'target', label: t('cap.dubText', 'Dub language text') },
            { value: 'original', label: t('cap.origText', 'Original text') }
          ]}
        />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Object.entries(CAPTION_PRESETS).map(([id, p]) => (
          <button
            key={id}
            onClick={() => set({ ...p, preset: id }, true)}
            className={cn('flex h-14 flex-col items-center justify-center rounded-md border bg-neutral-800 text-xs', style.preset === id && 'ring-2 ring-primary')}
          >
            <span
              style={{
                color: p.mode === 'karaoke' ? p.highlight : p.primary,
                fontWeight: p.bold ? 700 : 500,
                textShadow: p.box ? undefined : `0 0 3px ${p.outlineColor}, 0 0 2px ${p.outlineColor}`,
                background: p.box ? '#000000bb' : undefined,
                padding: p.box ? '0 6px' : undefined,
                fontSize: Math.min(16, (p.size ?? 46) / 3.2)
              }}
            >
              {p.mode === 'word' ? 'សួស្តី' : 'សួស្តី Hello'}
            </span>
            <span className="mt-0.5 text-[10px] text-white/60">{PRESET_LABEL[id]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">{t('cap.mode', 'Animation')}:</span>
        {(
          [
            ['line', t('cap.line', 'Whole line')],
            ['karaoke', t('cap.karaoke', 'Karaoke highlight')],
            ['word', t('cap.word', 'Word by word')]
          ] as Array<[CaptionMode, string]>
        ).map(([m, label]) => (
          <Toggle key={m} on={style.mode === m} onClick={() => set({ mode: m }, true)}>
            {label}
          </Toggle>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select className="w-full" value={style.font} onChange={(v) => set({ font: v }, true)} options={FONTS.map((f) => ({ value: f, label: f }))} />
        <div className="flex items-center gap-1">
          {(['top', 'middle', 'bottom'] as const).map((p) => (
            <Toggle key={p} on={style.position === p} onClick={() => set({ position: p }, true)}>
              {p === 'top' ? t('cap.top', 'Top') : p === 'middle' ? t('cap.middle', 'Middle') : t('cap.bottom', 'Bottom')}
            </Toggle>
          ))}
        </div>
        <Slider label={t('cap.size', 'Size')} min={20} max={110} step={1} value={style.size} onChange={(v) => set({ size: v })} />
        <Slider label={t('cap.margin', 'Margin')} min={0} max={400} step={5} value={style.marginV} onChange={(v) => set({ marginV: v })} />
        <Slider label={t('cap.outline', 'Outline')} min={0} max={8} step={0.5} value={style.outline} onChange={(v) => set({ outline: v })} />
        <Slider label={t('cap.shadow', 'Shadow')} min={0} max={6} step={0.5} value={style.shadow} onChange={(v) => set({ shadow: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Color label={t('cap.text', 'Text')} value={style.primary} onChange={(v) => set({ primary: v })} />
        <Color label={t('cap.highlight', 'Highlight')} value={style.highlight} onChange={(v) => set({ highlight: v })} />
        <Color label={t('cap.outlineColor', 'Outline')} value={style.outlineColor} onChange={(v) => set({ outlineColor: v })} />
        <Switch checked={style.bold} onChange={(v) => set({ bold: v })} label={<span className="text-xs">{t('cap.bold', 'Bold')}</span>} />
        <Switch checked={style.box} onChange={(v) => set({ box: v })} label={<span className="text-xs">{t('cap.box', 'Box')}</span>} />
        {style.box && <Color label={t('cap.boxColor', 'Box')} value={style.boxColor} onChange={(v) => set({ boxColor: v })} />}
      </div>
      <p className="text-xs text-muted-foreground">{t('cap.previewHint', 'The player shows a live preview. Burned captions are rendered with libass using the bundled Khmer fonts.')}</p>
    </div>
  )
}

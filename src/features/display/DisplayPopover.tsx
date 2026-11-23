import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Laptop, Maximize2, Minus, Monitor, MonitorCog, Moon, Plus, RotateCcw, Sun, Tv, Wand2, type LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls'
import { ACCENTS, useSettings, type Accent, type Theme } from '@/store/settings'
import { cn } from '@/lib/utils'

interface Preset {
  id: string
  icon: LucideIcon
  title: string
  hint: string
  scale: number
  player: number
  tint: string
}

const PRESETS: Preset[] = [
  { id: 'laptop', icon: Laptop, title: '13″–15″ Laptop / Compact', hint: 'Compact UI & 340px preview — more room for subtitle lines', scale: 0.9, player: 340, tint: 'text-blue-500 bg-blue-500/10' },
  { id: 'standard', icon: Monitor, title: '24″–27″ Standard Monitor', hint: 'Default 100% studio scale & 440px preview for 1080p / 1440p', scale: 1, player: 440, tint: 'text-emerald-500 bg-emerald-500/10' },
  { id: 'qhd', icon: Tv, title: '32″ QHD / 4K Studio Display', hint: '112% UI scale & 500px video monitor — crisp, readable', scale: 1.12, player: 500, tint: 'text-violet-500 bg-violet-500/10' },
  { id: 'ultrawide', icon: Maximize2, title: '34″–49″ UltraWide / Curved', hint: '122% UI scale & 600px cinema monitor for 21:9', scale: 1.22, player: 600, tint: 'text-orange-500 bg-orange-500/10' },
  { id: 'xl', icon: Maximize2, title: 'XL Comfort / Distance View', hint: '130% large text & controls with 520px video monitor', scale: 1.3, player: 520, tint: 'text-rose-500 bg-rose-500/10' }
]

const ACCENT_SWATCH: Record<Accent, string> = {
  violet: 'from-violet-500 to-blue-500',
  teal: 'from-teal-500 to-sky-500',
  blue: 'from-blue-500 to-cyan-400',
  orange: 'from-orange-500 to-amber-400',
  rose: 'from-rose-500 to-fuchsia-500',
  emerald: 'from-emerald-500 to-lime-500'
}

/** Physical screen size in device pixels (independent of the current page zoom). */
function screenInfo() {
  const w = Math.round(screen.width * devicePixelRatio)
  const h = Math.round(screen.height * devicePixelRatio)
  const winScale = Math.round((devicePixelRatio / (useSettings.getState().uiScale || 1)) * 100)
  const ratio = w / h
  const shape = ratio > 2 ? '21:9 UltraWide' : ratio > 1.7 ? '16:9 Widescreen' : ratio > 1.5 ? '16:10' : '4:3'
  return { w, h, winScale, shape }
}

/** Pick the preset that fits this screen: logical width (after Windows scaling) decides. */
function autoPreset(): Preset {
  const { w, h, winScale } = screenInfo()
  const logical = w / (winScale / 100)
  if (w / h > 2.1) return PRESETS[3]
  if (logical <= 1600) return PRESETS[0]
  if (logical <= 2000) return PRESETS[1]
  return PRESETS[2]
}

function Stepper({ label, value, display, onChange, min, max, step }: { label: string; value: number; display: string; onChange: (v: number) => void; min: number; max: number; step: number }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="flex-1">{label}</span>
        <button className="grid size-5 place-items-center rounded border hover:bg-accent" onClick={() => onChange(clamp(value - step))}>
          <Minus className="size-3" />
        </button>
        <span className="w-12 text-center font-mono tabular-nums text-primary">{display}</span>
        <button className="grid size-5 place-items-center rounded border hover:bg-accent" onClick={() => onChange(clamp(value + step))}>
          <Plus className="size-3" />
        </button>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function DisplayPopover() {
  const { t } = useTranslation()
  const { uiScale, playerWidth, accent, theme, set, setTheme } = useSettings()
  const info = screenInfo()
  const active = PRESETS.find((p) => Math.abs(p.scale - uiScale) < 0.005 && p.player === playerWidth)

  const apply = (p: Preset) => set({ uiScale: p.scale, playerWidth: p.player, bigPlayer: false })
  const auto = () => {
    const p = autoPreset()
    apply(p)
    toast.success(t('display.autoDone', 'Auto-fitted for {{name}} ({{scale}}% UI · {{px}}px monitor)', { name: p.title, scale: Math.round(p.scale * 100), px: p.player }))
  }

  const themes: Array<[Theme, LucideIcon, string]> = [
    ['light', Sun, t('theme.light', 'Light')],
    ['dark', Moon, t('theme.dark', 'Dark')],
    ['system', Monitor, t('theme.system', 'System')]
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative grid size-8 place-items-center rounded-lg hover:bg-accent [&_svg]:size-4"
          title={t('display.title', 'Screen, display size & colours')}
        >
          <MonitorCog />
          {uiScale !== 1 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-brand px-1 text-[9px] font-bold leading-4 text-primary-foreground">{Math.round(uiScale * 100)}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] p-0">
        <div className="flex items-center gap-3 border-b p-3">
          <div className="grid size-9 place-items-center rounded-lg bg-brand text-primary-foreground">
            <MonitorCog className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t('display.heading', 'Screen & Display Size')}</div>
            <div className="text-[11px] text-muted-foreground">
              {t('display.detected', 'Detected')}: {info.w}×{info.h} ({info.winScale}% DPI) · {info.shape}
            </div>
          </div>
          <button onClick={auto} className="chip border-primary/40 bg-primary/10 text-primary hover:bg-primary/20">
            <Wand2 className="size-3" /> {t('display.auto', 'Auto-Fit')}
          </button>
        </div>

        <div className="flex flex-col gap-1.5 p-3">
          <div className="studio-label mb-0.5">{t('display.presets', 'Display size presets')}</div>
          {PRESETS.map((p) => {
            const on = active?.id === p.id
            return (
              <button
                key={p.id}
                onClick={() => apply(p)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                  on ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent'
                )}
              >
                <span className={cn('grid size-8 shrink-0 place-items-center rounded-md', p.tint)}>
                  <p.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{t(`display.p.${p.id}`, p.title)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{t(`display.h.${p.id}`, p.hint)}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{Math.round(p.scale * 100)}%</span>
                {on && <Check className="size-4 text-primary" />}
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 border-t p-3">
          <Stepper
            label={t('display.scale', 'UI text & button scale')}
            value={uiScale}
            display={`${Math.round(uiScale * 100)}%`}
            min={0.8}
            max={1.4}
            step={0.02}
            onChange={(v) => set({ uiScale: v })}
          />
          <Stepper
            label={t('display.player', 'Video monitor width')}
            value={playerWidth}
            display={`${playerWidth}px`}
            min={300}
            max={800}
            step={20}
            onChange={(v) => set({ playerWidth: v, bigPlayer: false })}
          />
        </div>

        <div className="flex flex-col gap-2 border-t p-3">
          <div className="studio-label">{t('display.look', 'Studio look')}</div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              {themes.map(([id, Icon, label]) => (
                <button
                  key={id}
                  title={label}
                  onClick={() => setTheme(id)}
                  className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-xs', theme === id ? 'bg-brand text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  title={a}
                  onClick={() => set({ accent: a })}
                  className={cn('size-5 rounded-full bg-gradient-to-br ring-offset-2 ring-offset-popover transition-transform hover:scale-110', ACCENT_SWATCH[a], accent === a && 'ring-2 ring-foreground/60')}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
          {t('display.saved', 'Saved automatically for this PC')}
          <button className="flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent hover:text-foreground" onClick={() => apply(PRESETS[1])}>
            <RotateCcw className="size-3" /> {t('display.reset', 'Reset 100%')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

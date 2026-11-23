import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Stamp, Trash2, Type } from 'lucide-react'
import type { Watermark, WatermarkAnimation } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Slider } from '@/components/ui/controls'
import { mutate, useProject } from '@/store/project'
import { mediaUrl, post } from '@/lib/api'
import { notify } from '@/lib/pipeline'
import { WatermarkLayer } from './WatermarkLayer'

export const WM_DEFAULT: Omit<Watermark, 'path'> = {
  position: 'tr',
  size: 0.15,
  opacity: 0.85,
  margin: 0.03,
  textColor: '#FFFFFF',
  textSize: 0.045,
  animation: 'none',
  every: 8
}

/** Your own logo and/or channel text on every exported video (and in the preview), optionally animated. */
export function WatermarkDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const wm = useProject((s) => s.project?.settings.watermark)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (wm?.path) void mediaUrl(wm.path).then((u) => alive && setUrl(u))
    else setUrl(null)
    return () => {
      alive = false
    }
  }, [wm?.path])

  const set = (patch: Partial<Watermark> | null) =>
    mutate((p) => {
      if (patch === null) return { ...p, settings: { ...p.settings, watermark: undefined } }
      const next = { ...WM_DEFAULT, path: '', ...p.settings.watermark, ...patch } as Watermark
      // nothing left to show → no watermark at all
      const empty = !next.path && !next.text?.trim()
      return { ...p, settings: { ...p.settings, watermark: empty ? undefined : next } }
    })

  const pick = async () => {
    const path = await window.api.openFile({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (!path) return
    try {
      await post('/media/probe', { path }) // lets the preview load the image
      set({ path })
    } catch (e) {
      notify(e)
    }
  }

  const ANIMS: Array<[WatermarkAnimation, string, string]> = [
    ['none', t('wm.anNone', 'None'), t('wm.anNoneHint', 'Stays in place')],
    ['pulse', t('wm.anPulse', 'Pulse'), t('wm.anPulseHint', 'Fades softly in and out')],
    ['corners', t('wm.anCorners', 'Corners'), t('wm.anCornersHint', 'Jumps to the next corner — hard to crop out when re-uploaded')],
    ['scroll', t('wm.anScroll', 'Scroll'), t('wm.anScrollHint', 'Slides across the screen like a news ticker')],
    ['float', t('wm.anFloat', 'Float'), t('wm.anFloatHint', 'Drifts gently around its corner')]
  ]
  const anim = wm?.animation ?? 'none'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[640px] overflow-y-auto p-6">
        <DialogTitle className="flex items-center gap-2">
          <Stamp className="size-5 text-primary" /> {t('wm.title', 'Watermark')}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('wm.desc2', 'Your logo and/or channel name on every exported video, with an optional animation. A PNG with a transparent background looks best.')}
        </DialogDescription>
        <div className="flex flex-col gap-4">
          {/* live preview */}
          <div className="relative mx-auto aspect-[9/16] h-56 overflow-hidden rounded-md border bg-gradient-to-b from-slate-600 to-slate-900">
            {wm && <WatermarkLayer wm={wm} imageUrl={url} heightPx={224} />}
            {!wm && <div className="grid h-full place-items-center text-xs text-white/60">{t('wm.previewEmpty', 'Add a logo or text')}</div>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* logo */}
            <div className="flex items-center gap-3">
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-[repeating-conic-gradient(#8883_0_25%,transparent_0_50%)] bg-[length:12px_12px]">
                {url ? <img src={url} className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-5 text-muted-foreground" />}
              </div>
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" onClick={pick}>
                  <ImagePlus /> {wm?.path ? t('wm.change', 'Change image') : t('wm.choose', 'Choose image')}
                </Button>
                {wm?.path && (
                  <Button variant="ghost" size="sm" onClick={() => set({ path: '' })}>
                    <Trash2 /> {t('wm.removeLogo', 'Remove logo')}
                  </Button>
                )}
              </div>
            </div>
            {/* text */}
            <div className="flex flex-col gap-1">
              <Field label={<span className="flex items-center gap-1"><Type className="size-3.5" /> {t('wm.text', 'Text')}</span>}>
                <Input
                  className="font-hanuman"
                  placeholder={t('wm.textPh', 'e.g. @MyChannel or ខ្មែរឌឹប')}
                  defaultValue={wm?.text ?? ''}
                  onBlur={(e) => set({ text: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && set({ text: (e.target as HTMLInputElement).value })}
                />
              </Field>
              {wm?.text?.trim() && (
                <div className="flex items-center gap-2">
                  <input type="color" value={wm.textColor ?? '#FFFFFF'} onChange={(e) => set({ textColor: e.target.value.toUpperCase() })} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />
                  <Slider className="flex-1" label={t('wm.textSize', 'Text size')} min={0.02} max={0.1} step={0.005} value={wm.textSize ?? 0.045} onChange={(v) => set({ textSize: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
                </div>
              )}
            </div>
          </div>

          {wm && (
            <>
              <Field label={t('wm.animation', 'Animation')} hint={ANIMS.find((a) => a[0] === anim)?.[2]}>
                <div className="flex flex-wrap gap-1">
                  {ANIMS.map(([id, label]) => (
                    <Button key={id} size="sm" variant={anim === id ? 'secondary' : 'ghost'} className={anim === id ? 'ring-1 ring-primary/50' : ''} onClick={() => set({ animation: id })}>
                      {label}
                    </Button>
                  ))}
                </div>
              </Field>
              {anim !== 'none' && (
                <Slider label={t('wm.every', 'Speed (seconds per cycle)')} min={2} max={30} step={1} value={wm.every ?? 8} onChange={(v) => set({ every: v })} format={(v) => `${v} s`} />
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label={anim === 'scroll' ? t('wm.row', 'Row') : t('wm.position', 'Position')}>
                  <Select
                    className="w-full"
                    value={wm.position}
                    onChange={(v) => set({ position: v as Watermark['position'] })}
                    options={[
                      { value: 'tl', label: t('wm.tl', 'Top left') },
                      { value: 'tr', label: t('wm.tr', 'Top right') },
                      { value: 'bl', label: t('wm.bl', 'Bottom left') },
                      { value: 'br', label: t('wm.br', 'Bottom right') },
                      { value: 'center', label: t('wm.center', 'Center') }
                    ]}
                  />
                </Field>
                {wm.path && <Slider label={t('wm.size', 'Logo size')} min={0.05} max={0.4} step={0.01} value={wm.size} onChange={(v) => set({ size: v })} format={(v) => `${Math.round(v * 100)}%`} />}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Slider label={t('wm.opacity', 'Opacity')} min={0.1} max={1} step={0.05} value={wm.opacity} onChange={(v) => set({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label={t('wm.margin', 'Margin')} min={0} max={0.1} step={0.005} value={wm.margin} onChange={(v) => set({ margin: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
              </div>
            </>
          )}
        </div>
        <div className="mt-5 flex justify-between">
          {wm ? (
            <Button variant="ghost" onClick={() => set(null)}>
              <Trash2 /> {t('wm.remove', 'Remove watermark')}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

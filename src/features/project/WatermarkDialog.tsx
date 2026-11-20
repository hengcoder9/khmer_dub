import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Stamp, Trash2 } from 'lucide-react'
import type { Watermark } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Select, Slider } from '@/components/ui/controls'
import { mutate, useProject } from '@/store/project'
import { mediaUrl, post } from '@/lib/api'
import { notify } from '@/lib/pipeline'

export const WM_DEFAULT: Omit<Watermark, 'path'> = { position: 'tr', size: 0.15, opacity: 0.85, margin: 0.03 }

/** Your own logo / channel badge on every exported video (and in the preview). */
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
    mutate((p) => ({
      ...p,
      settings: { ...p.settings, watermark: patch === null ? undefined : ({ ...WM_DEFAULT, ...p.settings.watermark, ...patch } as Watermark) }
    }))

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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[560px] p-6">
        <DialogTitle className="flex items-center gap-2">
          <Stamp className="size-5 text-primary" /> {t('wm.title', 'Watermark')}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('wm.desc', 'Your logo or channel badge on every exported video. A PNG with a transparent background looks best.')}
        </DialogDescription>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-[repeating-conic-gradient(#8883_0_25%,transparent_0_50%)] bg-[length:12px_12px]">
              {url ? <img src={url} className="max-h-full max-w-full object-contain" /> : <Stamp className="size-6 text-muted-foreground" />}
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" onClick={pick}>
                <ImagePlus /> {wm ? t('wm.change', 'Change image') : t('wm.choose', 'Choose image')}
              </Button>
              {wm && (
                <Button variant="ghost" size="sm" onClick={() => set(null)}>
                  <Trash2 /> {t('wm.remove', 'Remove watermark')}
                </Button>
              )}
            </div>
          </div>
          {wm && (
            <>
              <Field label={t('wm.position', 'Position')}>
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
              <Slider label={t('wm.size', 'Size')} min={0.05} max={0.4} step={0.01} value={wm.size} onChange={(v) => set({ size: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label={t('wm.opacity', 'Opacity')} min={0.1} max={1} step={0.05} value={wm.opacity} onChange={(v) => set({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
              <Slider label={t('wm.margin', 'Margin')} min={0} max={0.1} step={0.005} value={wm.margin} onChange={(v) => set({ margin: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

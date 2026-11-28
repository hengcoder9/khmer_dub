import { useTranslation } from 'react-i18next'
import { Clapperboard, Film, ImagePlus, Megaphone, Trash2 } from 'lucide-react'
import type { AdBanner, AdsSettings, AdVideo, MediaInfo } from '@shared/types'
import { uid } from '@shared/defaults'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Select, Slider, Switch } from '@/components/ui/controls'
import { mutate, useProject } from '@/store/project'
import { post } from '@/lib/api'
import { notify } from '@/lib/pipeline'
import { cn } from '@/lib/utils'
import { BannerLayer, useBannerUrl } from './BannerLayer'

const EMPTY: AdsSettings = { videos: [], banners: [] }
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p
const fmtSec = (s?: number) => (s ? (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`) : '—')

export const BANNER_DEFAULT: Omit<AdBanner, 'id' | 'path'> = {
  position: 'bottom',
  size: 0.9,
  margin: 0.03,
  opacity: 1,
  show: 'interval',
  everyMin: 3,
  forSec: 10,
  startSec: 5,
  enabled: true
}

/** Video ads (start / end / every N minutes) and banner ads, inserted into every export of this project. */
export function AdsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const ads = useProject((s) => s.project?.settings.ads) ?? EMPTY

  const save = (next: AdsSettings) =>
    mutate((p) => ({ ...p, settings: { ...p.settings, ads: next.videos.length || next.banners.length ? next : undefined } }))
  const setVideo = (id: string, patch: Partial<AdVideo>) => save({ ...ads, videos: ads.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)) })
  const setBanner = (id: string, patch: Partial<AdBanner>) => save({ ...ads, banners: ads.banners.map((b) => (b.id === id ? { ...b, ...patch } : b)) })

  const addVideo = async () => {
    const path = await window.api.openFile({ filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }] })
    if (!path) return
    try {
      const info = await post<MediaInfo>('/media/probe', { path })
      if (!info.video) throw new Error(t('ads.noVideo', 'This file has no video picture'))
      const at: AdVideo['at'] = ads.videos.some((v) => v.at === 'start') ? 'end' : 'start'
      save({ ...ads, videos: [...ads.videos, { id: uid(), path, name: fileName(path), at, everyMin: 5, durationSec: info.durationSec, enabled: true }] })
    } catch (e) {
      notify(e)
    }
  }
  const addBanner = async () => {
    const path = await window.api.openFile({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    if (!path) return
    try {
      await post('/media/probe', { path })
      save({ ...ads, banners: [...ads.banners, { id: uid(), path, name: fileName(path), ...BANNER_DEFAULT }] })
    } catch (e) {
      notify(e)
    }
  }

  const adSec = ads.videos.filter((v) => v.enabled && v.at !== 'every').reduce((a, v) => a + (v.durationSec ?? 0), 0)

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] w-[760px] overflow-y-auto p-6">
        <DialogTitle className="flex items-center gap-2">
          <Megaphone className="size-5 text-primary" /> {t('ads.title', 'Ads in the video')}
        </DialogTitle>
        <DialogDescription className="mb-2 text-sm text-muted-foreground">
          {t('ads.desc', 'Put your own video ads and banner ads into every export of this project. When you split into episodes, every part gets them.')}
        </DialogDescription>

        {/* video ads */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Clapperboard className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">{t('ads.videos', 'Video ads')}</h3>
            <span className="text-xs text-muted-foreground">{t('ads.videosHint', 'A clip that plays before, between or after your video')}</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={addVideo}>
              <Film /> {t('ads.addVideo', 'Add video ad')}
            </Button>
          </div>
          {!ads.videos.length && <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{t('ads.noVideos', 'No video ads yet. Add an MP4 — e.g. a 5-second promo for your Telegram channel.')}</div>}
          {ads.videos.map((v) => (
            <div key={v.id} className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-2.5', !v.enabled && 'opacity-60')}>
              <Switch checked={v.enabled} onChange={(on) => setVideo(v.id, { enabled: on })} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={v.path}>{v.name || fileName(v.path)}</div>
                <div className="text-[11px] text-muted-foreground">{fmtSec(v.durationSec)}</div>
              </div>
              <Select
                value={v.at}
                onChange={(x) => setVideo(v.id, { at: x as AdVideo['at'] })}
                options={[
                  { value: 'start', label: t('ads.atStart', 'At the start') },
                  { value: 'every', label: t('ads.atEvery', 'Every few minutes') },
                  { value: 'end', label: t('ads.atEnd', 'At the end') }
                ]}
              />
              {v.at === 'every' && (
                <Select
                  value={String(v.everyMin ?? 5)}
                  onChange={(x) => setVideo(v.id, { everyMin: Number(x) })}
                  options={[1, 2, 3, 5, 8, 10, 15, 20].map((m) => ({ value: String(m), label: t('ads.everyMin', 'every {{m}} min', { m }) }))}
                />
              )}
              <Button size="icon" variant="ghost" className="size-8" onClick={() => save({ ...ads, videos: ads.videos.filter((x) => x.id !== v.id) })}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {adSec > 0 && <p className="text-[11px] text-muted-foreground">{t('ads.adds', 'Adds about {{s}} to each video (or each part), plus the "every few minutes" ads.', { s: fmtSec(adSec) })}</p>}
        </section>

        <hr className="my-3" />

        {/* banner ads */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ImagePlus className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">{t('ads.banners', 'Banner ads')}</h3>
            <span className="text-xs text-muted-foreground">{t('ads.bannersHint', 'An image on top of the video (PNG with transparency works best)')}</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={addBanner}>
              <ImagePlus /> {t('ads.addBanner', 'Add banner')}
            </Button>
          </div>
          {!ads.banners.length && <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{t('ads.noBanners', 'No banners yet. Add a PNG, JPG, WebP or animated GIF.')}</div>}
          {ads.banners.map((b) => (
            <BannerRow key={b.id} b={b} set={(patch) => setBanner(b.id, patch)} remove={() => save({ ...ads, banners: ads.banners.filter((x) => x.id !== b.id) })} />
          ))}
        </section>

        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BannerRow({ b, set, remove }: { b: AdBanner; set: (p: Partial<AdBanner>) => void; remove: () => void }) {
  const { t } = useTranslation()
  const url = useBannerUrl(b.path)
  return (
    <div className={cn('grid grid-cols-[120px_1fr] gap-3 rounded-lg border p-2.5', !b.enabled && 'opacity-60')}>
      {/* small 16:9 preview */}
      <div className="relative aspect-video overflow-hidden rounded-md bg-gradient-to-b from-slate-600 to-slate-900">
        <BannerLayer banners={[{ ...b, enabled: true }]} time={0} always />
        {!url && <div className="absolute inset-0 grid place-items-center text-[10px] text-white/60">…</div>}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Switch checked={b.enabled} onChange={(on) => set({ enabled: on })} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={b.path}>{b.name || fileName(b.path)}</span>
          <Button size="icon" variant="ghost" className="size-8" onClick={remove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label={t('wm.position', 'Position')}>
            <Select
              className="w-full"
              value={b.position}
              onChange={(v) => set({ position: v as AdBanner['position'] })}
              options={[
                { value: 'top', label: t('ads.posTop', 'Top') },
                { value: 'bottom', label: t('ads.posBottom', 'Bottom') },
                { value: 'center', label: t('ads.posCenter', 'Center') },
                { value: 'tl', label: t('ads.posTl', 'Top left') },
                { value: 'tr', label: t('ads.posTr', 'Top right') },
                { value: 'bl', label: t('ads.posBl', 'Bottom left') },
                { value: 'br', label: t('ads.posBr', 'Bottom right') }
              ]}
            />
          </Field>
          <Field label={t('ads.show', 'Show')}>
            <Select
              className="w-full"
              value={b.show}
              onChange={(v) => set({ show: v as AdBanner['show'] })}
              options={[
                { value: 'interval', label: t('ads.showInterval', 'Now and then') },
                { value: 'always', label: t('ads.showAlways', 'All the time') }
              ]}
            />
          </Field>
          {b.show === 'interval' ? (
            <Field label={t('ads.schedule', 'Schedule')}>
              <div className="flex gap-1">
                <Select className="flex-1" value={String(b.forSec)} onChange={(v) => set({ forSec: Number(v) })} options={[5, 8, 10, 15, 20, 30].map((s) => ({ value: String(s), label: `${s} s` }))} />
                <Select className="flex-1" value={String(b.everyMin)} onChange={(v) => set({ everyMin: Number(v) })} options={[1, 2, 3, 5, 10].map((m) => ({ value: String(m), label: t('ads.everyMin', 'every {{m}} min', { m }) }))} />
              </div>
            </Field>
          ) : (
            <div />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Slider label={t('wm.size', 'Size')} min={0.1} max={1} step={0.01} value={b.size} onChange={(v) => set({ size: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label={t('wm.opacity', 'Opacity')} min={0.2} max={1} step={0.05} value={b.opacity} onChange={(v) => set({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
      </div>
    </div>
  )
}

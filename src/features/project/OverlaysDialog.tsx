import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ImagePlus, Layers, Loader2, Smile, Trash2, Type } from 'lucide-react'
import { uid } from '@shared/defaults'
import { TEXT_STYLES, TEXT_STYLE_IDS, textCss, type Overlay, type OverlayAnim, type TextStyleId } from '@shared/overlays'
import { STICKER_ART, svgDataUrl, type StickerArt } from '@shared/stickerArt'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Slider } from '@/components/ui/controls'
import { updateEpisode, useActiveEpisode, useProject } from '@/store/project'
import { playerApi, useUi } from '@/store/ui'
import { post } from '@/lib/api'
import { notify } from '@/lib/pipeline'
import { cn, formatTime } from '@/lib/utils'

const fmt = (s: number) => formatTime(s).slice(s >= 3600 ? 0 : 3, 10)
export type OverlayTab = 'stickers' | 'text' | 'list'

/** Built-in sticker → PNG file in the project's "stickers" folder (the export overlays files). */
async function rasterize(art: StickerArt, dir: string): Promise<string> {
  const img = new Image()
  img.src = svgDataUrl(art.svg)
  await img.decode()
  const scale = 3
  const c = document.createElement('canvas')
  c.width = art.w * scale
  c.height = art.h * scale
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return (await post<{ path: string }>('/projects/sticker', { dir, name: art.id, dataUrl: c.toDataURL('image/png') })).path
}

/** Stickers and styled text on the video: pick, then drag them on the player. */
export function OverlaysDialog({ onClose, initialTab = 'stickers' }: { onClose: () => void; initialTab?: OverlayTab }) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const dir = useProject((s) => s.dir)
  const [tab, setTab] = useState<OverlayTab>(initialTab)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  if (!ep) return null
  const list = ep.overlays ?? []
  const now = () => useUi.getState().time
  const save = (next: Overlay[]) => updateEpisode(ep.id, (e) => ({ ...e, overlays: next }))
  const patch = (id: string, p: Partial<Overlay>) => save(list.map((o) => (o.id === id ? ({ ...o, ...p } as Overlay) : o)))
  const place = (o: Overlay) => {
    save([...list, o])
    toast.success(t('ov.added', 'Added at {{time}} — drag it on the video to move, pull the corner to resize', { time: fmt(o.start) }))
  }
  const base = () => {
    const start = Math.round(now() * 100) / 100
    return { id: uid(), start, end: Math.round((start + 3) * 100) / 100, anim: 'pop' as OverlayAnim, opacity: 1 }
  }

  const addArt = async (art: StickerArt) => {
    if (!dir) return toast.error(t('ov.saveFirst', 'Save the project first'))
    setBusy(art.id)
    try {
      const path = await rasterize(art, dir)
      place({ ...base(), kind: 'sticker', path, name: art.name, x: 0.5, y: 0.35, w: Math.min(0.45, 0.18 * (art.w / Math.max(art.w, art.h)) * 1.6) })
    } catch (e) {
      notify(e)
    } finally {
      setBusy(null)
    }
  }
  const addOwn = async () => {
    const path = await window.api.openFile({ filters: [{ name: 'Sticker', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg', 'mp4', 'webm', 'mov'] }] })
    if (!path) return
    try {
      await post('/media/probe', { path })
      place({ ...base(), kind: 'sticker', path, name: path.split(/[\\/]/).pop()!, x: 0.5, y: 0.4, w: 0.25 })
    } catch (e) {
      notify(e)
    }
  }
  const addText = (style: TextStyleId) => {
    const value = text.trim() || t('ov.sample', 'Your text')
    place({ ...base(), kind: 'text', text: value, style, x: 0.5, y: 0.2, size: 0.08 })
  }

  const groups: Array<[StickerArt['group'], string]> = [
    ['arrows', t('ov.gArrows', 'Arrows & highlights')],
    ['social', t('ov.gSocial', 'Subscribe / Like / Follow')],
    ['shapes', t('ov.gShapes', 'Shapes')],
    ['bubbles', t('ov.gBubbles', 'Bubbles')],
    ['labels', t('ov.gLabels', 'Labels')]
  ]
  const anims: Array<[OverlayAnim, string]> = [
    ['none', t('ov.aNone', 'None')],
    ['fade', t('ov.aFade', 'Fade')],
    ['pop', t('ov.aPop', 'Pop')],
    ['float', t('ov.aFloat', 'Float')]
  ]

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] w-[760px] overflow-y-auto p-6">
        <DialogTitle className="flex items-center gap-2">
          <Layers className="size-5 text-primary" /> {t('ov.title', 'Stickers & text')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('ov.desc', 'New items appear at the playhead ({{time}}) for 3 seconds. Close this window and drag them on the video to place them.', { time: fmt(now()) })}
        </DialogDescription>
        <div className="mt-2 flex gap-4 border-b">
          {(
            [
              ['stickers', Smile, t('ov.tStickers', 'Stickers')],
              ['text', Type, t('ov.tText', 'Text styles')],
              ['list', Layers, t('ov.tList', 'On this episode ({{n}})', { n: list.length })]
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setTab(id)} className={cn('-mb-px flex h-9 items-center gap-1.5 border-b-2 text-sm', tab === id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {tab === 'stickers' && (
          <div className="flex flex-col gap-3 pt-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={addOwn}>
                <ImagePlus /> {t('ov.own', 'Your sticker (PNG / GIF / video)…')}
              </Button>
            </div>
            {groups.map(([g, label]) => (
              <div key={g} className="flex flex-col gap-1.5">
                <div className="studio-label">{label}</div>
                <div className="grid grid-cols-6 gap-2">
                  {STICKER_ART.filter((a) => a.group === g).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => addArt(a)}
                      disabled={!!busy}
                      title={a.name}
                      className="relative grid aspect-square place-items-center rounded-xl border bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:14px_14px] p-2 transition hover:-translate-y-0.5 hover:border-primary/60"
                    >
                      <img src={svgDataUrl(a.svg)} className="max-h-full max-w-full" draggable={false} />
                      {busy === a.id && <Loader2 className="absolute size-5 animate-spin text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'text' && (
          <div className="flex flex-col gap-3 pt-3">
            <Input className="font-hanuman text-base" placeholder={t('ov.textPh', 'Type your text (Khmer or English)…')} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="grid grid-cols-4 gap-2">
              {TEXT_STYLE_IDS.map((id) => (
                <button key={id} onClick={() => addText(id)} className="flex flex-col items-center gap-1 overflow-hidden rounded-xl border bg-neutral-800 p-3 transition hover:-translate-y-0.5 hover:border-primary/60" title={TEXT_STYLES[id].name}>
                  <span className="max-w-full truncate font-hanuman" style={textCss(TEXT_STYLES[id], 22) as React.CSSProperties}>
                    {text.trim() || 'ART ក'}
                  </span>
                  <span className="text-[10px] text-neutral-400">{t(`ov.s.${id}`, TEXT_STYLES[id].name)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'list' && (
          <div className="flex flex-col gap-1.5 pt-3">
            {!list.length && <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{t('ov.empty', 'Nothing yet — add a sticker or text.')}</div>}
            {[...list].sort((a, b) => a.start - b.start).map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
                {o.kind === 'sticker' ? <Smile className="size-4 text-primary" /> : <Type className="size-4 text-primary" />}
                {o.kind === 'text' ? (
                  <input className="h-7 w-40 rounded border bg-background px-1.5 text-sm font-hanuman" value={o.text} onChange={(e) => patch(o.id, { text: e.target.value })} />
                ) : (
                  <span className="w-40 truncate text-sm" title={o.path}>{o.name}</span>
                )}
                <button className="font-mono text-xs text-primary hover:underline" onClick={() => playerApi()?.seek(o.start)} title={t('ov.jump', 'Go there')}>
                  {fmt(o.start)}–{fmt(o.end)}
                </button>
                <button className="rounded px-1.5 py-0.5 text-[11px] hover:bg-accent" onClick={() => patch(o.id, { start: Math.min(now(), o.end - 0.2) })}>{t('ov.startHere', 'Start here')}</button>
                <button className="rounded px-1.5 py-0.5 text-[11px] hover:bg-accent" onClick={() => patch(o.id, { end: Math.max(now(), o.start + 0.2) })}>{t('ov.endHere', 'End here')}</button>
                <select className="h-7 rounded border bg-background px-1 text-xs" value={String(Math.round((o.end - o.start) * 10) / 10)} onChange={(e) => patch(o.id, { end: o.start + Number(e.target.value) })}>
                  {[1, 2, 3, 5, 8, 10, 15, 30, 60].map((d) => (
                    <option key={d} value={d}>{d} s</option>
                  ))}
                  {![1, 2, 3, 5, 8, 10, 15, 30, 60].includes(Math.round((o.end - o.start) * 10) / 10) && <option value={String(Math.round((o.end - o.start) * 10) / 10)}>{(o.end - o.start).toFixed(1)} s</option>}
                </select>
                <select className="h-7 rounded border bg-background px-1 text-xs" value={o.anim} onChange={(e) => patch(o.id, { anim: e.target.value as OverlayAnim })}>
                  {anims.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                {o.kind === 'text' && (
                  <select className="h-7 rounded border bg-background px-1 text-xs" value={o.style} onChange={(e) => patch(o.id, { style: e.target.value as TextStyleId })}>
                    {TEXT_STYLE_IDS.map((id) => (
                      <option key={id} value={id}>{t(`ov.s.${id}`, TEXT_STYLES[id].name)}</option>
                    ))}
                  </select>
                )}
                <Slider className="w-24" label="" min={0.2} max={1} step={0.05} value={o.opacity} onChange={(v) => patch(o.id, { opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <div className="flex-1" />
                <button className="rounded p-1 hover:bg-accent" onClick={() => save(list.filter((x) => x.id !== o.id))} title={t('ov.remove', 'Remove')}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

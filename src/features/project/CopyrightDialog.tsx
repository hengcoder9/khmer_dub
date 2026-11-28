import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import type { CopyrightFix, CopyrightReport, Level, Platform } from '@shared/copyright'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { mutate } from '@/store/project'
import { useUi } from '@/store/ui'
import { copyrightCheck, importBgm, notify } from '@/lib/pipeline'
import { cn } from '@/lib/utils'

const PLATFORM: Record<Platform, { name: string; color: string }> = {
  youtube: { name: 'YouTube', color: '#FF0033' },
  facebook: { name: 'Facebook', color: '#1877F2' },
  tiktok: { name: 'TikTok', color: '#FE2C55' }
}
const LEVEL_STYLE: Record<Level, string> = {
  low: 'border-success/40 bg-success/10 text-success',
  medium: 'border-warning/40 bg-warning/10 text-warning',
  high: 'border-destructive/40 bg-destructive/10 text-destructive'
}

/** Before posting: is anything in this export likely to be claimed, muted or blocked? */
export function CopyrightDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const setUi = useUi((s) => s.set)
  const [report, setReport] = useState<CopyrightReport | null>(null)
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    try {
      setReport(await copyrightCheck())
    } catch (e) {
      notify(e)
    } finally {
      setBusy(false)
    }
  }
  const levelText = (l: Level) => (l === 'high' ? t('cr.high', 'High risk') : l === 'medium' ? t('cr.medium', 'Some risk') : t('cr.low', 'Low risk'))
  const fix = async (f: CopyrightFix) => {
    if (f === 'muteOriginal') mutate((p) => ({ ...p, settings: { ...p.settings, muteOriginal: true } }))
    if (f === 'stopAutoOriginal') mutate((p) => ({ ...p, settings: { ...p.settings, autoOriginal: false } }))
    if (f === 'flip') mutate((p) => ({ ...p, settings: { ...p.settings, flip: { h: true } } }))
    if (f === 'addBgm') await importBgm().catch(notify)
    if (f === 'source') return setUi({ dialog: 'source' })
    toast.success(t('cr.fixed', 'Done — check again to see the new result'))
  }
  const fixLabel: Record<CopyrightFix, string> = {
    muteOriginal: t('cr.fMute', 'Mute the original audio'),
    stopAutoOriginal: t('cr.fAuto', 'No original sound between lines'),
    addBgm: t('cr.fBgm', 'Add your own music'),
    source: t('cr.fSource', 'Add the licence'),
    flip: t('cr.fFlip', 'Flip the picture')
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] w-[700px] overflow-y-auto p-6">
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" /> {t('cr.title', 'Copyright check')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('cr.desc', 'Before posting to YouTube, Facebook or TikTok: the AI listens for songs and soundtracks in the source, and the check looks at what your export will really contain.')}
        </DialogDescription>

        <div className="mt-3 flex items-center gap-3 rounded-xl border bg-card p-4">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{report ? t('cr.again', 'Check again after changes') : t('cr.start', 'Check this episode')}</div>
            <div className="text-xs text-muted-foreground">{t('cr.startHint', 'Takes about half a minute. Uses your Gemini key to listen.')}</div>
          </div>
          <Button onClick={check} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t('cr.check', 'Check')}
          </Button>
        </div>

        {report && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(Object.keys(PLATFORM) as Platform[]).map((p) => (
                <div key={p} className={cn('flex flex-col items-center gap-1 rounded-xl border p-3', LEVEL_STYLE[report.platforms[p]])}>
                  <span className="text-sm font-bold" style={{ color: PLATFORM[p].color }}>{PLATFORM[p].name}</span>
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    {report.platforms[p] === 'low' ? <CheckCircle2 className="size-4" /> : report.platforms[p] === 'medium' ? <AlertTriangle className="size-4" /> : <XCircle className="size-4" />}
                    {levelText(report.platforms[p])}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {report.items.map((i) => (
                <div key={i.id} className="flex gap-3 rounded-lg border p-3">
                  <span className={cn('mt-0.5 size-2.5 shrink-0 rounded-full', i.level === 'high' ? 'bg-destructive' : i.level === 'medium' ? 'bg-warning' : 'bg-success')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{i.title}</div>
                    <div className="text-xs text-muted-foreground">{i.detail}</div>
                  </div>
                  {i.fix && (
                    <Button size="sm" variant="outline" className="shrink-0 self-center" onClick={() => fix(i.fix!)}>
                      {fixLabel[i.fix]}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-semibold text-foreground">{t('cr.officialTitle', "The platforms' own checks (free)")}</div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>{t('cr.yt', 'YouTube: upload as Private first — YouTube Studio shows copyright “Checks” before you publish.')}</li>
            <li>{t('cr.fb', 'Facebook: after uploading (not yet published), copyright warnings show in the post / Meta Business Suite.')}</li>
            <li>{t('cr.tt', 'TikTok: sounds it cannot license are muted when you post; use the Commercial Music Library for business accounts.')}</li>
          </ul>
          <div className="mt-1.5">{t('cr.note', 'This check estimates the risk; it is not the platforms’ decision.')}</div>
          <a className="mt-1 inline-flex items-center gap-1 text-primary hover:underline" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
            YouTube Studio <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.done', 'Done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

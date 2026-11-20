import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, ShieldCheck } from 'lucide-react'
import type { ProjectSource } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/controls'
import { mutate, useProject } from '@/store/project'
import { importLink, notify } from '@/lib/pipeline'

/** Paste a link to a video you own or are licensed to dub (direct file, Google Drive, Dropbox). */
export function LinkDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!url.trim()) return
    setBusy(true)
    try {
      await importLink(url.trim())
      onClose()
    } catch (e) {
      notify(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="w-[560px] p-6">
        <DialogTitle>{t('link.title', 'Import from link')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t(
            'link.desc',
            'A video you own or are licensed to dub: a direct link to a video file, or a Google Drive / Dropbox share link. Streaming and VIP services (iQIYI, WeTV, Tencent, Hongguo, DramaBox, GoodShort…) are not supported.'
          )}
        </DialogDescription>
        <Field label={t('link.url', 'Link')}>
          <Input autoFocus placeholder="https://drive.google.com/file/d/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={go} disabled={busy || !url.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} {t('link.download', 'Download & add episode')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Where the episodes come from and the permission to dub them; saved with the project and next to every export. */
export function SourceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const cur = useProject((s) => s.project?.source)
  const [v, setV] = useState<ProjectSource>({ origin: cur?.origin ?? '', licence: cur?.licence ?? '', notes: cur?.notes ?? '' })
  const save = () => {
    const empty = !v.origin.trim() && !v.licence.trim() && !v.notes?.trim()
    mutate((p) => ({ ...p, source: empty ? undefined : { origin: v.origin.trim(), licence: v.licence.trim(), notes: v.notes?.trim() || undefined } }))
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[560px] p-6">
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" /> {t('source.title', 'Source & licence')}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('source.desc', 'Keep a record of where these episodes come from and your permission to dub them. It is saved as SOURCE.txt next to every export.')}
        </DialogDescription>
        <div className="flex flex-col gap-3">
          <Field label={t('source.origin', 'Source')}>
            <Input placeholder={t('source.originPh', 'e.g. Distributor / rights holder, original title')} value={v.origin} onChange={(e) => setV({ ...v, origin: e.target.value })} />
          </Field>
          <Field label={t('source.licence', 'Licence / permission')}>
            <Input placeholder={t('source.licencePh', 'e.g. Khmer dubbing licence #123, valid until 2027-12-31')} value={v.licence} onChange={(e) => setV({ ...v, licence: e.target.value })} />
          </Field>
          <Field label={t('source.notes', 'Notes')}>
            <textarea
              className="min-h-20 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={v.notes ?? ''}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={save}>{t('common.save', 'Save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

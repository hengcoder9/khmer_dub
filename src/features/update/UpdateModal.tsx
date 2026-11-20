import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import type { UpdateInfo } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/controls'

export function UpdateModal() {
  const { t } = useTranslation()
  const [u, setU] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => window.api.update.onStatus(setU), [])
  // Dismissal is per version+stage: closing during "available"/"downloading" hides it until the update is "ready".
  const stage = (s: UpdateInfo['state']) => (s === 'ready' ? 'ready' : 'pending')
  const key = u ? `${u.version ?? ''}:${stage(u.state)}` : ''
  const open = !!u && ['available', 'downloading', 'ready'].includes(u.state) && dismissed !== key
  if (!u) return null
  const dismiss = () => setDismissed(key)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="w-[520px] p-6">
        <DialogTitle>{t('update.title', 'Update available')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">
          {u.current} → <b className="text-foreground">{u.version}</b>
        </DialogDescription>
        {u.notes && <pre className="mb-4 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{u.notes}</pre>}
        {u.state === 'downloading' && <Progress value={u.percent ?? 0} className="mb-4" />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            {u.state === 'downloading' ? t('update.background', 'Hide (keep downloading)') : t('update.later', 'Maybe later')}
          </Button>
          {u.state === 'available' && (
            <Button onClick={() => window.api.update.download()}>
              <Download /> {t('update.download', 'Download & Install')}
            </Button>
          )}
          {u.state === 'downloading' && (
            <Button disabled>
              <Loader2 className="animate-spin" /> {u.percent ?? 0}%
            </Button>
          )}
          {u.state === 'ready' && (
            <Button onClick={() => window.api.update.install()}>
              <RefreshCw /> {t('update.restart', 'Restart to update')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

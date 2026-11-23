import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AccountPanel } from './AccountPanel'
import { ContactLinks } from './ContactLinks'

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[min(980px,96vw)] flex-col overflow-hidden p-0">
        <div className="border-b px-6 py-4 pr-12">
          <DialogTitle className="text-lg font-bold tracking-tight">{t('acct.title', 'Account & subscription')}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{t('acct.desc', 'Sign in to use the AI tools. Pick a plan when your free trial ends.')}</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <AccountPanel />
        </div>
        <div className="border-t bg-card/50 px-6 py-3">
          <ContactLinks compact />
        </div>
      </DialogContent>
    </Dialog>
  )
}

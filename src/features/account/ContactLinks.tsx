import { useTranslation } from 'react-i18next'
import { Headset, Megaphone, Send } from 'lucide-react'
import { CONTACT } from '@shared/types'

/** Where to find the Telegram channel and the admin for support / payment help. */
export function ContactLinks({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const items = [
    { href: CONTACT.channel, icon: Megaphone, title: t('contact.channel', 'Telegram channel'), sub: t('contact.channelSub', 'News, updates and tips') },
    { href: CONTACT.support, icon: Headset, title: t('contact.support', 'Admin support'), sub: t('contact.supportSub', 'Help with your account or payment') }
  ]
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'grid gap-2 sm:grid-cols-2'}>
      {items.map(({ href, icon: Icon, title, sub }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={href}
          className="studio-card group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:border-primary/50 hover:bg-accent/40"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#229ed9]/15 text-[#229ed9]">
            <Icon className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">{title}</span>
            {!compact && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
          </span>
          <Send className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
        </a>
      ))}
    </div>
  )
}

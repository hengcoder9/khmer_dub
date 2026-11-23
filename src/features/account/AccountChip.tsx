import { useTranslation } from 'react-i18next'
import { Crown, Gift, Lock, UserRound } from 'lucide-react'
import { daysLeft, hasAccess, useAccount } from '@/store/account'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'

/** Top-bar badge: who is signed in and how much plan time is left. */
export function AccountChip() {
  const { t } = useTranslation()
  const { loaded, signedIn, user, access } = useAccount()
  const setUi = useUi((s) => s.set)
  if (!loaded) return null
  const ok = hasAccess()
  const d = daysLeft(access)
  const open = () => setUi({ dialog: 'account' })

  if (!signedIn || !user)
    return (
      <button onClick={open} className="flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/30 hover:brightness-110">
        <UserRound className="size-3.5" /> {t('acct.signInTrial', 'Sign in · free trial')}
      </button>
    )
  const Icon = access?.kind === 'lifetime' || access?.kind === 'paid' ? Crown : access?.kind === 'trial' ? Gift : Lock
  const label =
    access?.kind === 'lifetime'
      ? t('acct.chipLifetime', 'Lifetime')
      : ok && access?.kind === 'paid'
        ? `PRO · ${d}d`
        : ok && access?.kind === 'trial'
          ? t('acct.chipTrial', 'Trial · {{d}}d', { d })
          : t('acct.chipUpgrade', 'Upgrade')
  return (
    <button
      onClick={open}
      title={`${user.name} · ${user.email}`}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-semibold',
        !ok ? 'border-destructive/40 bg-destructive/10 text-destructive' : access?.kind === 'trial' || (d !== null && d <= 3) ? 'border-warning/40 bg-warning/10 text-warning' : 'border-primary/40 bg-primary/10 text-primary'
      )}
    >
      <span className="grid size-7 place-items-center rounded-full bg-brand text-[11px] font-bold text-primary-foreground">{(user.name || user.email).slice(0, 2).toUpperCase()}</span>
      <Icon className="size-3.5" /> {label}
    </button>
  )
}

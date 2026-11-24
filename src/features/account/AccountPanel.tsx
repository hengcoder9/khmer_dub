import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { ArrowLeft, ArrowUp, BadgeCheck, CheckCircle2, Clock, Copy, Crown, ExternalLink, Gift, History, KeyRound, Loader2, LogOut, Mail, Server, ShieldCheck, Sparkles, Ticket, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/controls'
import { acct, daysLeft, formatPrice, hasAccess, loadPlans, register, setServer, signIn, signOut, useAccount, type Plan } from '@/store/account'
import { cn } from '@/lib/utils'
import { khqrInfo } from '@/lib/khqr'
import { APP_NAME } from '@shared/types'
import { KhqrCard } from './KhqrCard'

const merchantFallback = APP_NAME

interface Order {
  id: number
  ref: string
  amount: number
  currency: 'USD' | 'KHR'
  status: 'pending' | 'paid' | 'expired' | 'canceled' | 'failed'
  provider: string
  qr: string | null
  qrImage: string | null
  payUrl: string | null
  expiresAt: string
  createdAt: string
}

const utc = (d: string) => new Date(d.replace(' ', 'T') + 'Z')
const money = (n: number, c: string) => (c === 'KHR' ? `${Math.round(n).toLocaleString()} ៛` : `$${n.toFixed(2)}`)

// ───────────────── signed out ─────────────────

function AuthForm() {
  const { t } = useTranslation()
  const trialDays = useAccount((s) => s.trialDays)
  const server = useAccount((s) => s.server)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [adv, setAdv] = useState(false)
  const [srv, setSrv] = useState(server)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      if (mode === 'in') await signIn(email, pw)
      else await register(email, pw, name)
      toast.success(mode === 'in' ? t('acct.welcomeBack', 'Signed in') : t('acct.welcomeNew', 'Account created — your free trial has started'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-[1fr_1.1fr] overflow-hidden rounded-2xl border">
      <div className="relative flex flex-col justify-between gap-6 bg-brand p-7 text-primary-foreground">
        <div>
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-white/20 backdrop-blur">
            <Crown className="size-6" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight">{t('acct.heroTitle', 'KhmerDub Studio Pro')}</h3>
          <p className="mt-2 text-sm text-white/80">{t('acct.heroText', 'AI transcription, translation, neural Khmer voices, batch dubbing and export — in one studio.')}</p>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {[
            t('acct.f1', '{{n}}-day free trial, no payment needed', { n: trialDays }),
            t('acct.f2', '1, 3, 6 months, 1 year or lifetime'),
            t('acct.f3', 'Pay with KHQR — ABA, ACLEDA, Wing, Bakong')
          ].map((x) => (
            <li key={x} className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" /> {x}
            </li>
          ))}
        </ul>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3 p-7">
        <div className="flex rounded-lg bg-muted p-0.5">
          {(['in', 'up'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => (setMode(m), setErr(''))}
              className={cn('flex-1 rounded-md py-1.5 text-sm font-medium', mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground')}
            >
              {m === 'in' ? t('acct.signIn', 'Sign in') : t('acct.signUp', 'Create account')}
            </button>
          ))}
        </div>
        {mode === 'up' && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('acct.name', 'Name')}
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('acct.namePh', 'Your name')} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('acct.email', 'Email')}
          <Input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('acct.password', 'Password')}
          <Input type="password" required minLength={mode === 'up' ? 8 : 1} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        <Button disabled={busy} className="mt-1">
          {busy && <Loader2 className="animate-spin" />}
          {mode === 'in' ? t('acct.signIn', 'Sign in') : t('acct.startTrial', 'Create account & start free trial')}
        </Button>
        <button type="button" className="mt-auto flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setAdv(!adv)}>
          <Server className="size-3" /> {t('acct.server', 'Account server')}
        </button>
        {adv && (
          <div className="flex gap-1">
            <Input className="flex-1 font-mono text-xs" value={srv} onChange={(e) => setSrv(e.target.value)} />
            <Button type="button" variant="outline" size="sm" onClick={() => setServer(srv).then(() => toast.success(t('acct.serverSaved', 'Server saved'))).catch((e: Error) => toast.error(e.message))}>
              {t('common.save', 'Save')}
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}

// ───────────────── checkout ─────────────────

function Checkout({ plan, onBack }: { plan: Plan; onBack: () => void }) {
  const { t } = useTranslation()
  const support = useAccount((s) => s.support)
  const [order, setOrder] = useState<Order | null>(null)
  const [instructions, setInstructions] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now())

  const isAdmin = useAccount((s) => s.user?.role === 'admin')

  // one order per checkout — React dev mode runs effects twice, which created two orders at once
  const created = useRef<Promise<{ order: Order; instructions: string }> | null>(null)
  useEffect(() => {
    let alive = true
    created.current ??= acct<{ order: Order; instructions: string }>('pay/create', { planId: plan.id })
    created.current
      .then((r) => {
        if (!alive) return
        setOrder(r.order)
        setInstructions(r.instructions)
      })
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [plan.id])

  useEffect(() => {
    if (!order) return
    if (order.qr) QRCode.toDataURL(order.qr, { margin: 0, width: 420, errorCorrectionLevel: 'H' }).then(setQr)
    else setQr(order.qrImage)
  }, [order?.qr, order?.qrImage])

  // hosted ABA checkout (no QR in the app): open it in the browser once, the app keeps polling
  const checkoutOnly = !!order && !order.qr && !order.qrImage && !!order.payUrl
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (checkoutOnly && order?.status === 'pending' && !opened) {
      setOpened(true)
      window.api.account.openPayUrl(order.payUrl!)
    }
  }, [checkoutOnly, order?.status])

  // poll until paid / expired
  useEffect(() => {
    if (!order || order.status !== 'pending') return
    const id = setInterval(async () => {
      setNow(Date.now())
      try {
        const r = await acct<{ status: Order['status']; order: Order }>(`pay/status?id=${order.id}`)
        if (r.status !== 'pending') {
          setOrder(r.order)
          if (r.status === 'paid') toast.success(t('acct.paid', 'Payment received — {{plan}} is active!', { plan: plan.name }))
        }
      } catch {
        /* keep polling */
      }
    }, 4000)
    return () => clearInterval(id)
  }, [order?.id, order?.status])

  const cancel = async () => {
    if (order?.status === 'pending') await acct('pay/cancel', { id: order.id }).catch(() => {})
    onBack()
  }
  const left = order ? Math.max(0, utc(order.expiresAt).getTime() - now) : 0
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('acct.copied', 'Copied')))

  return (
    <div className="flex flex-col gap-4">
      <button className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground" onClick={order?.status === 'paid' ? onBack : cancel}>
        <ArrowLeft className="size-4" /> {t('acct.backPlans', 'Back to plans')}
      </button>
      {err && <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{err}</div>}
      {!order && !err && (
        <div className="grid h-64 place-items-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      )}
      {order?.status === 'paid' && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-10 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-success/15 text-success">
            <BadgeCheck className="size-9" />
          </div>
          <h3 className="text-xl font-bold">{t('acct.thanks', 'Thank you! {{plan}} is active', { plan: plan.name })}</h3>
          <Button onClick={onBack}>{t('acct.done', 'Done')}</Button>
        </div>
      )}
      {order && order.status !== 'paid' && (
        <div className="grid grid-cols-[300px_1fr] gap-5">
          <KhqrCard
            qr={qr}
            merchant={khqrInfo(order.qr).merchant ?? merchantFallback}
            amount={order.amount}
            currency={order.currency}
            expiresAt={utc(order.expiresAt).getTime()}
            createdAt={utc(order.createdAt).getTime()}
          >
            {checkoutOnly ? (
              <div className="flex flex-col items-center justify-center gap-3 px-2 text-center text-sm text-slate-600">
                <ExternalLink className="size-10 text-[#005d7f]" />
                {t('acct.checkoutHint', 'The ABA payment page opened in your browser. Scan its KHQR or tap "Open in ABA Mobile".')}
                <button className="rounded-lg bg-[#005d7f] px-4 py-2 font-semibold text-white hover:brightness-110" onClick={() => window.api.account.openPayUrl(order.payUrl!)}>
                  {t('acct.openAba', 'Open ABA payment page')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 px-1 text-center text-sm text-slate-600">
                <div className="grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-600">
                  <Clock className="size-7" />
                </div>
                {isAdmin ? (
                  <>
                    <b className="text-slate-800">{t('acct.noQrAdminTitle', 'Payments are not set up yet')}</b>
                    <span className="text-xs">{t('acct.noQrAdmin', 'Add your AnajakPay secret key (automatic KHQR), or upload your shop KHQR image (manual), in Admin → Settings.')}</span>
                    <button className="rounded-lg bg-[#e1232e] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110" onClick={() => window.api.account.openAdmin()}>
                      {t('acct.openSettings', 'Open Admin → Settings')}
                    </button>
                  </>
                ) : (
                  <>
                    <b className="text-slate-800">{t('acct.noQrTitle', 'QR payment is not available right now')}</b>
                    <span className="text-xs">
                      {support
                        ? t('acct.noQrSupport', 'Send your order reference to {{who}} to pay — or use a license code.', { who: support })
                        : t('acct.noQrCode', 'Please contact the seller with your order reference, or redeem a license code.')}
                    </span>
                  </>
                )}
              </div>
            )}
          </KhqrCard>
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold">{plan.name}</span>
              <span className="text-sm text-muted-foreground">{money(order.amount, order.currency)}</span>
            </div>
            <div>
              <div className="studio-label">{t('acct.orderRef', 'Order reference')}</div>
              <button className="mt-1 flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 font-mono text-lg font-bold tracking-wider hover:bg-accent" onClick={() => copy(order.ref)}>
                {order.ref} <Copy className="size-4 text-muted-foreground" />
              </button>
            </div>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              <li>{t('acct.step1', 'Open ABA, ACLEDA, Wing or any Bakong app and scan the KHQR.')}</li>
              <li>{t('acct.step2', 'Pay exactly {{amount}}.', { amount: money(order.amount, order.currency) })}</li>
              {order.provider === 'manual' && <li>{t('acct.step3', 'Write the order reference {{ref}} in the transfer note.', { ref: order.ref })}</li>}
              <li>{order.provider === 'manual' ? t('acct.step4m', 'Your plan turns on as soon as we confirm the payment.') : t('acct.step4a', 'Your plan turns on automatically within seconds.')}</li>
            </ol>
            {instructions && order.provider === 'manual' && <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">{instructions}</p>}
            {order.payUrl && !checkoutOnly && (
              <Button variant="outline" onClick={() => window.api.account.openPayUrl(order.payUrl!)}>
                <ExternalLink /> {t('acct.openPay', 'Open payment page')}
              </Button>
            )}
            <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', order.status === 'pending' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-destructive/30 bg-destructive/5 text-destructive')}>
              {order.status === 'pending' ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />}
              {order.status === 'pending'
                ? t('acct.waiting', 'Waiting for payment… ({{time}} left)', { time: left > 3600_000 ? `${Math.floor(left / 3600_000)}h` : `${Math.ceil(left / 60_000)} min` })
                : t('acct.orderEnded', 'This order is {{status}}. Go back and choose a plan again.', { status: order.status })}
            </div>
            {support && (
              <p className="text-xs text-muted-foreground">
                {t('acct.help', 'Need help? Contact')} <span className="select-text font-medium text-foreground">{support}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────── signed in ─────────────────

function AccessCard() {
  const { t } = useTranslation()
  const a = useAccount((s) => s.access)
  const offline = useAccount((s) => s.offline)
  const d = daysLeft(a)
  const ok = hasAccess()
  const trialDays = useAccount((s) => s.trialDays)
  // bar: trial progress, or the last 30 days of a plan
  const total = a?.kind === 'trial' ? Math.max(1, trialDays) : 30
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border p-5', a?.kind === 'lifetime' || a?.kind === 'paid' ? 'bg-brand text-primary-foreground' : ok ? 'bg-warning/10' : 'bg-destructive/10')}>
      <div className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-white/20">{a?.kind === 'lifetime' ? <Crown className="size-6" /> : a?.kind === 'trial' ? <Gift className="size-6" /> : <ShieldCheck className="size-6" />}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider opacity-80">{t('acct.currentPlan', 'Current plan')}</div>
          <div className="text-xl font-bold">
            {a?.kind === 'lifetime' ? t('acct.lifetime', 'Lifetime — never expires') : ok ? a?.plan : t('acct.noPlan', 'No active plan')}
          </div>
          <div className="text-sm opacity-80">
            {a?.kind === 'lifetime'
              ? t('acct.lifetimeHint', 'All AI tools unlocked forever.')
              : ok && a?.endsAt
                ? t('acct.until', '{{d}} days left · until {{date}}', { d, date: utc(a.endsAt).toLocaleDateString() })
                : t('acct.expired', 'Choose a plan below to unlock transcription, translation, voices and export.')}
          </div>
        </div>
        {offline && <span className="chip border-current/30 text-[10px]">{t('acct.offline', 'offline — using saved status')}</span>}
      </div>
      {ok && d !== null && (a?.kind === 'trial' || d <= 30) && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${Math.min(100, (100 * d) / Math.max(total, d))}%` }} />
        </div>
      )}
    </div>
  )
}

function PlanGrid({ onBuy }: { onBuy: (p: Plan) => void }) {
  const { t } = useTranslation()
  const plans = useAccount((s) => s.plans)
  const currency = useAccount((s) => s.currency)
  const a = useAccount((s) => s.access)
  if (!plans.length)
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        {t('acct.noPlans', 'Plans could not be loaded.')}{' '}
        <button className="text-primary hover:underline" onClick={() => loadPlans().catch((e: Error) => toast.error(e.message))}>
          {t('acct.retry', 'Retry')}
        </button>
      </div>
    )
  const monthly = plans.find((p) => p.months === 1)
  const paid = hasAccess() && (a?.kind === 'paid' || a?.kind === 'lifetime')
  const current = paid ? plans.find((p) => (a?.kind === 'lifetime' ? p.months === null : p.code === a?.planCode)) : undefined
  // how long a plan lasts, for comparing (lifetime = longest)
  const span = (p: Plan) => (p.months === null ? Infinity : p.months)
  return (
    <div className="grid grid-cols-5 gap-2">
      {plans.map((p) => {
        const isCurrent = !!current && p.id === current.id
        const upgrade = !!current && !isCurrent && span(p) > span(current)
        const included = a?.kind === 'lifetime' && !isCurrent // lifetime already covers every plan
        const featured = !current && (p.code === '6m' || p.badge === 'Popular')
        const per = p.months ? (currency === 'KHR' ? p.priceKhr : p.priceUsd) / p.months : null
        const base = monthly ? (currency === 'KHR' ? monthly.priceKhr : monthly.priceUsd) : null
        const save = per && base && p.months! > 1 ? Math.round(100 * (1 - per / base)) : 0
        const badge = isCurrent ? t('acct.active', 'Active') : p.badge
        return (
          <div
            key={p.id}
            className={cn(
              'relative flex flex-col gap-2 rounded-2xl border bg-card p-4',
              featured && 'border-primary/60 shadow-lg shadow-primary/10 ring-1 ring-primary/40',
              isCurrent && 'border-success/60 bg-success/5 shadow-lg shadow-success/10 ring-1 ring-success/50',
              included && 'opacity-60'
            )}
          >
            {badge && (
              <span
                className={cn(
                  'absolute -top-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold',
                  isCurrent ? 'bg-success text-white' : featured ? 'bg-brand text-primary-foreground' : 'border bg-card text-primary'
                )}
              >
                {isCurrent && <CheckCircle2 className="size-3" />}
                {badge}
              </span>
            )}
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="text-2xl font-bold tracking-tight">{formatPrice(p, currency)}</div>
            <div className="min-h-8 text-[11px] text-muted-foreground">
              {isCurrent && a?.kind === 'paid' && a.endsAt ? (
                <span className="font-medium text-success">{t('acct.activeUntil', 'Your plan · until {{date}}', { date: utc(a.endsAt).toLocaleDateString() })}</span>
              ) : isCurrent ? (
                <span className="font-medium text-success">{t('acct.activeForever', 'Your plan · never expires')}</span>
              ) : p.months === null ? (
                t('acct.once', 'one payment, forever')
              ) : p.months > 1 && per ? (
                `${currency === 'KHR' ? `${Math.round(per).toLocaleString()} ៛` : `$${per.toFixed(2)}`}/${t('acct.mo', 'mo')}${save > 0 ? ` · ${t('acct.save', 'save')} ${save}%` : ''}`
              ) : (
                t('acct.monthly', 'billed monthly')
              )}
            </div>
            <Button
              size="sm"
              className={cn('mt-auto', isCurrent && a?.kind === 'paid' && 'bg-success text-white hover:bg-success/90')}
              variant={isCurrent || upgrade || featured ? 'default' : 'outline'}
              disabled={included || (isCurrent && a?.kind === 'lifetime')}
              onClick={() => onBuy(p)}
            >
              {isCurrent && a?.kind === 'lifetime' ? (
                t('acct.owned', 'Owned')
              ) : included ? (
                t('acct.included', 'Included')
              ) : isCurrent ? (
                t('acct.renew', 'Renew')
              ) : upgrade ? (
                <>
                  <ArrowUp /> {t('acct.upgrade', 'Upgrade')}
                </>
              ) : current ? (
                t('acct.extend', 'Extend')
              ) : (
                t('acct.buy', 'Buy')
              )}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function Redeem() {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const r = await acct<{ plan: string }>('redeem', { code })
      toast.success(t('acct.redeemed', '{{plan}} added to your account', { plan: r.plan }))
      setCode('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border p-3">
      <Ticket className="size-4 text-primary" />
      <span className="text-sm font-medium">{t('acct.haveCode', 'Have a license code?')}</span>
      <Input className="flex-1 font-mono uppercase" placeholder="KD-6M-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && go()} />
      <Button size="sm" onClick={go} disabled={!code || busy}>
        {busy && <Loader2 className="animate-spin" />} {t('acct.redeem', 'Redeem')}
      </Button>
    </div>
  )
}

function HistoryList() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<Order[] | null>(null)
  useEffect(() => {
    acct<{ orders: Order[] }>('me/history').then((r) => setOrders(r.orders)).catch(() => setOrders([]))
  }, [])
  if (!orders) return <Loader2 className="size-4 animate-spin" />
  if (!orders.length) return <div className="text-sm text-muted-foreground">{t('acct.noOrders', 'No payments yet.')}</div>
  return (
    <div className="divide-y rounded-xl border text-sm">
      {orders.map((o) => (
        <div key={o.id} className="flex items-center gap-3 px-3 py-2">
          <span className="font-mono text-xs">{o.ref}</span>
          <span className="font-medium">{money(o.amount, o.currency)}</span>
          <span className={cn('chip', o.status === 'paid' ? 'border-success/40 text-success' : o.status === 'pending' ? 'border-warning/40 text-warning' : 'text-muted-foreground')}>{o.status}</span>
          <span className="ml-auto text-xs text-muted-foreground">{utc(o.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const save = () =>
    acct('auth/password', { current: cur, password: pw })
      .then(() => {
        toast.success(t('acct.pwChanged', 'Password changed — other devices were signed out'))
        onDone()
      })
      .catch((e: Error) => toast.error(e.message))
  return (
    <div className="flex items-end gap-2 rounded-xl border p-3">
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
        {t('acct.curPw', 'Current password')}
        <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
        {t('acct.newPw', 'New password (min 8)')}
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <Button size="sm" onClick={save} disabled={!cur || pw.length < 8}>
        {t('common.save', 'Save')}
      </Button>
    </div>
  )
}

export function AccountPanel() {
  const { t } = useTranslation()
  const { loaded, signedIn, user } = useAccount()
  const [buying, setBuying] = useState<Plan | null>(null)
  const [tab, setTab] = useState<'plans' | 'history' | 'security'>('plans')

  if (!loaded)
    return (
      <div className="grid h-60 place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  if (!signedIn || !user) return <AuthForm />
  if (buying) return <Checkout plan={buying} onBack={() => setBuying(null)} />

  const initials = (user.name || user.email).slice(0, 2).toUpperCase()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full bg-brand text-lg font-bold text-primary-foreground">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold">
            {user.name}
            {user.role === 'admin' && <span className="chip border-primary/40 bg-primary/10 text-[10px] text-primary">Admin</span>}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Mail className="size-3" /> {user.email}
          </div>
        </div>
        {user.role === 'admin' && (
          <Button variant="outline" size="sm" onClick={() => window.api.account.openAdmin()}>
            <UserRound /> {t('acct.admin', 'Admin panel')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => signOut().then(() => toast.info(t('acct.signedOut', 'Signed out')))}>
          <LogOut /> {t('acct.signOut', 'Sign out')}
        </Button>
      </div>

      <AccessCard />

      <div className="flex items-center gap-1 border-b">
        {(
          [
            ['plans', Sparkles, t('acct.tPlans', 'Plans')],
            ['history', History, t('acct.tHistory', 'Payments')],
            ['security', KeyRound, t('acct.tSecurity', 'Password')]
          ] as const
        ).map(([id, Icon, label]) => (
          <button key={id} onClick={() => setTab(id)} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm', tab === id ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <>
          <PlanGrid onBuy={setBuying} />
          <Redeem />
        </>
      )}
      {tab === 'history' && <HistoryList />}
      {tab === 'security' && <PasswordForm onDone={() => setTab('plans')} />}
    </div>
  )
}

import { create } from 'zustand'
import type { AccountAccess, AccountResult, AccountState, AccountUser } from '@shared/types'

export interface Plan {
  id: number
  code: string
  name: string
  months: number | null
  priceUsd: number
  priceKhr: number
  badge: string | null
}

interface AccountStore extends AccountState {
  loaded: boolean
  /** last refresh could not reach the server (cached access is used) */
  offline: boolean
  plans: Plan[]
  currency: 'USD' | 'KHR'
  support: string
  trialDays: number
  /** sign-in methods the server has set up */
  auth: { email: boolean; google: boolean; telegram: boolean }
}

export type SocialProvider = 'google' | 'telegram'

export const useAccount = create<AccountStore>()(() => ({
  loaded: false,
  offline: false,
  server: '',
  signedIn: false,
  user: null,
  access: null,
  checkedAt: 0,
  plans: [],
  currency: 'USD',
  support: '',
  trialDays: 3,
  auth: { email: true, google: false, telegram: false }
}))

const utc = (d: string) => Date.parse(d.replace(' ', 'T') + 'Z')

/** Can this PC run AI jobs right now? Uses the cached plan end date, so it also works offline until then. */
export function hasAccess(s: Pick<AccountState, 'signedIn' | 'access'> = useAccount.getState()): boolean {
  const a = s.access
  if (!s.signedIn || !a) return false
  if (a.kind === 'lifetime') return true
  if (a.kind === 'none' || !a.endsAt) return false
  return utc(a.endsAt) > Date.now()
}

export function daysLeft(a: AccountAccess | null): number | null {
  if (!a || a.kind === 'lifetime' || !a.endsAt) return null
  return Math.max(0, Math.ceil((utc(a.endsAt) - Date.now()) / 86_400_000))
}

/** Call the account server through main (which holds the token). Throws with the server's message. */
export async function acct<T>(path: string, body?: unknown): Promise<T> {
  const r = (await window.api.account.call<T>(path, body)) as AccountResult<T>
  if (r.ok) {
    const d = r.data as { user?: AccountUser; access?: AccountAccess }
    if (d && d.user && d.access) useAccount.setState({ user: d.user, access: d.access, signedIn: true, checkedAt: Date.now(), offline: false })
    return r.data
  }
  if (r.signedOut) useAccount.setState({ signedIn: false, user: null, access: null })
  if (r.offline) useAccount.setState({ offline: true })
  throw new Error(r.error)
}

export async function loadAccount() {
  const s = await window.api.account.state()
  useAccount.setState({ ...s, loaded: true })
  if (s.signedIn) await acct('me').catch(() => {})
  loadPlans().catch(() => {})
}

export async function loadPlans() {
  const r = await acct<{ plans: Plan[]; currency: 'USD' | 'KHR'; support: string; trialDays: number; auth?: AccountStore['auth'] }>('plans')
  useAccount.setState({ plans: r.plans, currency: r.currency, support: r.support ?? '', trialDays: r.trialDays ?? 3, auth: r.auth ?? { email: true, google: false, telegram: false } })
}

export async function signIn(email: string, password: string) {
  await acct('auth/login', { email, password })
}

export async function register(email: string, password: string, name: string) {
  await acct('auth/register', { email, password, name })
}

/**
 * Google / Telegram: the server gives a one-time link, the browser does the sign-in, the app polls until the
 * server has verified it (then main stores the session like a normal sign-in). `reopen` opens the link again.
 */
export async function socialSignIn(provider: SocialProvider, signal: AbortSignal, onLink?: (reopen: () => void) => void): Promise<void> {
  const { state, url, expiresIn } = await acct<{ state: string; url: string; expiresIn: number }>('auth/ext/start', { provider })
  const open = () => window.api.account.openPayUrl(url)
  open()
  onLink?.(open)
  const until = Date.now() + (expiresIn || 600) * 1000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000))
    if (signal.aborted) throw new Error('Canceled')
    let r: { pending?: boolean }
    try {
      r = await acct<{ pending?: boolean }>('auth/ext/poll', { state })
    } catch (e) {
      // a network hiccup: keep waiting; a real answer (expired, canceled, disabled…) ends it
      if (useAccount.getState().offline) continue
      throw e
    }
    if (!r.pending) {
      loadPlans().catch(() => {})
      return
    }
  }
  throw new Error('Sign-in timed out — try again')
}

export async function signOut() {
  await acct('auth/logout', {}).catch(() => window.api.account.signOutLocal())
  useAccount.setState({ signedIn: false, user: null, access: null, checkedAt: 0 })
}

export async function setServer(url: string) {
  const s = await window.api.account.setServer(url)
  useAccount.setState({ ...s, offline: false, plans: [] })
  await loadPlans().catch(() => {})
}

export function formatPrice(p: Plan, currency: 'USD' | 'KHR') {
  return currency === 'KHR' ? `${p.priceKhr.toLocaleString()} ៛` : `$${p.priceUsd.toFixed(p.priceUsd % 1 ? 2 : 0)}`
}

// keep access fresh: every 30 min, and when the window regains focus after 10 min
let timer: ReturnType<typeof setInterval> | null = null
export function startAccountSync() {
  if (timer) return
  loadAccount().catch(() => useAccount.setState({ loaded: true }))
  timer = setInterval(() => useAccount.getState().signedIn && acct('me').catch(() => {}), 30 * 60_000)
  window.addEventListener('focus', () => {
    const s = useAccount.getState()
    if (s.signedIn && Date.now() - s.checkedAt > 10 * 60_000) acct('me').catch(() => {})
  })
}

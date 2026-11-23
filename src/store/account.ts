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
}

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
  trialDays: 3
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
  const r = await acct<{ plans: Plan[]; currency: 'USD' | 'KHR'; support: string; trialDays: number }>('plans')
  useAccount.setState({ plans: r.plans, currency: r.currency, support: r.support ?? '', trialDays: r.trialDays ?? 3 })
}

export async function signIn(email: string, password: string) {
  await acct('auth/login', { email, password })
}

export async function register(email: string, password: string, name: string) {
  await acct('auth/register', { email, password, name })
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

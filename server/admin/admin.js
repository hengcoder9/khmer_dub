// KhmerDub admin console — plain JS, talks to ../api/. All user data goes through esc() before innerHTML.
'use strict'

const API = new URL('../api/', location.href).href
let token = sessionStorage.getItem('kd-admin-token') || ''
let plansCache = []
let me = null

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmtDate = (d) => (d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString() : '—')
const fmtDay = (d) => (d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString() : '—')
const money = (n, c) => (c === 'KHR' ? `${Math.round(n).toLocaleString()} ៛` : `$${Number(n).toFixed(2)}`)
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} }
}

// ───────── icons (Lucide-style strokes) ─────────
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  orders: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  plans: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  codes: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  settings: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  audit: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  device: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20"/>',
  updown: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  spark: '<path d="M9.94 14.06 4 20M14 4l1.5 3.5L19 9l-3.5 1.5L14 14l-1.5-3.5L9 9l3.5-1.5zM19 15l.75 1.75L21.5 17.5l-1.75.75L19 20l-.75-1.75L16.5 17.5l1.75-.75z"/>',
  pulse: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  gauge: '<path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>'
}
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`

function toast(msg, bad = false) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast' + (bad ? ' bad' : '')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500)
}

async function api(path, body) {
  const res = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  // 401 means the session ended — except auth/password, which answers a wrong current password with 401
  if (res.status === 401 && path !== 'auth/password') signOut(false)
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function accessPill(a) {
  if (!a) return ''
  if (a.kind === 'lifetime') return '<span class="pill vip">Lifetime</span>'
  if (a.kind === 'paid') return `<span class="pill ok">${esc(a.plan)} · ${a.daysLeft}d</span>`
  if (a.kind === 'trial') return `<span class="pill warn">Trial · ${a.daysLeft}d</span>`
  return '<span class="pill bad">No plan</span>'
}
const statusTone = (s) => (s === 'paid' || s === 'active' ? 'ok' : s === 'pending' ? 'warn' : s === 'canceled' || s === 'expired' ? 'off' : 'bad')
const statusPill = (s) => `<span class="st ${statusTone(s)}"><span class="dot ${statusTone(s)}"></span>${esc(String(s ?? '').replace(/^./, (c) => c.toUpperCase()))}</span>`
// password field with a show/hide eye
const pwField = (id, ph = '', ac = 'new-password') =>
  `<div class="pw"><input id="${id}" type="password" placeholder="${esc(ph)}" autocomplete="${ac}" /><button type="button" class="icon-btn eye" data-eye="${id}" title="Show">${icon('eye')}</button></div>`
const wireEyes = () =>
  $$('[data-eye]').forEach(
    (b) =>
      (b.onclick = () => {
        const i = $('#' + b.dataset.eye)
        i.type = i.type === 'password' ? 'text' : 'password'
        b.innerHTML = icon(i.type === 'password' ? 'eye' : 'eyeOff')
      })
  )
// on/off switch row (title, description, checkbox)
const toggleRow = (id, title, sub, on) =>
  `<label class="toggle-row"><span><b>${title}</b><small>${sub}</small></span><input id="${id}" type="checkbox" class="switch" ${on ? 'checked' : ''} /></label>`
const steps = (list) => `<ol class="steps">${list.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>`

// building blocks
const pageHead = (ic, title, sub, actions = '') =>
  `<div class="page-head"><span class="tile">${icon(ic)}</span><div><h1>${title}</h1><p>${sub}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`
const cardHead = (ic, title, sub = '', actions = '') =>
  `<div class="card-head"><span class="tile sm">${icon(ic)}</span><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`
const emptyRow = (n, text) => `<tr><td colspan=${n} class="empty">${text}</td></tr>`

// ───────── auth ─────────
function signOut(callServer = true) {
  if (callServer && token) api('auth/logout', {}).catch(() => {})
  token = ''
  sessionStorage.removeItem('kd-admin-token')
  $('#app').classList.add('hidden')
  $('#login').classList.remove('hidden')
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  $('#loginErr').textContent = ''
  try {
    const r = await api('auth/login', { email: f.get('email'), password: f.get('password'), device: 'Admin console · ' + navigator.userAgent.slice(0, 60) })
    if (r.user.role !== 'admin') {
      token = r.token
      signOut()
      throw new Error('This account is not an admin')
    }
    token = r.token
    sessionStorage.setItem('kd-admin-token', token)
    start(r.user)
  } catch (err) {
    $('#loginErr').textContent = err.message
  }
})

async function start(user) {
  me = user
  $('#login').classList.add('hidden')
  $('#app').classList.remove('hidden')
  $('#meEmail').textContent = user.email
  $('#meName').textContent = user.name || 'Admin'
  $('#meAvatar').textContent = (user.name || user.email || 'A').trim()[0].toUpperCase()
  plansCache = (await api('admin/plans')).plans
  refreshChip()
  route()
}

// ───────── shell: nav, top bar, theme ─────────
const NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'dashboard'], ['users', 'Users', 'users'], ['orders', 'Orders', 'orders']]],
  ['Sales', [['plans', 'Plans & prices', 'plans'], ['codes', 'License codes', 'codes']]],
  ['Management', [['keys', 'API keys', 'key'], ['settings', 'Settings', 'settings'], ['audit', 'Audit log', 'audit'], ['account', 'My account', 'lock']]],
  // shortcuts: [view, label, icon, href, external]
  ['ABA Pay (KHQR)', [['settings/anajakpay', 'AnajakPay setup', 'plug', '#settings/anajakpay'], ['settings/manual', 'Manual KHQR', 'qr', '#settings/manual'], ['', 'AnajakPay portal', 'globe', 'https://anajakpay.com', true]], 'accent']
]
const groupOf = (v) => (NAV.find(([, items]) => items.some(([id]) => id === v)) || NAV[0])[0]
const titleOf = (v) => (NAV.flatMap(([, i]) => i).find(([id]) => id === v) || [, 'Dashboard'])[1]

$('#nav').innerHTML = NAV.map(
  ([g, items, tone]) =>
    `<div class="nav-group${tone ? ' ' + tone : ''}">${esc(g)}</div>` +
    items
      .map(
        ([id, label, ic, href, ext]) =>
          `<a data-view="${id}" href="${href || '#' + id}"${ext ? ' target="_blank" rel="noopener"' : ''}>${icon(ic)}<span>${esc(label)}</span>${
            id === 'orders' ? '<span id="pendingBadge" class="pill warn count hidden"></span>' : ext ? `<span class="ext">${icon('external')}</span>` : ''
          }</a>`
      )
      .join('')
).join('')
$('#sideToggle').innerHTML = icon('panel')
$('#brandChev').outerHTML = `<span class="chev">${icon('updown')}</span>`
$('#meChev').outerHTML = `<span class="chev">${icon('updown')}</span>`
$('#searchIcon').outerHTML = icon('search')
$('#year').textContent = new Date().getFullYear()
$('#mAccount').innerHTML = `${icon('user')} My account`
$('#logout').innerHTML = `${icon('logout')} Sign out`
$('#logout').onclick = () => signOut()

// account menu above the user row
const meMenu = $('#meMenu')
const setMenu = (open) => {
  meMenu.classList.toggle('hidden', !open)
  $('#meBtn').setAttribute('aria-expanded', String(open))
}
$('#meBtn').onclick = (e) => {
  e.stopPropagation()
  setMenu(meMenu.classList.contains('hidden'))
}
meMenu.onclick = (e) => e.stopPropagation()
$('#mAccount').addEventListener('click', () => setMenu(false))
document.addEventListener('click', () => setMenu(false))

const app = $('#app')
if (store.get('kd-admin-collapsed', '0') === '1') app.classList.add('collapsed')
$('#sideToggle').onclick = () => {
  if (matchMedia('(max-width: 760px)').matches) return app.classList.toggle('nav-open')
  app.classList.toggle('collapsed')
  store.set('kd-admin-collapsed', app.classList.contains('collapsed') ? '1' : '0')
}
$('#scrim').onclick = () => app.classList.remove('nav-open')

const setThemeIcon = () => {
  const light = document.documentElement.dataset.theme === 'light'
  $('#themeToggle').innerHTML = icon(light ? 'moon' : 'sun')
  $('#mTheme').innerHTML = `${icon(light ? 'moon' : 'sun')} ${light ? 'Dark' : 'Light'} theme`
}
setThemeIcon()
$('#themeToggle').onclick = $('#mTheme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  store.set('kd-admin-theme', next)
  setThemeIcon()
}

// global search → Users
let pendingQuery = ''
$('#globalSearch').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  pendingQuery = e.target.value.trim()
  e.target.value = ''
  e.target.blur()
  if (location.hash === '#users') route()
  else location.hash = 'users'
})
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    $('#globalSearch').focus()
  }
  if (e.key === 'Escape' && !$('#drawer').classList.contains('hidden')) closeDrawer()
})

async function refreshChip() {
  try {
    const h = await api('health')
    const auto = h.payment === 'anajakpay'
    $('#payChip').innerHTML = `<span class="dot ok"></span>${auto ? 'AnajakPay' : 'Manual KHQR'}`
  } catch {
    $('#payChip').innerHTML = '<span class="dot bad"></span>API offline'
  }
}

// ───────── router ─────────  #view or #view/sub
const views = { dashboard, users, orders, plans, codes, keys, settings, audit, account }
function route() {
  const [v0, sub] = location.hash.slice(1).split('/')
  const v = views[v0] ? v0 : 'dashboard'
  app.classList.remove('nav-open')
  setMenu(false)
  window.onresize = null
  // a shortcut like "settings/anajakpay" wins over its parent "settings"
  const full = sub ? `${v}/${sub}` : v
  const exact = $$('#nav a').some((a) => a.dataset.view === full)
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === (exact ? full : v)))
  $('#crumbs').innerHTML = `<span class="mid">${groupOf(v)}</span>${icon('chevron')}<b>${esc(titleOf(v))}</b>`
  document.title = `${titleOf(v)} · KhmerDub Admin`
  const q = pendingQuery
  pendingQuery = ''
  ;(v === 'users' ? users(q) : v === 'settings' ? settings(sub) : views[v]()).catch((e) => toast(e.message, true))
  api('admin/stats')
    .then((s) => {
      const b = $('#pendingBadge')
      b.textContent = s.pendingOrders
      b.classList.toggle('hidden', !s.pendingOrders)
      $('#brandSub').textContent = `Admin · ${s.users} user${s.users === 1 ? '' : 's'}`
    })
    .catch(() => {})
}
window.addEventListener('hashchange', route)

const view = (html) => ($('#view').innerHTML = html)
const planOptions = (sel) => plansCache.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')

// ───────── dashboard ─────────
// UTC day keys for the last n days, oldest first (orders store UTC times)
const lastDays = (n) => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400000).toISOString().slice(0, 10))
const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const shortMoney = (n, c) => {
  const k = Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n * 100) / 100)
  return c === 'KHR' ? `${k} ៛` : `$${k}`
}
const niceMax = (v) => {
  if (v <= 0) return 10
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)
}

// revenue line (smooth, filled) over paid-order bars; colors come from CSS classes so the theme switch needs no redraw
function drawChart(box, pts, cur) {
  const W = Math.max(box.clientWidth, 280), H = 250, L = 56, R = 10, T = 14, B = 30
  const iw = W - L - R, ih = H - T - B, step = iw / pts.length
  const maxV = niceMax(Math.max(...pts.map((p) => p.v))), maxN = Math.max(1, ...pts.map((p) => p.n))
  const X = (i) => L + step * (i + 0.5), Y = (v) => T + ih - (v / maxV) * ih
  const xy = pts.map((p, i) => [X(i), Y(p.v)])
  // Catmull-Rom → cubic Bézier, control points clamped to the plot so the curve never dips below $0
  const clampY = (y) => Math.min(T + ih, Math.max(T, y))
  let d = `M${xy[0][0]},${xy[0][1]}`
  for (let i = 0; i < xy.length - 1; i++) {
    const [p0, p1, p2, p3] = [xy[i - 1] || xy[i], xy[i], xy[i + 1], xy[i + 2] || xy[i + 1]]
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${clampY(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${clampY(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`
  }
  const every = Math.ceil(pts.length / Math.max(2, Math.floor(iw / 70)))
  const bw = Math.max(3, Math.min(14, step * 0.4))
  box.innerHTML = `<svg width="${W}" height="${H}" class="chart" role="img" aria-label="Revenue chart">
    <defs><linearGradient id="gArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="ga0"/><stop offset="1" class="ga1"/></linearGradient></defs>
    ${[0, 0.5, 1].map((f) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(maxV * f)}" y2="${Y(maxV * f)}"/><text class="ax" x="${L - 8}" y="${Y(maxV * f) + 4}" text-anchor="end">${esc(shortMoney(maxV * f, cur))}</text>`).join('')}
    ${pts.map((p, i) => (p.n ? `<rect class="bar" x="${X(i) - bw / 2}" y="${T + ih - (p.n / maxN) * ih * 0.85}" width="${bw}" height="${(p.n / maxN) * ih * 0.85}" rx="2"/>` : '')).join('')}
    <path class="area" fill="url(#gArea)" d="${d} L${xy[xy.length - 1][0]},${T + ih} L${xy[0][0]},${T + ih} Z"/>
    <path class="line" d="${d}"/>
    ${pts.map((p, i) => (i % every === (pts.length - 1) % every ? `<text class="ax" x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(dayLabel(p.day))}</text>` : '')).join('')}
    <line class="cursor hidden" y1="${T}" y2="${T + ih}"/><circle class="knob hidden" r="4.5"/>
    ${pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${L + step * i}" y="${T}" width="${step}" height="${ih}"/>`).join('')}
  </svg><div class="tip hidden"></div>`
  const tip = $('.tip', box), cursor = $('.cursor', box), knob = $('.knob', box)
  $$('.hit', box).forEach((r) => {
    r.onmouseenter = () => {
      const i = +r.dataset.i, p = pts[i], [x, y] = xy[i]
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); knob.setAttribute('cx', x); knob.setAttribute('cy', y)
      cursor.classList.remove('hidden'); knob.classList.remove('hidden')
      tip.innerHTML = `<b>${esc(dayLabel(p.day))}</b><span><i class="sw line"></i>Revenue <b>${esc(money(p.v, cur))}</b></span><span><i class="sw bar"></i>Paid orders <b>${p.n}</b></span>`
      tip.classList.remove('hidden')
      tip.style.left = Math.min(Math.max(x - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + 'px'
      tip.style.top = Math.max(y - tip.offsetHeight - 14, 0) + 'px'
    }
  })
  box.onmouseleave = () => [tip, cursor, knob].forEach((e) => e.classList.add('hidden'))
}

async function dashboard() {
  const s = await api('admin/stats')
  // the chart shows one currency: the one most orders were paid in (USD when there are none yet)
  const cur = (s.revenue.slice().sort((a, b) => b.n - a.n)[0] || {}).currency || 'USD'
  const byDay = Object.fromEntries(s.daily.filter((r) => r.currency === cur).map((r) => [r.day, r]))
  const series = (n) => lastDays(n).map((day) => ({ day, v: +(byDay[day]?.total || 0), n: +(byDay[day]?.n || 0) }))
  const sum = (list, k) => list.reduce((a, p) => a + p[k], 0)
  const d30 = series(30), last7 = d30.slice(-7), prev7 = d30.slice(-14, -7)
  const rev7 = sum(last7, 'v'), revPrev = sum(prev7, 'v')
  const delta = revPrev ? ((rev7 - revPrev) / revPrev) * 100 : null
  const allTime = s.revenue.length ? s.revenue.map((r) => money(r.total, r.currency)).join(' + ') : money(0, cur)
  const st = Object.fromEntries(s.orderStatus.map((r) => [r.status, +r.n]))
  const total = Object.values(st).reduce((a, b) => a + b, 0)
  const paid = st.paid || 0
  const rate = total ? Math.round((paid / total) * 1000) / 10 : 0
  const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0)
  const stat = (ic, k, v, sub) => `<div class="card stat"><div class="k">${k}${icon(ic)}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`
  const bar = (p, tone = '') => `<div class="meter ${tone}"><i style="width:${p}%"></i></div>`
  const auto = s.paymentMode === 'anajakpay'

  view(`
    <div class="page-head"><span class="tile">${icon('dashboard')}</span>
      <div><h1>KhmerDub Studio</h1>
        <div class="head-meta"><span class="st ok"><span class="dot ok"></span>Online</span><span class="sep">·</span>
          <a class="chip" href="#settings/payments">${icon(auto ? 'plug' : 'qr')}${auto ? 'AnajakPay (automatic)' : 'Manual KHQR'}</a></div></div>
      <div class="actions"><a class="btn" href="#settings">${icon('settings')} Settings</a><a class="btn primary" href="#codes">${icon('plus')} Create codes</a></div>
    </div>
    <div class="stats four">
      ${stat('wallet', 'Net revenue', esc(allTime), 'Lifetime paid orders')}
      ${stat('trend', 'Revenue · 7 days', esc(money(rev7, cur)), delta === null ? 'No sales the week before' : `<span class="${delta < 0 ? 'down' : 'up'}">${delta < 0 ? '↘' : '↗'} ${Math.abs(delta).toFixed(1)}%</span> vs previous 7 days`)}
      ${stat('users', 'Users', s.users, `<span class="up">+${s.newUsers7d}</span> joined in the last 7 days`)}
      ${stat('gauge', 'Payment success', `${rate}%`, `${paid.toLocaleString()} of ${total.toLocaleString()} orders paid`)}
    </div>
    <div class="dash-grid">
      <div class="card">
        <div class="card-head"><div><h3>Revenue</h3><p id="chartSub"></p></div>
          <div class="actions"><div class="seg" id="range"><button data-n="7" class="on">7 days</button><button data-n="30">30 days</button></div></div></div>
        <div class="body"><div class="chart-box" id="chart"></div></div>
      </div>
      <div class="side-stack">
        <div class="card">${cardHead('pulse', 'Payment health', 'How customers’ orders finished.')}
          <div class="body tight">
            ${kv('Paid', paid.toLocaleString())}${bar(pct(paid, total))}
            ${kv('Waiting for payment', (st.pending || 0).toLocaleString())}
            ${kv('Expired, canceled or failed', ((st.expired || 0) + (st.canceled || 0) + (st.failed || 0)).toLocaleString())}
            ${kv('Paid today', s.paidToday.toLocaleString())}
            ${s.pendingOrders ? `<a class="btn sm" href="#orders">${icon('orders')} ${s.pendingOrders} pending to review</a>` : ''}
          </div></div>
        <div class="card">${cardHead('crown', 'Customers', 'Trials and running plans.', `<a class="btn sm" href="#plans">Manage</a>`)}
          <div class="body tight">
            ${kv('Paying now', `${s.paying} / ${s.users}`)}${bar(pct(s.paying, s.users))}
            ${kv('On free trial', s.trials)}
            ${kv('Lifetime', s.lifetime)}
            ${s.byPlan.map((p) => kv(`<span class="muted">${esc(p.name)}</span>`, p.n)).join('')}
          </div></div>
      </div>
    </div>
    <div class="card flush">
      <div class="card-head"><div><h3>Recent activity</h3><p>Latest orders from customers</p></div><div class="actions"><a class="btn sm" href="#orders">View all ${icon('arrowRight')}</a></div></div>
      <div class="table-wrap"><table><tr><th>Order</th><th>Status</th><th>Customer</th><th>Method</th><th class="num">Amount</th><th>Date</th><th></th></tr>
      ${s.recent
        .map(
          (o) => `<tr class="click" data-uid="${o.userId}"><td><div class="mono">${esc(o.ref)}</div><div class="muted small">${esc(o.plan)}</div></td>
          <td>${statusPill(o.status)}</td><td>${esc(o.email)}</td>
          <td class="muted nowrap">${o.provider === 'anajakpay' ? `ABA Pay (KHQR)${o.payUrl ? ' · checkout' : ''}` : 'Manual KHQR'}</td>
          <td class="num"><b>${money(o.amount, o.currency)}</b></td><td class="muted nowrap">${fmtDate(o.createdAt)}</td><td class="muted">${icon('chevron')}</td></tr>`
        )
        .join('') || emptyRow(7, 'No orders yet')}</table></div>
    </div>`)

  let n = 7
  const paint = () => {
    const pts = n === 7 ? last7 : d30
    $('#chartSub').textContent = `${money(sum(pts, 'v'), cur)} · ${sum(pts, 'n')} paid order${sum(pts, 'n') === 1 ? '' : 's'} in the last ${n} days`
    drawChart($('#chart'), pts, cur)
  }
  $$('#range button').forEach(
    (b) =>
      (b.onclick = () => {
        n = +b.dataset.n
        $$('#range button').forEach((x) => x.classList.toggle('on', x === b))
        paint()
      })
  )
  paint()
  let t
  window.onresize = () => {
    clearTimeout(t)
    t = setTimeout(() => $('#chart') && paint(), 120)
  }
  $$('tr[data-uid]').forEach((tr) => (tr.onclick = () => openUser(+tr.dataset.uid)))
}

// ───────── users ─────────
async function users(q = '') {
  const r = await api('admin/users?q=' + encodeURIComponent(q))
  view(`
    ${pageHead('users', 'Users', `${r.total} account${r.total === 1 ? '' : 's'} · trials, plans and devices.`, `<button class="btn primary" id="newUser">${icon('plus')} New user</button>`)}
    <div class="card flush">
      <div class="card-head"><label class="search" style="width:min(360px,100%)">${icon('search')}<input id="uq" placeholder="Search email or name" value="${esc(q)}" /></label></div>
      <div class="table-wrap"><table>
      <tr><th>User</th><th>Access</th><th>Role</th><th>Status</th><th>Devices</th><th>Last sign-in</th><th>Joined</th></tr>
      ${r.users
        .map(
          (u) => `<tr class="click" data-id="${u.id}"><td><div class="row center" style="flex-wrap:nowrap"><span class="avatar">${esc((u.name || u.email || '?').trim()[0].toUpperCase())}</span><div><b>${esc(u.name)}</b><div class="muted">${esc(u.email)}</div></div></div></td>
          <td>${accessPill(u.access)}</td><td>${u.role === 'admin' ? '<span class="pill vip">admin</span>' : '<span class="muted">user</span>'}</td>
          <td>${statusPill(u.status)}</td><td>${u.devices}</td><td class="muted nowrap">${fmtDate(u.lastLoginAt)}</td><td class="muted nowrap">${fmtDay(u.createdAt)}</td></tr>`
        )
        .join('') || emptyRow(7, 'No users found')}
    </table></div></div>`)
  let t
  $('#uq').oninput = (e) => {
    clearTimeout(t)
    t = setTimeout(() => users(e.target.value).then(() => { const i = $('#uq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }), 300)
  }
  $('#newUser').onclick = newUser
  $$('tr[data-id]').forEach((tr) => (tr.onclick = () => openUser(+tr.dataset.id)))
}

function newUser() {
  drawer(`
    <div class="row center"><h2>New user</h2><span class="grow"></span><button class="icon-btn" onclick="closeDrawer()">${icon('x')}</button></div>
    <div class="card"><div class="body">
      <label>Email<input id="nuEmail" type="email" placeholder="name@example.com" /></label><label>Name<input id="nuName" /></label>
      <label>Password<input id="nuPw" type="text" placeholder="min 8 characters" /></label>
      <label>Role<select id="nuRole"><option value="user">User</option><option value="admin">Admin</option></select></label></div>
      <div class="foot-row"><button class="btn" onclick="closeDrawer()">Cancel</button><button class="btn primary" id="nuSave">Create user</button></div></div>`)
  $('#nuSave').onclick = async () => {
    try {
      const r = await api('admin/user/create', { email: $('#nuEmail').value, name: $('#nuName').value, password: $('#nuPw').value, role: $('#nuRole').value })
      toast('User created')
      openUser(r.id)
    } catch (e) {
      toast(e.message, true)
    }
  }
}

async function openUser(id) {
  const r = await api('admin/user?id=' + id)
  const u = r.user
  drawer(`
    <div class="row center" style="flex-wrap:nowrap"><span class="avatar" style="width:42px;height:42px;font-size:17px">${esc((u.name || u.email || '?').trim()[0].toUpperCase())}</span>
      <div style="min-width:0"><h2>${esc(u.name)}</h2><div class="muted">${esc(u.email)}</div></div>${accessPill(u.access)}<span class="grow"></span>
      <button class="icon-btn" onclick="closeDrawer()">${icon('x')}</button></div>
    <div class="muted">Joined ${fmtDay(u.createdAt)} · last sign-in ${fmtDate(u.lastLoginAt)}</div>

    <div class="card">${cardHead('gift', 'Give a plan', 'Time adds on after the current plan ends.')}
      <div class="body"><div class="row"><label style="flex:1">Plan<select id="gPlan">${planOptions()}</select></label>
      <label style="flex:1">Note<input id="gNote" placeholder="e.g. paid cash" /></label><button class="btn primary" id="gGo">Grant</button></div></div></div>

    <div class="card">${cardHead('user', 'Account')}
      <div class="body"><div class="grid2">
        <label>Name<input id="eName" value="${esc(u.name)}" /></label>
        <label>Role<select id="eRole"><option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
        <label>Trial (days from now)<input id="eTrial" type="number" min="0" placeholder="ends ${fmtDay(u.trialEndsAt)}" /></label>
        <label>New password<input id="ePw" type="text" placeholder="leave empty to keep" /></label>
      </div>
      <label>Admin note<textarea id="eNote">${esc(u.note)}</textarea></label></div>
      <div class="foot-row"><button class="btn" id="eOut">Sign out all devices</button>
        <button class="btn ${u.status === 'active' ? 'danger' : 'ok'}" id="eStatus">${u.status === 'active' ? 'Disable account' : 'Enable account'}</button>
        <button class="btn primary" id="eSave">Save</button></div></div>

    <div class="card flush">${cardHead('crown', 'Subscriptions')}<div class="table-wrap"><table><tr><th>Plan</th><th>From</th><th>Until</th><th>Source</th><th></th></tr>
      ${r.subscriptions.map((s) => `<tr style="${s.revoked ? 'opacity:.45;text-decoration:line-through' : ''}"><td>${esc(s.plan)}</td><td>${fmtDay(s.starts_at)}</td><td>${s.ends_at ? fmtDay(s.ends_at) : '∞'}</td><td>${esc(s.source)}${s.note ? ` <span class="muted">${esc(s.note)}</span>` : ''}</td>
        <td>${s.revoked ? '' : `<button class="btn danger sm" data-revoke="${s.id}">Revoke</button>`}</td></tr>`).join('') || emptyRow(5, 'None')}</table></div></div>

    <div class="card flush">${cardHead('orders', 'Orders')}<div class="table-wrap"><table><tr><th>Ref</th><th>Amount</th><th>Status</th><th>Date</th></tr>
      ${r.orders.map((o) => `<tr><td class="mono">${esc(o.ref)}</td><td>${money(o.amount, o.currency)}</td><td>${statusPill(o.status)}</td><td class="muted">${fmtDate(o.createdAt)}</td></tr>`).join('') || emptyRow(4, 'None')}</table></div></div>

    <div class="card flush">${cardHead('device', 'Signed-in devices')}<div class="table-wrap"><table><tr><th>Device</th><th>IP</th><th>Last seen</th></tr>
      ${r.sessions.map((s) => `<tr><td>${esc(s.device)}</td><td class="mono">${esc(s.ip)}</td><td class="muted">${fmtDate(s.last_seen_at)}</td></tr>`).join('') || emptyRow(3, 'None')}</table></div></div>`)

  const save = async (patch, msg = 'Saved') => {
    try {
      await api('admin/user', { id, ...patch })
      toast(msg)
      openUser(id)
    } catch (e) {
      toast(e.message, true)
    }
  }
  $('#gGo').onclick = async () => {
    try {
      const g = await api('admin/grant', { userId: id, planId: +$('#gPlan').value, note: $('#gNote').value })
      toast(`Plan added${g.endsAt ? ' — until ' + fmtDay(g.endsAt) : ' — lifetime'}`)
      openUser(id)
    } catch (e) {
      toast(e.message, true)
    }
  }
  $('#eSave').onclick = () => {
    const p = { name: $('#eName').value, role: $('#eRole').value, note: $('#eNote').value }
    if ($('#eTrial').value !== '') p.trialDays = +$('#eTrial').value
    if ($('#ePw').value) p.password = $('#ePw').value
    save(p)
  }
  $('#eStatus').onclick = () => confirm(u.status === 'active' ? 'Disable this account? They are signed out everywhere.' : 'Enable this account?') && save({ status: u.status === 'active' ? 'disabled' : 'active' })
  $('#eOut').onclick = () => save({ signOut: true }, 'Signed out of all devices')
  $$('[data-revoke]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Revoke this subscription?')) return
        await api('admin/revoke', { subscriptionId: +b.dataset.revoke }).catch((e) => toast(e.message, true))
        openUser(id)
      })
  )
}

function drawer(html) {
  $('#drawerBody').innerHTML = html
  $('#drawer').classList.remove('hidden')
}
window.closeDrawer = () => {
  $('#drawer').classList.add('hidden')
  route()
}
$('#drawer').onclick = (e) => e.target.id === 'drawer' && closeDrawer()

// ───────── orders ─────────
async function orders(status = 'pending') {
  const r = await api('admin/orders?status=' + status)
  view(`
    ${pageHead('orders', 'Orders', 'Manual KHQR: match the reference in the transfer note, then Confirm. AnajakPay orders confirm themselves — <b>Check now</b> asks AnajakPay right away.',
      `<select id="oStatus" style="width:160px">${['pending', 'paid', 'expired', 'canceled', 'failed', 'all'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
    <div class="card flush"><div class="table-wrap"><table><tr><th>Ref</th><th>User</th><th>Plan</th><th>Amount</th><th>Status</th><th>Via</th><th>Created</th><th>Paid / expires</th><th></th></tr>
      ${r.orders
        .map(
          (o) => `<tr><td class="mono">${esc(o.ref)}</td><td><a data-user="${o.userId}">${esc(o.email)}</a></td><td>${esc(o.plan)}</td><td><b>${money(o.amount, o.currency)}</b></td>
          <td>${statusPill(o.status)}</td><td class="muted nowrap">${esc(o.provider)}${o.provider === 'anajakpay' ? (o.payUrl ? ' · checkout' : ' · QR') : ''}</td><td class="muted nowrap">${fmtDate(o.createdAt)}</td>
          <td class="muted nowrap">${o.paidAt ? fmtDate(o.paidAt) : o.status === 'pending' ? 'until ' + fmtDate(o.expiresAt) : '—'}</td>
          <td class="nowrap" style="text-align:right">${o.provider === 'anajakpay' && ['pending', 'expired'].includes(o.status) ? `<button class="btn sm" data-check="${o.id}">${icon('refresh')} Check now</button> ` : ''}${o.status !== 'paid' ? `<button class="btn ok sm" data-confirm="${o.id}">Confirm paid</button> ` : ''}${o.status === 'pending' ? `<button class="btn danger sm" data-reject="${o.id}">Reject</button>` : ''}</td></tr>`
        )
        .join('') || emptyRow(9, 'No orders')}</table></div></div>`)
  $('#oStatus').onchange = (e) => orders(e.target.value)
  $$('[data-check]').forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true
        try {
          const r = await api('admin/orders/check', { id: +b.dataset.check })
          if (r.status === 'paid') toast('Paid — plan activated')
          else toast(`Still ${r.status}${r.note ? ' — ' + r.note : ''}`, r.status !== 'pending')
          orders(status)
        } catch (e) {
          toast(e.message, true)
          b.disabled = false
        }
      })
  )
  $$('[data-user]').forEach((a) => (a.onclick = () => openUser(+a.dataset.user)))
  $$('[data-confirm]').forEach(
    (b) =>
      (b.onclick = async () => {
        const ref = prompt('Bank transaction / reference (optional):', '')
        if (ref === null) return
        try {
          await api('admin/orders/confirm', { id: +b.dataset.confirm, ref })
          toast('Payment confirmed — plan activated')
          orders(status)
        } catch (e) {
          toast(e.message, true)
        }
      })
  )
  $$('[data-reject]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Reject this order?')) return
        await api('admin/orders/reject', { id: +b.dataset.reject }).catch((e) => toast(e.message, true))
        orders(status)
      })
  )
}

// ───────── plans ─────────
async function plans() {
  const r = await api('admin/plans')
  plansCache = r.plans
  view(`
    ${pageHead('plans', 'Plans &amp; prices', 'What customers can buy in the app. Untick “On sale” to hide a plan.', '<button class="btn primary" id="pSave">Save changes</button>')}
    <div class="card flush"><div class="table-wrap"><table><tr><th>Plan</th><th>Length</th><th>Name</th><th>Price USD</th><th>Price KHR</th><th>Badge</th><th>Order</th><th>On sale</th></tr>
      ${r.plans
        .map(
          (p) => `<tr data-plan="${p.id}"><td class="mono">${esc(p.code)}</td><td class="nowrap">${p.months === null ? 'Lifetime' : p.months + ' mo'}</td>
          <td><input name="name" value="${esc(p.name)}" /></td><td><input name="priceUsd" type="number" step="0.01" min="0" value="${p.priceUsd}" style="width:100px" /></td>
          <td><input name="priceKhr" type="number" step="100" min="0" value="${p.priceKhr}" style="width:120px" /></td><td><input name="badge" value="${esc(p.badge)}" style="width:120px" /></td>
          <td><input name="sort" type="number" value="${p.sort}" style="width:70px" /></td><td><input name="enabled" type="checkbox" class="switch" ${p.enabled ? 'checked' : ''} /></td></tr>`
        )
        .join('')}</table></div></div>`)
  $('#pSave').onclick = async () => {
    const list = $$('tr[data-plan]').map((tr) => {
      const v = (n) => tr.querySelector(`[name=${n}]`)
      return { id: +tr.dataset.plan, name: v('name').value, priceUsd: +v('priceUsd').value, priceKhr: +v('priceKhr').value, badge: v('badge').value, sort: +v('sort').value, enabled: v('enabled').checked }
    })
    try {
      await api('admin/plans', { plans: list })
      toast('Plans saved')
      plans()
    } catch (e) {
      toast(e.message, true)
    }
  }
}

// ───────── license codes ─────────
async function codes() {
  const r = await api('admin/codes')
  view(`
    ${pageHead('codes', 'License codes', 'Sell or gift codes — customers redeem them in the app (Account → Redeem code).')}
    <div class="card">${cardHead('plus', 'Create codes')}
      <div class="body"><div class="row"><label style="flex:1;min-width:180px">Plan<select id="cPlan">${planOptions()}</select></label>
      <label style="width:120px">How many<input id="cCount" type="number" min="1" max="200" value="1" /></label>
      <label style="flex:1;min-width:180px">Note<input id="cNote" placeholder="e.g. Facebook promo" /></label><button class="btn primary" id="cGo">Create</button></div>
      <pre id="cOut" class="codes-out mono hidden"></pre></div></div>
    <div class="card flush"><div class="table-wrap"><table><tr><th>Code</th><th>Plan</th><th>Note</th><th>Status</th><th>Created</th><th></th></tr>
      ${r.codes
        .map(
          (c) => `<tr><td class="mono">${esc(c.code)}</td><td>${esc(c.plan)}</td><td class="muted">${esc(c.note)}</td>
          <td>${c.redeemed_by ? `<span class="pill ok">used · ${esc(c.redeemed_by)}</span>` : c.revoked ? '<span class="pill bad">revoked</span>' : '<span class="pill">unused</span>'}</td>
          <td class="muted nowrap">${fmtDay(c.created_at)}</td><td style="text-align:right">${!c.redeemed_by && !c.revoked ? `<button class="btn danger sm" data-revoke="${c.id}">Revoke</button>` : ''}</td></tr>`
        )
        .join('') || emptyRow(6, 'No codes yet')}</table></div></div>`)
  $('#cGo').onclick = async () => {
    try {
      const g = await api('admin/codes', { planId: +$('#cPlan').value, count: +$('#cCount').value, note: $('#cNote').value })
      await codes()
      $('#cOut').textContent = g.codes.join('\n')
      $('#cOut').classList.remove('hidden')
      navigator.clipboard?.writeText(g.codes.join('\n')).then(() => toast(`${g.codes.length} code(s) created and copied`))
    } catch (e) {
      toast(e.message, true)
    }
  }
  $$('[data-revoke]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Revoke this code?')) return
        await api('admin/codes/revoke', { id: +b.dataset.revoke }).catch((e) => toast(e.message, true))
        codes()
      })
  )
}

// ───────── API keys ─────────  shared keys (stored encrypted, handed to subscribers' apps)
const PROVIDER_NAMES = { gemini: 'Google Gemini', openrouter: 'OpenRouter', claude: 'Claude', codecraft: 'CodeCraft' }
async function keys() {
  const r = await api('admin/keys')
  const byProv = (p) => r.keys.filter((k) => k.provider === p)
  view(`
    ${pageHead('key', 'API keys', 'Keys you add here are stored encrypted on this server and sent to the app of every customer whose trial or plan is active, so they never have to type a key.')}
    <div class="card">${cardHead('plus', 'Add keys')}
      <div class="body"><div class="row">
        <label style="width:180px">Provider<select id="kProv">${r.providers.map((p) => `<option value="${p}">${esc(PROVIDER_NAMES[p] || p)}</option>`).join('')}</select></label>
        <label style="flex:1;min-width:160px">Label<input id="kLabel" placeholder="e.g. Pool A" /></label></div>
        <label>Keys <span class="muted">(one per line)</span><textarea id="kKeys" rows="4" class="mono" placeholder="AIza…" autocomplete="off" spellcheck="false"></textarea></label>
        <div><button class="btn primary" id="kAdd">Save keys</button></div></div></div>
    ${r.providers.map((p) => `<div class="card flush"><div class="table-wrap"><table>
      <tr><th colspan="5">${esc(PROVIDER_NAMES[p] || p)} <span class="muted">· ${byProv(p).filter((k) => k.enabled).length} of ${byProv(p).length} on</span></th></tr>
      ${byProv(p).map((k) => `<tr><td class="mono">${esc(k.masked)}</td><td class="muted">${esc(k.label)}</td><td class="muted nowrap">${fmtDay(k.created_at)}</td>
        <td>${k.enabled ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>'}</td>
        <td style="text-align:right" class="nowrap"><button class="btn sm" data-kt="${k.id}" data-on="${k.enabled ? 0 : 1}">${k.enabled ? 'Turn off' : 'Turn on'}</button> <button class="btn danger sm" data-kd="${k.id}">Delete</button></td></tr>`).join('') || emptyRow(5, 'No shared keys')}
    </table></div></div>`).join('')}
    <p class="muted">Customers' own saved keys: ${r.personal.map((x) => `${esc(PROVIDER_NAMES[x.provider] || x.provider)} ${x.c} (${x.users} user${x.users == 1 ? '' : 's'})`).join(' · ') || 'none yet'}. They are encrypted too, and only the owner's app can fetch them.</p>`)
  $('#kAdd').onclick = async () => {
    try {
      const g = await api('admin/keys', { provider: $('#kProv').value, label: $('#kLabel').value, key: $('#kKeys').value })
      toast(`${g.added} key(s) saved`)
      keys()
    } catch (e) {
      toast(e.message, true)
    }
  }
  $$('[data-kt]').forEach((b) => (b.onclick = async () => { await api('admin/keys/toggle', { id: +b.dataset.kt, enabled: b.dataset.on === '1' }).catch((e) => toast(e.message, true)); keys() }))
  $$('[data-kd]').forEach((b) => (b.onclick = async () => { if (!confirm('Delete this key? Apps stop receiving it.')) return; await api('admin/keys/remove', { id: +b.dataset.kd }).catch((e) => toast(e.message, true)); keys() }))
}

// ───────── settings ─────────  one form, shown one section at a time (#settings/<section>)
const SETTINGS_SECTIONS = [
  ['access', 'Access & trial', 'shield'],
  ['payments', 'Payments', 'wallet'],
  ['anajakpay', 'AnajakPay (ABA)', 'plug'],
  ['manual', 'Manual KHQR', 'qr']
]

async function settings(section) {
  const sec = SETTINGS_SECTIONS.some(([id]) => id === section) ? section : 'access'
  const s = await api('admin/settings')
  const a = s.anajakpay || {}
  const local = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/i.test(a.webhookUrl || '')
  const saveRow = `<div class="foot-row"><button class="btn primary" data-save>Save configuration</button></div>`
  const pane = (id, ic, title, sub, body, extra = '') =>
    `<div class="card${id === sec ? '' : ' hidden'}" data-pane="${id}">${cardHead(ic, title, sub, extra)}<div class="body">${body}</div>${saveRow}</div>`

  view(`
    ${pageHead('settings', 'Settings', 'Access rules, prices currency, payment methods and checkout for KhmerDub Studio.')}
    <div class="split">
      <nav class="subnav">${SETTINGS_SECTIONS.map(([id, label, ic]) => `<a href="#settings/${id}" class="${id === sec ? 'on' : ''}">${icon(ic)}${esc(label)}</a>`).join('')}</nav>
      <div>
      ${pane('access', 'shield', 'Access & trial', 'Who can sign up, how long the free trial lasts and how many devices an account may use.', `
        <div class="grid3">
          <label>Free trial (days)<input id="sTrial" type="number" min="0" max="365" value="${esc(s.trial_days)}" /><span class="hint">For new accounts.</span></label>
          <label>Devices per account<input id="sDevices" type="number" min="1" max="20" value="${esc(s.max_devices)}" /><span class="hint">A new sign-in signs out the oldest.</span></label>
          <label>Support contact<input id="sSupport" value="${esc(s.support_contact)}" placeholder="Telegram @… / phone / email" /><span class="hint">Shown in the app.</span></label>
        </div>
        ${toggleRow('sReg', 'Allow new sign-ups', 'When off, only existing accounts can sign in. You can still create users under Users.', s.registration_open === '1')}`)}

      ${pane('payments', 'wallet', 'Payments', 'How customers pay for a plan.', `
        <div class="grid2">
          <label>Payment method<select id="sMode">
            <option value="manual" ${s.payment_mode === 'manual' ? 'selected' : ''}>Manual KHQR (admin confirms)</option>
            <option value="anajakpay" ${s.payment_mode === 'anajakpay' ? 'selected' : ''}>AnajakPay KHQR — automatic${s.anajakpay_configured ? '' : ' (not configured)'}</option></select>
            <span class="hint">AnajakPay needs its profile ID and secret key — see AnajakPay (ABA).</span></label>
          <label>Currency<select id="sCur"><option ${s.currency === 'USD' ? 'selected' : ''}>USD</option><option ${s.currency === 'KHR' ? 'selected' : ''}>KHR</option></select>
            <span class="hint">AnajakPay charges in USD.</span></label>
          <label>AnajakPay checkout<select id="sFlow">
            <option value="qr" ${s.anajakpay_flow !== 'checkout' ? 'selected' : ''}>KHQR shown inside the app</option>
            <option value="checkout" ${s.anajakpay_flow === 'checkout' ? 'selected' : ''}>ABA checkout page in the browser ("Open in ABA Mobile")</option></select>
            <span class="hint">The checkout page costs nothing from AnajakPay's 50 requests/minute.</span></label>
        </div>`)}

      ${pane('anajakpay', 'qr', 'AnajakPay (ABA KHQR)', 'Automatic KHQR payments through ABA. The secret key never leaves this server.', `
        <div><h4 class="sub-title">How it works</h4><p class="muted" style="margin:2px 0 0">Customers pay a KHQR in ABA Mobile; the plan turns on by itself.</p></div>
        ${steps([
          ['Add your credentials', 'Profile ID and secret key from the AnajakPay portal, plus the public address of this server.'],
          ['Paste the webhook', 'Copy the Webhook URL below into AnajakPay → Settings, then press Test connection.'],
          ['Switch it on', 'Payments → Payment method → AnajakPay, Currency → USD. Paid orders are confirmed automatically.']
        ])}
        <hr class="sep-line" />
        <div class="grid2">
          <label>Profile ID<input id="apKey" class="mono" value="${esc(a.apiKey)}" placeholder="e.g. T0oBsUFLK9eK…" autocomplete="off" /><span class="hint">The code in your AnajakPay API URLs.</span></label>
          <label>Secret key${pwField('apSecret', a.secretSet ? 'leave empty to keep the current key' : 'paste the secret key')}
            <span class="hint">${a.secretSet ? `Set ${esc(a.secretHint)}${a.secretFrom === 'config.php' ? ' (from config.php)' : ''}` : 'Not set'}</span></label>
          <label>Public API URL<input id="apUrl" class="mono" value="${esc(a.publicUrl)}" placeholder="${esc(a.configPublicUrl || 'https://your-domain/khmerdub/api/')}" /><span class="hint">How AnajakPay reaches this server.</span></label>
          <label>Webhook URL<div class="row center" style="flex-wrap:nowrap"><input id="apHook" class="mono" readonly value="${esc(a.webhookUrl)}" /><button class="btn" id="apCopy" type="button">${icon('copy')} Copy</button></div>
            <span class="hint">Paste into AnajakPay → Settings → Webhook URL.</span></label>
        </div>
        ${local ? '<div class="note">⚠ This address only works on your own computer or network, so AnajakPay cannot call it. Set the Public API URL to your real https:// domain before going live (payments are still confirmed by status checks while the app is open).</div>' : ''}
        <div class="row center"><button class="btn" id="apTest" type="button" ${s.anajakpay_configured ? '' : 'disabled'}>${icon('refresh')} Test connection</button>
          ${a.secretFrom === 'admin' ? '<button class="btn danger" id="apClear" type="button">Remove saved secret</button>' : ''}
          <span class="result" id="apResult">Save first, then test. A test uses 1 of AnajakPay's 50 requests per minute.</span></div>`,
        `${s.anajakpay_configured ? `<span class="st ok"><span class="dot ok"></span>${s.payment_mode === 'anajakpay' ? 'Live' : 'Ready'}</span>` : '<span class="st warn"><span class="dot warn"></span>Setup required</span>'}${a.blockedFor ? `<span class="pill warn">rate limited · ${a.blockedFor}s</span>` : ''}
         <a class="btn sm" href="https://anajakpay.com" target="_blank" rel="noopener">${icon('globe')} Portal</a>`)}

      ${pane('manual', 'qr', 'Manual KHQR', "Your shop's static KHQR and the instructions customers see.", `
        <div class="grid2">
          <div style="display:grid;gap:10px;align-content:start">
            <label>Shop KHQR image<input id="sQrFile" type="file" accept="image/png,image/jpeg,image/webp" /><span class="hint">PNG, JPG or WebP, up to ~1.4 MB.</span></label>
            <div class="row center">${s.manual_qr_image ? `<img class="qr-prev" id="sQrPrev" src="${esc(s.manual_qr_image)}" alt="Shop KHQR" />` : '<span class="muted" id="sQrPrev">No QR uploaded</span>'}
              ${s.manual_qr_image ? '<button class="btn danger sm" id="sQrDel" type="button">Remove</button>' : ''}</div>
          </div>
          <label>Payment instructions<textarea id="sInstr" style="min-height:150px">${esc(s.manual_instructions)}</textarea><span class="hint">Shown next to the QR in the app.</span></label>
        </div>`)}
      </div>
    </div>`)

  wireEyes()
  let qr
  $('#sQrFile').onchange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > 1_400_000) return toast('Image too large — max ~1.4 MB', true)
    const rd = new FileReader()
    rd.onload = () => {
      qr = rd.result
      toast('QR loaded — press Save')
    }
    rd.readAsDataURL(f)
  }
  $('#sQrDel') && ($('#sQrDel').onclick = () => ((qr = ''), toast('QR will be removed — press Save')))
  const save = async () => {
    const body = {
      trial_days: +$('#sTrial').value,
      max_devices: +$('#sDevices').value,
      registration_open: $('#sReg').checked,
      support_contact: $('#sSupport').value,
      currency: $('#sCur').value,
      payment_mode: $('#sMode').value,
      anajakpay_flow: $('#sFlow').value,
      manual_instructions: $('#sInstr').value,
      anajakpay_api_key: $('#apKey').value.trim(),
      anajakpay_public_url: $('#apUrl').value.trim()
    }
    if ($('#apSecret').value.trim()) body.anajakpay_secret = $('#apSecret').value.trim()
    if (qr !== undefined) body.manual_qr_image = qr
    try {
      await api('admin/settings', body)
      toast('Settings saved')
      refreshChip()
      settings(sec)
    } catch (e) {
      toast(e.message, true)
    }
  }
  $$('[data-save]').forEach((b) => (b.onclick = save))

  $('#apCopy').onclick = () => navigator.clipboard?.writeText($('#apHook').value).then(() => toast('Webhook URL copied'))
  $('#apTest').onclick = async () => {
    const out = $('#apResult')
    out.textContent = 'Testing…'
    try {
      const r = await api('admin/anajakpay/test', {})
      out.innerHTML = `<span class="pill ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'OK' : 'Failed'}</span> ${esc(r.message)}`
    } catch (e) {
      out.innerHTML = `<span class="pill bad">Failed</span> ${esc(e.message)}`
    }
  }
  $('#apClear') &&
    ($('#apClear').onclick = async () => {
      if (!confirm('Remove the saved AnajakPay secret key? Automatic payments stop until you add it again.')) return
      await api('admin/settings', { anajakpay_secret_clear: true }).catch((e) => toast(e.message, true))
      toast('Secret removed')
      settings(sec)
    })
}

// ───────── my account ─────────  the signed-in admin's own name and password
async function account() {
  const [r, d] = await Promise.all([api('me'), api('admin/user?id=' + me.id)])
  const u = r.user
  me = { ...me, ...u }
  const initial = esc((u.name || u.email || 'A').trim()[0].toUpperCase())
  view(`
    ${pageHead('user', 'My account', 'Your name, password and where you are signed in.')}
    <div class="card profile"><span class="avatar xl">${initial}</span>
      <div><h2>${esc(u.name || 'Admin')}</h2><div class="muted">${esc(u.email)}</div></div>
      <div class="actions"><span class="pill vip">Admin</span><span class="pill">Joined ${fmtDay(d.user.createdAt)}</span></div></div>
    <div class="acct-grid">
      <div class="side-stack">
        <div class="card">${cardHead('user', 'Personal information', 'Your name and sign-in email.')}
          <div class="body"><div class="grid2">
            <label>Display name<input id="aName" value="${esc(u.name)}" maxlength="80" /><span class="hint">Shown in the sidebar and the audit log.</span></label>
            <label>Email address<input value="${esc(u.email)}" readonly /><span class="hint">The sign-in address. It cannot be changed here.</span></label>
          </div></div>
          <div class="foot-row"><button class="btn primary" id="aSaveName">Update name</button></div></div>
        <div class="card">${cardHead('lock', 'Security &amp; password', 'Your current password is needed to change it.')}
          <div class="body">
            <label style="max-width:calc(50% - 8px)">Current password${pwField('aCur', '', 'current-password')}<span class="hint">Confirms it is you.</span></label>
            <div class="grid2">
              <label>New password${pwField('aNew')}<span class="hint">At least 8 characters. Use one you do not use elsewhere.</span></label>
              <label>Confirm password${pwField('aNew2')}<span class="hint">Type the new password again.</span></label>
            </div></div>
          <div class="foot-row"><span class="hint grow">Changing it signs out your other devices.</span><button class="btn primary" id="aSavePw">Update password</button></div></div>
      </div>
      <div class="side-stack">
        <div class="card">${cardHead('shield', 'Access', 'What this account can do.')}
          <div class="body tight">
            <div class="kv"><span>Role</span><b>Administrator</b></div>
            <div class="kv"><span>Status</span><span class="st ok"><span class="dot ok"></span>Active</span></div>
            <div class="kv"><span>Last sign-in</span><b>${fmtDate(d.user.lastLoginAt)}</b></div>
          </div></div>
        <div class="card">${cardHead('device', 'Signed-in devices', `${d.sessions.length} active session${d.sessions.length === 1 ? '' : 's'}.`)}
          <div class="body tight">${d.sessions.map((x) => `<div class="device"><span class="tile sm">${icon('device')}</span><div><b>${esc(x.device || 'Unknown device')}</b><small class="muted">${[esc(x.ip), 'last seen ' + fmtDate(x.last_seen_at)].filter(Boolean).join(' · ')}</small></div></div>`).join('') || '<span class="muted">None</span>'}</div></div>
      </div>
    </div>`)
  wireEyes()
  $('#aSaveName').onclick = async () => {
    try {
      const r2 = await api('me', { name: $('#aName').value.trim() })
      me = { ...me, ...r2.user }
      $('#meName').textContent = r2.user.name || 'Admin'
      $('#meAvatar').textContent = (r2.user.name || r2.user.email || 'A').trim()[0].toUpperCase()
      toast('Name updated')
      account()
    } catch (e) {
      toast(e.message, true)
    }
  }
  $('#aSavePw').onclick = async () => {
    const cur = $('#aCur').value, pw = $('#aNew').value
    if (!cur || !pw) return toast('Fill in your current and new password', true)
    if (pw !== $('#aNew2').value) return toast('The new passwords do not match', true)
    try {
      await api('auth/password', { current: cur, password: pw })
      toast('Password changed — other devices are signed out')
      account()
    } catch (e) {
      toast(e.message, true)
    }
  }
}

// ───────── audit ─────────
async function audit() {
  const r = await api('admin/audit')
  view(`${pageHead('audit', 'Audit log', 'Sign-ins, payments, admin changes and rejected payment callbacks.')}
    <div class="card flush"><div class="table-wrap"><table><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr>
    ${r.log.map((a) => `<tr><td class="muted nowrap">${fmtDate(a.created_at)}</td><td>${esc(a.email || '—')}</td><td class="mono">${esc(a.action)}</td><td class="mono">${esc(a.target)}</td><td class="mono muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.detail)}">${esc(a.detail)}</td><td class="mono muted">${esc(a.ip)}</td></tr>`).join('') || emptyRow(6, 'Nothing logged yet')}
    </table></div></div>`)
}

// ───────── boot ─────────
if (token) api('me').then((r) => (r.user.role === 'admin' ? start(r.user) : signOut())).catch(() => signOut(false))
else signOut(false)

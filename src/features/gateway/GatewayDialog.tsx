import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  Loader2,
  Network,
  Orbit,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  SkipForward,
  SlidersHorizontal,
  Terminal,
  XCircle
} from 'lucide-react'
import type { KeyEntry } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Switch } from '@/components/ui/controls'
import { gatewayPayload, newGatewayKey, useSettings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { api, post } from '@/lib/api'
import { cn } from '@/lib/utils'

type Provider = KeyEntry['provider']
type Mode = 'spread' | 'rotate' | 'adaptive'

interface KeySnap {
  id: string
  provider: Provider
  coolMs: number
  calls: number
  ok: number
  fail: number
  totalMs: number
  lastMs: number
  inFlight: number
  lastUsed: number
  lastError?: string
}
interface CallRec {
  at: number
  keyId: string
  provider: Provider
  model: string
  ok: boolean
  ms: number
  error?: string
  source: string
}
interface GwState {
  mode: Mode
  keys: KeySnap[]
  telemetry: CallRec[]
  gateway: { enabled: boolean; port: number; listening: boolean; error: string; served: number }
}
type Probe = Record<string, { ok: boolean; detail: string; ms: number }>

const PROVIDER: Record<Provider, { name: string; tone: string }> = {
  gemini: { name: 'Gemini', tone: 'text-sky-300 border-sky-400/40 bg-sky-400/10' },
  claude: { name: 'Claude', tone: 'text-orange-300 border-orange-400/40 bg-orange-400/10' },
  openrouter: { name: 'OpenRouter', tone: 'text-violet-300 border-violet-400/40 bg-violet-400/10' },
  codecraft: { name: 'CodeCraft', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' }
}

const sec = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`)
const dur = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

type NodeState = 'busy' | 'cooling' | 'error' | 'ready'
function nodeState(k: KeySnap, probe?: { ok: boolean }): NodeState {
  if (k.inFlight > 0) return 'busy'
  if (k.coolMs > 0) return 'cooling'
  if (probe && !probe.ok) return 'error'
  return 'ready'
}
const STATE_STYLE: Record<NodeState, { card: string; dot: string; line: string }> = {
  busy: { card: 'border-sky-400/80 bg-sky-500/15 shadow-[0_0_24px_-4px_rgba(56,189,248,0.6)]', dot: 'bg-sky-400 animate-pulse', line: '#38bdf8' },
  cooling: { card: 'border-rose-400/70 bg-rose-500/10', dot: 'bg-rose-400', line: '#fb7185' },
  error: { card: 'border-red-500/80 bg-red-500/15', dot: 'bg-red-500', line: '#ef4444' },
  ready: { card: 'border-slate-500/50 bg-slate-800/60', dot: 'bg-slate-400', line: '#64748b' }
}

function Stat({ icon: Icon, label, children, tone }: { icon: typeof Server; label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="studio-label">{label}</div>
        <div className="mt-1 truncate text-[15px] font-semibold tabular-nums tracking-tight">{children}</div>
      </div>
      <Icon className={cn('size-4 shrink-0', tone ?? 'text-primary')} />
    </div>
  )
}

/** Keys orbiting the routing core; dashed animated links show requests in flight. */
function OrbitView({ keys, labels, probe, mode, selected, onSelect, hide }: { keys: KeySnap[]; labels: Map<string, KeyEntry>; probe: Probe; mode: Mode; selected: string | null; onSelect: (id: string) => void; hide: boolean }) {
  const { t } = useTranslation()
  const inFlight = keys.reduce((a, k) => a + k.inFlight, 0)
  const pos = keys.map((_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, keys.length)
    const r = keys.length > 8 ? 40 : 36
    return { x: 50 + r * Math.cos(a) * 0.95, y: 50 + r * Math.sin(a) * 1.05 }
  })
  return (
    <div className="relative h-[380px] overflow-hidden rounded-xl border border-slate-800 bg-[radial-gradient(ellipse_at_center,#0f1b3d_0%,#060a17_70%)] text-slate-100">
      <div className="absolute left-3 top-2.5 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-sky-200/80">
        <Orbit className="size-3.5" /> {t('gw.orbit', 'Observatory orbit')} · {keys.length} {t('gw.keys', 'keys')} · {inFlight} {t('gw.inFlight', 'in flight')}
      </div>
      <div className="absolute right-3 top-2.5 font-mono text-xs text-slate-400">{t('gw.clickNode', 'Click any orbiting key to inspect')}</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {[22, 34, 44].map((r) => (
          <ellipse key={r} cx="50" cy="50" rx={r} ry={r * 1.05} fill="none" stroke="#1e3a8a" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {keys.map((k, i) => {
          const st = nodeState(k, probe[k.id])
          return (
            <line
              key={k.id}
              x1="50"
              y1="50"
              x2={pos[i].x}
              y2={pos[i].y}
              stroke={STATE_STYLE[st].line}
              strokeOpacity={st === 'ready' ? 0.35 : 0.9}
              strokeWidth={st === 'busy' ? 2 : 1}
              strokeDasharray={st === 'busy' ? '6 5' : st === 'ready' ? '2 6' : undefined}
              vectorEffect="non-scaling-stroke"
              className={st === 'busy' ? 'animate-flow' : undefined}
            />
          )
        })}
      </svg>
      {/* core */}
      <div className="absolute left-1/2 top-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-sky-400/70 bg-[#0b1430] shadow-[0_0_50px_-6px_rgba(56,189,248,0.55)]">
        <div className="absolute inset-2 rounded-full border border-dashed border-sky-400/40" style={{ animation: 'spin 18s linear infinite' }} />
        <div className="text-center leading-tight">
          <div className="text-sm font-bold tracking-widest">CORE</div>
          <div className="font-mono text-[11px] text-sky-300">
            {inFlight} {t('gw.inFlightShort', 'IN FLIGHT')}
          </div>
          <div className="text-[11px] capitalize text-slate-400">{mode === 'spread' ? 'Dynamic' : mode === 'rotate' ? 'Sequential' : 'Adaptive'}</div>
        </div>
      </div>
      {keys.map((k, i) => {
        const st = nodeState(k, probe[k.id])
        const meta = labels.get(k.id)
        const name = hide ? `${PROVIDER[k.provider].name} #${i + 1}` : meta?.label || meta?.masked || k.id.slice(0, 8)
        return (
          <button
            key={k.id}
            onClick={() => onSelect(k.id)}
            style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}
            className={cn(
              'absolute w-[188px] -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2.5 py-1.5 text-left backdrop-blur transition-transform hover:scale-105',
              STATE_STYLE[st].card,
              selected === k.id && 'ring-2 ring-white/70'
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn('size-2 shrink-0 rounded-full', STATE_STYLE[st].dot)} />
              <span className="truncate font-mono text-xs font-semibold">{name}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-slate-400">
              <span className={cn('rounded border px-1', PROVIDER[k.provider].tone)}>{PROVIDER[k.provider].name}</span>
              {st === 'cooling' ? (
                <span className="text-rose-300">{dur(k.coolMs)}</span>
              ) : st === 'busy' ? (
                <span className="text-sky-300">
                  {k.inFlight} {t('gw.live', 'live')}
                </span>
              ) : (
                <span>
                  {k.ok}/{k.calls} ok{k.ok ? ` · ${sec(k.totalMs / k.ok)}` : ''}
                </span>
              )}
            </div>
          </button>
        )
      })}
      {!keys.length && (
        <div className="absolute inset-x-0 bottom-10 text-center text-sm text-slate-400">{t('gw.noKeys', 'No API keys yet — add some in Settings → API Keys.')}</div>
      )}
    </div>
  )
}

export function GatewayDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const setUi = useUi((s) => s.set)
  const s = useSettings()
  const [state, setState] = useState<GwState | null>(null)
  const [labels, setLabels] = useState<Map<string, KeyEntry>>(new Map())
  const [tab, setTab] = useState<'matrix' | 'keys' | 'gateway' | 'telemetry'>('matrix')
  const [selected, setSelected] = useState<string | null>(null)
  const [probe, setProbe] = useState<Probe>({})
  const [probing, setProbing] = useState(false)
  const [hide, setHide] = useState(false)
  const [guide, setGuide] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const load = useCallback(() => api<GwState>('/gateway/state').then(setState).catch(() => {}), [])
  useEffect(() => {
    load()
    window.api.keys.list().then((l) => setLabels(new Map(l.map((k) => [k.id, k]))))
    const id = setInterval(load, 1500)
    return () => clearInterval(id)
  }, [load])

  const keys = state?.keys ?? []
  const tele = state?.telemetry ?? []
  const gw = state?.gateway
  const url = `http://127.0.0.1:${s.gatewayPort}/v1`

  const totals = useMemo(() => {
    const calls = keys.reduce((a, k) => a + k.calls, 0)
    const ok = keys.reduce((a, k) => a + k.ok, 0)
    const ms = keys.reduce((a, k) => a + k.totalMs, 0)
    return {
      calls,
      rate: calls ? Math.round((100 * ok) / calls) : 100,
      avg: ok ? ms / ok : 0,
      inFlight: keys.reduce((a, k) => a + k.inFlight, 0),
      cooling: keys.filter((k) => k.coolMs > 0).length,
      failed: keys.filter((k) => probe[k.id] && !probe[k.id].ok).length,
      ready: keys.filter((k) => k.coolMs <= 0).length
    }
  }, [keys, probe])

  const setMode = (mode: Mode) => {
    s.set({ routeMode: mode })
    post('/gateway/mode', { mode }).then(load).catch((e: Error) => toast.error(e.message))
  }
  const runProbe = async () => {
    setProbing(true)
    try {
      const r = await post<{ results: Array<{ id: string; ok: boolean; detail: string; ms: number }> }>('/gateway/probe', {})
      setProbe(Object.fromEntries(r.results.map((x) => [x.id, x])))
      const bad = r.results.filter((x) => !x.ok).length
      if (bad) toast.warning(t('gw.probeBad', '{{bad}} of {{n}} keys failed the health check', { bad, n: r.results.length }))
      else toast.success(t('gw.probeOk', 'All {{n}} keys are healthy', { n: r.results.length }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setProbing(false)
    }
  }
  const uncool = (id: string) => post('/gateway/uncool', { id }).then(load)
  const pushGateway = (patch: Partial<{ gatewayEnabled: boolean; gatewayPort: number; gatewayKey: string }>) => {
    const next = { ...patch }
    if (next.gatewayEnabled && !useSettings.getState().gatewayKey && !next.gatewayKey) next.gatewayKey = newGatewayKey()
    s.set(next)
    post<GwState['gateway']>('/gateway/config', gatewayPayload())
      .then((g) => {
        if (g.error) toast.error(g.error)
        else if (next.gatewayEnabled) toast.success(t('gw.started', 'Gateway online at {{url}}', { url: `http://127.0.0.1:${g.port}/v1` }))
        load()
      })
      .catch((e: Error) => toast.error(e.message))
  }
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(t('gw.copied', '{{what}} copied', { what })))

  const sel = keys.find((k) => k.id === selected)
  const selMeta = sel ? labels.get(sel.id) : undefined
  const modeName = { spread: 'Dynamic Spread', rotate: 'Sequential Rotation', adaptive: 'Adaptive Capacity' }[s.routeMode]
  const curl = `curl ${url}/chat/completions \\\n  -H "Authorization: Bearer ${showKey ? s.gatewayKey || '<key>' : 'kd-••••'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"auto","messages":[{"role":"user","content":"Translate to Khmer: Hello"}]}'`

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[94vh] w-[min(1240px,97vw)] flex-col overflow-hidden p-0">
        {/* header */}
        <div className="flex flex-col gap-3 border-b p-4 pr-12">
          <div className="flex items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-primary-foreground shadow-md shadow-primary/30">
              <Network className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-lg font-bold tracking-tight">{t('gw.title', 'AI Gateway')}</DialogTitle>
                <span className="chip border-primary/30 bg-primary/10 font-mono text-[11px] text-primary">{t('gw.badge', 'Key Pool Router')}</span>
                <span className={cn('chip font-mono text-[11px]', gw?.listening ? 'border-success/40 bg-success/10 text-success' : 'text-muted-foreground')}>
                  <span className={cn('size-1.5 rounded-full', gw?.listening ? 'bg-success' : 'bg-muted-foreground')} /> {url}
                </span>
                <button className="chip hover:bg-accent" onClick={() => copy(url, 'URL')}>
                  <Copy className="size-3" /> {t('gw.copyUrl', 'Copy URL')}
                </button>
              </div>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                {t('gw.desc', 'Routes every AI request across your own API keys, with live health, cooldowns and an optional OpenAI-compatible /v1 endpoint for other tools.')}
              </DialogDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border bg-muted p-0.5">
              {(
                [
                  ['rotate', t('gw.mRotate', 'Sequential Rotation')],
                  ['adaptive', t('gw.mAdaptive', 'Adaptive Capacity')],
                  ['spread', t('gw.mSpread', 'Dynamic Spread')]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn('rounded-md px-3 py-1 text-xs font-medium', s.routeMode === id ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className={cn('chip py-1', gw?.listening ? 'border-success/40 bg-success/10 text-success' : '')}>
              <ShieldCheck className="size-3.5" /> {gw?.listening ? t('gw.engineOn', 'Gateway online') : t('gw.engineInApp', 'In-app routing')}
            </span>
            <Button variant="outline" size="sm" onClick={runProbe} disabled={probing || !keys.length}>
              {probing ? <Loader2 className="animate-spin" /> : <Play />} {t('gw.probe', 'Health Probe')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => keys.filter((k) => k.coolMs > 0).forEach((k) => uncool(k.id))} disabled={!totals.cooling}>
              <SkipForward /> {t('gw.skipAll', 'Skip cooldowns')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onClose()
                setUi({ settings: 'apiKeys' })
              }}
            >
              <Plus /> {t('gw.addKey', 'Add API key')}
            </Button>
            <Button variant="soft" size="sm" onClick={() => setGuide(!guide)}>
              <BookOpen /> {t('gw.guide', 'Guide')}
            </Button>
          </div>
          {guide && (
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
              <div>
                <b>{t('gw.mRotate', 'Sequential Rotation')}</b> — {t('gw.gRotate', 'stays on one key until it hits a limit or fails, then moves to the next. Easiest on per-minute limits.')}
              </div>
              <div>
                <b>{t('gw.mAdaptive', 'Adaptive Capacity')}</b> — {t('gw.gAdaptive', 'picks the key with the best success rate and speed and the fewest requests running.')}
              </div>
              <div>
                <b>{t('gw.mSpread', 'Dynamic Spread')}</b> — {t('gw.gSpread', 'round-robin: every ready key takes turns. Fastest for big parallel batches.')}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* stats */}
          <div className="mb-3 grid grid-cols-5 gap-2">
            <Stat icon={Server} label={t('gw.sDaemon', 'Gateway daemon')} tone={gw?.listening ? 'text-success' : 'text-muted-foreground'}>
              {gw?.listening ? `Online :${gw.port}` : gw?.error ? <span className="text-destructive">{gw.error}</span> : t('gw.off', 'Off (in-app only)')}
            </Stat>
            <Stat icon={KeyRound} label={t('gw.sPool', 'Key pool')}>
              {totals.ready}/{keys.length} {t('gw.ready', 'ready')}
              {totals.cooling > 0 && <span className="text-rose-500"> · {totals.cooling} {t('gw.cooling', 'cooling')}</span>}
              {totals.failed > 0 && <span className="text-destructive"> · {totals.failed} {t('gw.failed', 'failed')}</span>}
            </Stat>
            <Stat icon={Cpu} label={t('gw.sWorkers', 'In flight')}>
              {totals.inFlight} {t('gw.requests', 'requests')}
            </Stat>
            <Stat icon={Gauge} label={t('gw.sSla', 'Throughput & SLA')}>
              {totals.calls} req · {totals.rate}% · {totals.avg ? sec(totals.avg) : '–'}
            </Stat>
            <Stat icon={SlidersHorizontal} label={t('gw.sEngine', 'Routing engine')}>
              {modeName}
            </Stat>
          </div>

          {/* tabs */}
          <div className="mb-3 flex items-center gap-1 border-b">
            {(
              [
                ['matrix', Orbit, t('gw.tMatrix', 'Routing matrix'), `${totals.ready}/${keys.length}`],
                ['keys', KeyRound, t('gw.tKeys', 'Connected keys'), String(keys.length)],
                ['gateway', Server, t('gw.tGateway', 'Gateway & runtime'), ''],
                ['telemetry', Terminal, t('gw.tTele', 'Live telemetry'), String(tele.length)]
              ] as const
            ).map(([id, Icon, label, n]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium', tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
              >
                <Icon className="size-3.5" /> {label}
                {n && <span className="rounded-full bg-secondary px-1.5 font-mono text-[11px]">{n}</span>}
              </button>
            ))}
            <button className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent" onClick={() => setHide(!hide)}>
              {hide ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} {hide ? t('gw.showNames', 'Show names') : t('gw.hideNames', 'Mask names')}
            </button>
          </div>

          {tab === 'matrix' && (
            <OrbitView keys={keys} labels={labels} probe={probe} mode={s.routeMode} selected={selected} onSelect={setSelected} hide={hide} />
          )}

          {tab === 'keys' && (
            <div className="grid grid-cols-3 gap-2">
              {keys.map((k, i) => {
                const st = nodeState(k, probe[k.id])
                const meta = labels.get(k.id)
                return (
                  <button key={k.id} onClick={() => setSelected(k.id)} className={cn('flex flex-col gap-1.5 rounded-xl border bg-card p-3 text-left hover:border-primary/50', selected === k.id && 'ring-2 ring-primary/40')}>
                    <div className="flex items-center gap-2">
                      <span className={cn('size-2 rounded-full', STATE_STYLE[st].dot)} />
                      <span className="truncate font-mono text-xs font-semibold">{hide ? `${PROVIDER[k.provider].name} #${i + 1}` : meta?.label || meta?.masked}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{PROVIDER[k.provider].name}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${k.calls ? (100 * k.ok) / k.calls : 0}%` }} />
                    </div>
                    <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                      <span>
                        {k.ok}/{k.calls} ok
                      </span>
                      <span>{k.ok ? sec(k.totalMs / k.ok) : '–'}</span>
                      <span className={cn(st === 'cooling' && 'text-rose-500', st === 'busy' && 'text-primary')}>
                        {st === 'cooling' ? dur(k.coolMs) : st === 'busy' ? `${k.inFlight} live` : probe[k.id] ? (probe[k.id].ok ? '✓ healthy' : '✗ failed') : 'ready'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {tab === 'gateway' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-3 rounded-xl border p-4">
                <Switch checked={s.gatewayEnabled} onChange={(v) => pushGateway({ gatewayEnabled: v })} label={<span className="font-medium">{t('gw.enable', 'Local OpenAI-compatible endpoint (/v1)')}</span>} />
                <p className="text-xs text-muted-foreground">
                  {t('gw.enableHint', 'Lets other apps on this PC (scripts, chat tools, n8n…) use your keys through the same router. It listens on 127.0.0.1 only and needs the gateway key below.')}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  {t('gw.port', 'Port')}
                  <Input
                    type="number"
                    className="w-28"
                    defaultValue={s.gatewayPort}
                    onBlur={(e) => {
                      const p = Number(e.target.value)
                      if (p !== s.gatewayPort) pushGateway({ gatewayPort: p })
                    }}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-sm">{t('gw.key', 'Gateway key')}</span>
                  <div className="flex gap-1">
                    <Input readOnly className="flex-1 font-mono text-xs" value={s.gatewayKey ? (showKey ? s.gatewayKey : `kd-${'•'.repeat(20)}`) : t('gw.noKey', '(created when you turn the gateway on)')} />
                    <Button variant="outline" size="icon" onClick={() => setShowKey(!showKey)} disabled={!s.gatewayKey}>
                      {showKey ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => copy(s.gatewayKey, 'Key')} disabled={!s.gatewayKey}>
                      <Copy />
                    </Button>
                    <Button variant="outline" size="icon" title={t('gw.regen', 'New key (old one stops working)')} onClick={() => pushGateway({ gatewayKey: newGatewayKey() })}>
                      <RefreshCw />
                    </Button>
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-2 text-xs">
                  <div className="studio-label mb-1">{t('gw.routing', 'Model routing')}</div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
                    <span>auto</span> <span className="text-muted-foreground">→ {s.geminiModel} (first provider with keys)</span>
                    <span>gemini-*</span> <span className="text-muted-foreground">→ Gemini keys</span>
                    <span>claude-*</span> <span className="text-muted-foreground">→ Claude keys</span>
                    <span>vendor/model</span> <span className="text-muted-foreground">→ OpenRouter keys</span>
                    <span>codecraft:model</span> <span className="text-muted-foreground">→ CodeCraft keys</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="studio-label">{t('gw.example', 'Try it')}</span>
                  <button className="chip hover:bg-accent" onClick={() => copy(curl.replace('kd-••••', s.gatewayKey), 'curl')}>
                    <Copy className="size-3" /> curl
                  </button>
                </div>
                <pre className="select-text whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-emerald-300">{curl}</pre>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border p-2">
                    <div className="studio-label">{t('gw.status', 'Status')}</div>
                    <div className={cn('font-semibold', gw?.listening ? 'text-success' : 'text-muted-foreground')}>{gw?.listening ? t('gw.online', 'Online') : t('gw.offline', 'Offline')}</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="studio-label">{t('gw.served', 'Served')}</div>
                    <div className="font-mono font-semibold">{gw?.served ?? 0}</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="studio-label">{t('gw.endpoints', 'Endpoints')}</div>
                    <div className="font-mono text-[11px]">/v1/models · /v1/chat/completions</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'telemetry' && (
            <div className="overflow-hidden rounded-xl border">
              <div className="grid grid-cols-[90px_1fr_110px_1.4fr_70px_70px] gap-2 border-b bg-muted px-3 py-1.5 studio-label">
                <span>{t('gw.cTime', 'Time')}</span>
                <span>{t('gw.cKey', 'Key')}</span>
                <span>{t('gw.cSource', 'Source')}</span>
                <span>{t('gw.cModel', 'Model')}</span>
                <span>{t('gw.cMs', 'Latency')}</span>
                <span>{t('gw.cResult', 'Result')}</span>
              </div>
              <div className="max-h-[360px] overflow-y-auto font-mono text-xs">
                {tele.map((c, i) => {
                  const meta = labels.get(c.keyId)
                  return (
                    <div key={i} className="grid grid-cols-[90px_1fr_110px_1.4fr_70px_70px] gap-2 border-b px-3 py-1 last:border-0 hover:bg-accent/50" title={c.error}>
                      <span className="text-muted-foreground">{new Date(c.at).toLocaleTimeString()}</span>
                      <span className="truncate">{hide ? PROVIDER[c.provider].name : meta?.label || meta?.masked || c.keyId.slice(0, 8)}</span>
                      <span className={cn(c.source === 'gateway' ? 'text-primary' : 'text-muted-foreground')}>{c.source}</span>
                      <span className="truncate">{c.model}</span>
                      <span>{sec(c.ms)}</span>
                      <span className={c.ok ? 'text-success' : 'text-destructive'}>{c.ok ? 'ok' : c.error?.match(/\b[45]\d\d\b/)?.[0] ?? 'error'}</span>
                    </div>
                  )
                })}
                {!tele.length && <div className="p-4 text-center text-xs text-muted-foreground">{t('gw.noCalls', 'No AI calls yet — they appear here live.')}</div>}
              </div>
            </div>
          )}

          {/* inspector */}
          {sel && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-xs">
              {(() => {
                const st = nodeState(sel, probe[sel.id])
                return (
                  <span
                    className={cn(
                      'chip',
                      st === 'cooling' || st === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : st === 'busy' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-success/40 bg-success/10 text-success'
                    )}
                  >
                    {st === 'cooling' ? `${t('gw.coolingFor', 'Cooling')} ${dur(sel.coolMs)}` : st === 'error' ? t('gw.failed', 'failed') : st === 'busy' ? t('gw.busy', 'Busy') : t('gw.ready', 'ready')}
                  </span>
                )
              })()}
              <span className="font-mono font-semibold">{hide ? PROVIDER[sel.provider].name : selMeta?.label || selMeta?.masked}</span>
              <span className="chip">{PROVIDER[sel.provider].name}</span>
              <span className="text-muted-foreground">
                {sel.ok}/{sel.calls} ok · {sel.fail} {t('gw.fails', 'fails')} · {t('gw.last', 'last')} {sel.lastMs ? sec(sel.lastMs) : '–'}
              </span>
              {probe[sel.id] && (
                <span className={cn('flex items-center gap-1', probe[sel.id].ok ? 'text-success' : 'text-destructive')}>
                  {probe[sel.id].ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} {probe[sel.id].detail}
                </span>
              )}
              {sel.lastError && (
                <span className="max-w-[40ch] truncate text-destructive" title={sel.lastError}>
                  {sel.lastError}
                </span>
              )}
              <div className="ml-auto flex gap-1">
                <Button variant="outline" size="sm" onClick={runProbe} disabled={probing}>
                  <Activity /> {t('gw.verify', 'Verify')}
                </Button>
                <Button variant="outline" size="sm" className="border-warning/50 text-warning" onClick={() => uncool(sel.id)} disabled={sel.coolMs <= 0}>
                  <SkipForward /> {t('gw.skip', 'Skip cooldown')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', totals.inFlight ? 'animate-pulse bg-primary' : 'bg-muted-foreground')} />
          {t('gw.footer', '{{n}} active request(s) via {{mode}}', { n: totals.inFlight, mode: modeName })}
          <span className="ml-auto font-mono">
            {totals.ready}/{keys.length} {t('gw.ready', 'ready')} · {totals.calls} {t('gw.calls', 'calls')} · {gw?.served ?? 0} {t('gw.servedShort', 'served via /v1')}
          </span>
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-success" style={{ width: `${totals.rate}%` }} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

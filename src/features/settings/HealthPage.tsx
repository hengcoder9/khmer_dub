import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { CheckDef, CheckResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type State = CheckResult | 'running'

function StatusIcon({ state }: { state: State | undefined }) {
  if (!state || state === 'running') return <Loader2 className="size-5 animate-spin text-muted-foreground" />
  switch (state.status) {
    case 'ok':
      return <CheckCircle2 className="size-5 text-success" />
    case 'warn':
      return <AlertTriangle className="size-5 text-warning" />
    case 'fail':
      return <XCircle className="size-5 text-destructive" />
    default:
      return <Clock className="size-5 text-muted-foreground" />
  }
}

export function HealthPage() {
  const { t } = useTranslation()
  const [defs, setDefs] = useState<CheckDef[]>([])
  const [results, setResults] = useState<Record<string, State>>({})
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const runAll = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const list = await api<CheckDef[]>('/health/checks')
      setDefs(list)
      const active = list.filter((d) => !d.phase)
      setResults(Object.fromEntries(active.map((d) => [d.id, 'running' as const])))
      await Promise.all(
        active.map(async (d) => {
          let r: CheckResult
          try {
            r = await api<CheckResult>(`/health/check/${d.id}`)
          } catch (e) {
            r = { id: d.id, status: 'fail', detail: (e as Error).message, ms: 0 }
          }
          setResults((prev) => ({ ...prev, [d.id]: r }))
        })
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    runAll()
  }, [runAll])

  const active = defs.filter((d) => !d.phase)
  const passed = active.filter((d) => {
    const r = results[d.id]
    return r && r !== 'running' && r.status !== 'fail'
  }).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="text-3xl font-semibold tabular-nums">
          {passed}
          <span className="text-muted-foreground">/{active.length || '–'}</span>
        </div>
        <div className="text-sm text-muted-foreground">{t('health.score')}</div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={runAll} disabled={running}>
          <RefreshCw className={cn(running && 'animate-spin')} />
          {t('health.runAgain')}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <XCircle className="size-5 text-destructive" />
          {t('health.backendDown')}: {error}
        </div>
      )}

      <ul className="flex flex-col divide-y rounded-md border">
        {defs.map((d) => {
          const state: State | undefined = d.phase ? { id: d.id, status: 'later', detail: '', ms: 0 } : results[d.id]
          const detail = d.phase
            ? t('common.comingInPhase', { phase: d.phase })
            : state && state !== 'running'
              ? state.detail
              : ''
          return (
            <li key={d.id} className={cn('flex items-center gap-3 px-3 py-2.5', d.phase && 'opacity-60')}>
              <StatusIcon state={state} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t(`health.items.${d.id}`, { defaultValue: d.label })}</div>
                {detail && <div className="whitespace-pre-wrap break-words text-xs text-muted-foreground" title={detail}>{detail}</div>}
              </div>
              {state && state !== 'running' && state.ms > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">{state.ms} ms</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

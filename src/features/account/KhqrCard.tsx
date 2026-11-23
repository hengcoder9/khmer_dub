import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import khqrLogo from '@/assets/images/KHQR_Logo.png'

/** Countdown ring like the KHQRcc page (full ring = full validity window). */
function Countdown({ expiresAt, totalMs }: { expiresAt: number; totalMs: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, expiresAt - now)
  const frac = Math.min(1, left / Math.max(1, totalMs))
  const r = 9
  const c = 2 * Math.PI * r
  const mm = Math.floor(left / 60_000)
  const ss = Math.floor((left % 60_000) / 1000)
  return (
    <div className="flex items-center gap-2 text-sm font-medium tabular-nums text-slate-800">
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="#22b8cf" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
      </svg>
      {left > 3600_000 ? `${Math.floor(left / 3600_000)}h ${String(mm % 60).padStart(2, '0')}m` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`}
    </div>
  )
}

/**
 * KHQR payment card styled like the KHQR standard / KHQRcc checkout:
 * red header with folded corner, merchant + amount, dashed tear line, QR with currency badge.
 */
export function KhqrCard({
  qr,
  merchant,
  amount,
  currency,
  expiresAt,
  createdAt,
  children
}: {
  /** QR image (data: URL or https URL); null shows `children` in the QR area */
  qr: string | null
  merchant: string
  amount: number
  currency: 'USD' | 'KHR'
  expiresAt: number
  createdAt: number
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const shown = currency === 'KHR' ? Math.round(amount).toLocaleString() : amount.toFixed(2)
  return (
    <div className="flex w-[300px] shrink-0 flex-col items-center gap-3 rounded-2xl bg-white px-5 pb-4 pt-4 text-slate-900 shadow-sm ring-1 ring-slate-200">
      <div className="flex w-full items-center justify-between">
        <span className="text-xl font-medium tracking-tight text-[#0b2a4f]">KHQRcc</span>
        <Countdown expiresAt={expiresAt} totalMs={Math.max(60_000, expiresAt - createdAt)} />
      </div>

      <div className="w-full overflow-hidden rounded-[22px] bg-white shadow-[0_6px_24px_-6px_rgba(15,23,42,0.25)]">
        {/* red header with the folded top-right corner */}
        <div className="relative grid h-12 place-items-center bg-[#e1232e] text-white">
          <img src={khqrLogo} alt="KHQR" className="h-6 w-auto select-none" draggable={false} />
          {/* KHQR tail: the header's bottom-right corner folds down into the white body */}
          <span className="absolute -bottom-[22px] right-0 size-0 border-b-[22px] border-r-[22px] border-b-transparent border-r-[#e1232e]" />
        </div>

        <div className="px-6 pb-5 pt-7">
          <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-700">{merchant}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{shown}</span>
            <span className="text-[11px] font-medium text-slate-500">{currency}</span>
          </div>
        </div>

        {/* tear line with side notches */}
        <div className="border-t border-dashed border-slate-400" />

        <div className="relative grid place-items-center px-4 py-5">
          {qr ? (
            <>
              <img src={qr} alt="KHQR" className="size-[210px] object-contain [image-rendering:pixelated]" />
              <span className="absolute grid size-9 place-items-center rounded-full bg-black text-base font-bold text-white ring-4 ring-white">
                {currency === 'KHR' ? '៛' : '$'}
              </span>
            </>
          ) : (
            <div className="grid min-h-[210px] w-full place-items-center">{children}</div>
          )}
        </div>
      </div>

      <p className="px-4 text-center text-[13px] leading-snug text-slate-400">{t('acct.scanWith', 'Scan with ABA Mobile, or other Mobile Banking App supporting KHQR')}</p>
    </div>
  )
}

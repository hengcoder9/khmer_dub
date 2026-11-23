import { useTranslation } from 'react-i18next'
import { Clapperboard, Rows3 } from 'lucide-react'
import { TopBar } from './TopBar'
import { Footer } from './Footer'
import { VideoPlayer } from '@/features/player/VideoPlayer'
import { ToolButtons } from '@/features/player/ToolButtons'
import { SegmentGrid } from '@/features/grid/SegmentGrid'
import { EditorPanel } from '@/features/editor/EditorPanel'
import { Timeline } from '@/features/timeline/Timeline'
import { ActionRow } from '@/features/timeline/ActionRow'
import { useUi } from '@/store/ui'
import { useSettings } from '@/store/settings'
import { cn } from '@/lib/utils'

export function Layout() {
  const { t } = useTranslation()
  const tab = useUi((s) => s.centerTab)
  const set = useUi((s) => s.set)
  const big = useSettings((s) => s.bigPlayer)
  const playerWidth = useSettings((s) => s.playerWidth)

  return (
    <div className="flex h-full flex-col">
      <TopBar />

      <div className="flex min-h-0 flex-1 gap-2 p-2 pb-0">
        <aside
          className={cn('studio-card flex shrink-0 flex-col gap-3 overflow-y-auto p-3 transition-[width]', big && 'w-1/2')}
          style={big ? undefined : { width: playerWidth }}
        >
          <VideoPlayer />
          <ToolButtons />
        </aside>

        <main className="studio-card flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
            <div className="flex rounded-lg bg-muted p-0.5">
              {(
                [
                  ['dub', Rows3, t('tabs.dub', 'Dubbing lines')],
                  ['editor', Clapperboard, t('tabs.editor', 'AI Video Editor')]
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  onClick={() => set({ centerTab: id })}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors',
                    tab === id ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className={cn('size-4', tab === id && 'text-primary')} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1">{tab === 'dub' ? <SegmentGrid /> : <EditorPanel />}</div>
        </main>
      </div>

      <section className="studio-card m-2 mb-0 flex h-[280px] shrink-0 flex-col overflow-hidden">
        <Timeline />
        <ActionRow />
      </section>

      <Footer />
    </div>
  )
}

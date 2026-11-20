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

  return (
    <div className="flex h-full flex-col">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <aside className={cn('flex shrink-0 flex-col gap-3 overflow-y-auto border-r bg-card p-3 transition-[width]', big ? 'w-1/2' : 'w-[440px]')}>
          <VideoPlayer />
          <ToolButtons />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-end gap-1 border-b bg-card px-2">
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
                  'flex h-8 items-center gap-1.5 rounded-t-md border-x border-t px-3 text-sm',
                  tab === id ? 'bg-background font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{tab === 'dub' ? <SegmentGrid /> : <EditorPanel />}</div>
        </main>
      </div>

      <section className="flex h-[280px] shrink-0 flex-col border-t bg-card">
        <Timeline />
        <ActionRow />
      </section>

      <Footer />
    </div>
  )
}

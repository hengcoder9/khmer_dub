import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AudioLines, Clapperboard, Cpu, Crown, Film, FolderOpen, Home as HomeIcon, ImageIcon, Languages, LayoutGrid, Link2, Loader2, Mic2, MoreHorizontal, Pencil, Play, Plus, Search, Settings, Sparkles, Trash2, Wand2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { APP_NAME } from '@shared/types'
import { DisplayPopover } from '@/features/display/DisplayPopover'
import { useSettings } from '@/store/settings'
import { openProject } from '@/store/project'
import { useUi, type HomeIntent } from '@/store/ui'
import { hasAccess, useAccount } from '@/store/account'
import { pickAndOpenProject } from '@/components/TopBar'
import { post } from '@/lib/api'
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/controls'
import { cn, formatTime } from '@/lib/utils'

interface ProjectCard {
  dir: string
  name: string
  episodes: number
  durationSec: number
  updatedAt: number
  thumb: string | null
  aspect: number
}

const dur = (s: number) => (s ? formatTime(s).slice(s >= 3600 ? 0 : 3, 8) : '—')

/** Start screen: create, quick AI tools and all your projects with thumbnails. */
export function Home() {
  const { t } = useTranslation()
  const recent = useSettings((s) => s.recent)
  const { lang, setLang } = useSettings()
  const setUi = useUi((s) => s.set)
  const [projects, setProjects] = useState<ProjectCard[] | null>(null)
  const [root, setRoot] = useState('')
  const [q, setQ] = useState('')
  const [opening, setOpening] = useState<string | null>(null)

  const load = () =>
    post<{ root: string; projects: ProjectCard[] }>('/projects/list', { dirs: useSettings.getState().recent.map((r) => r.dir) })
      .then((r) => {
        setProjects(r.projects)
        setRoot(r.root)
      })
      .catch(() => setProjects([]))
  useEffect(() => {
    void load()
  }, [recent])

  const rename = async (p: ProjectCard, name: string) => {
    const n = name.trim()
    if (!n || n === p.name) return
    try {
      await post('/projects/rename', { dir: p.dir, name: n })
      const st = useSettings.getState()
      st.set({ recent: st.recent.map((r) => (r.dir === p.dir ? { ...r, name: n } : r)) })
      setProjects((list) => list?.map((x) => (x.dir === p.dir ? { ...x, name: n } : x)) ?? null)
      toast.success(t('home.renamed', 'Renamed to “{{name}}”', { name: n }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const remove = async (p: ProjectCard) => {
    if (!confirm(t('home.deleteConfirm', 'Delete the project “{{name}}”?\n\nIts folder (lines, dubbed voices, exports) goes to the Recycle Bin — you can restore it from there. Your original video files outside the project folder are not touched.', { name: p.name }))) return
    try {
      await window.api.trashProject(p.dir)
      const st = useSettings.getState()
      st.set({ recent: st.recent.filter((r) => r.dir !== p.dir) })
      setProjects((list) => list?.filter((x) => x.dir !== p.dir) ?? null)
      toast.success(t('home.deleted', '“{{name}}” moved to the Recycle Bin', { name: p.name }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const open = async (dir: string) => {
    setUi({ intent: null })
    setOpening(dir)
    try {
      const r = await openProject(dir)
      useSettings.getState().addRecent({ name: r.project.name, dir: r.dir })
    } catch (e) {
      toast.error((e as Error).message)
      useSettings.getState().set({ recent: useSettings.getState().recent.filter((x) => x.dir !== dir) })
    } finally {
      setOpening(null)
    }
  }
  /** a tool that lives inside a project: make the project first, then jump to the tool */
  const start = (intent: HomeIntent | null) => setUi({ dialog: 'newProject', intent })

  const shown = useMemo(() => (projects ?? []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q])

  const tools: Array<{ icon: LucideIcon; title: string; desc: string; badge?: string; run: () => void }> = [
    { icon: Mic2, title: t('home.tDub', 'Dub a video'), desc: t('home.tDubD', 'Khmer voices, subtitles & translation'), run: () => start(null) },
    { icon: Film, title: t('home.tAiVideo', 'AI Video'), desc: t('home.tAiVideoD', 'Turn an idea into a video'), badge: 'Gemini', run: () => start('ai-video') },
    { icon: Clapperboard, title: t('home.tShorts', 'Long video to shorts'), desc: t('home.tShortsD', 'Shorts, trailer & recap'), run: () => start('ai-creator') },
    { icon: ImageIcon, title: t('home.tThumb', 'AI thumbnail'), desc: t('home.tThumbD', 'Click-worthy covers'), run: () => start('ai-creator') },
    { icon: Wand2, title: t('home.tClaude', 'Claude Video'), desc: t('home.tClaudeD', 'Story video from a topic'), run: () => start('claude-video') }
  ]

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ───────── sidebar ───────── */}
      <aside className="flex w-60 shrink-0 flex-col gap-1 border-r bg-card/40 p-3">
        <div className="mb-2 flex items-center gap-2 px-2 py-1">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-primary-foreground shadow-md shadow-primary/30">
            <AudioLines className="size-4" />
          </span>
          <span className="truncate text-sm font-bold tracking-tight">{APP_NAME}</span>
        </div>
        <AccountCard />
        <nav className="mt-2 flex flex-col gap-0.5">
          <NavItem icon={HomeIcon} label={t('home.home', 'Home')} active onClick={() => document.getElementById('home-top')?.scrollIntoView({ behavior: 'smooth' })} />
          <NavItem icon={LayoutGrid} label={t('home.projects', 'Projects')} onClick={() => document.getElementById('home-projects')?.scrollIntoView({ behavior: 'smooth' })} />
        </nav>
        <div className="mt-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('home.createAi', 'Create with AI')}</div>
        <nav className="flex flex-col gap-0.5">
          <NavItem icon={Film} label={t('home.tAiVideo', 'AI Video')} onClick={() => start('ai-video')} />
          <NavItem icon={Wand2} label={t('home.tClaude', 'Claude Video')} onClick={() => start('claude-video')} />
          <NavItem icon={Clapperboard} label={t('home.tShortsNav', 'Shorts & thumbnails')} onClick={() => start('ai-creator')} />
        </nav>
        <div className="mt-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('home.more', 'More tools')}</div>
        <nav className="flex flex-col gap-0.5">
          <NavItem icon={Link2} label={t('home.fromLink', 'Import from a link')} onClick={() => start('link')} />
          <NavItem icon={FolderOpen} label={t('home.openDisk', 'Open from disk')} onClick={pickAndOpenProject} />
          <NavItem icon={Cpu} label={t('home.engines', 'AI engines')} onClick={() => setUi({ settings: 'engines' })} />
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-1 border-t pt-2">
          <button className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setUi({ settings: 'general' })}>
            <Settings className="size-4" /> {t('home.settings', 'Settings')}
          </button>
          <button className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setLang(lang === 'en' ? 'km' : 'en')} title={t('home.lang', 'Language')}>
            <Languages className="mr-1 inline size-3.5" />
            {lang === 'en' ? 'ខ្មែរ' : 'EN'}
          </button>
          <DisplayPopover />
        </div>
      </aside>

      {/* ───────── main ───────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div id="home-top" className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
          {/* create */}
          <button
            onClick={() => start(null)}
            className="group relative flex h-40 items-center justify-center gap-4 overflow-hidden rounded-2xl bg-brand text-primary-foreground shadow-xl shadow-primary/20 transition hover:shadow-primary/40"
          >
            <span className="absolute -left-10 -top-16 size-64 rounded-full bg-white/15 blur-3xl transition group-hover:scale-110" />
            <span className="absolute -bottom-20 right-10 size-72 rounded-full bg-black/10 blur-3xl" />
            <span className="relative grid size-12 place-items-center rounded-xl bg-white/90 text-primary shadow-lg transition group-hover:scale-105">
              <Plus className="size-7" strokeWidth={2.5} />
            </span>
            <span className="relative text-left">
              <span className="block text-2xl font-bold tracking-tight">{t('home.create', 'Create project')}</span>
              <span className="block text-sm text-white/80">{t('home.createHint', 'One video, or a whole series (E01, E02…)')}</span>
            </span>
          </button>

          {/* quick tools */}
          <div className="grid grid-cols-5 gap-3">
            {tools.map((x) => (
              <button key={x.title} onClick={x.run} className="studio-card group relative flex flex-col items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/50">
                {x.badge && <span className="absolute right-3 top-3 rounded-full border border-primary/40 px-1.5 text-[10px] font-semibold text-primary">{x.badge}</span>}
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                  <x.icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{x.title}</span>
                  <span className="block text-xs text-muted-foreground">{x.desc}</span>
                </span>
              </button>
            ))}
          </div>

          {/* projects */}
          <section id="home-projects" className="flex scroll-mt-4 flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{t('home.projects', 'Projects')}</h2>
              {projects && <span className="text-xs text-muted-foreground">{projects.length}</span>}
              <div className="flex-1" />
              <label className="flex h-8 items-center gap-1.5 rounded-md border bg-card px-2 text-sm">
                <Search className="size-3.5 text-muted-foreground" />
                <input className="w-44 bg-transparent outline-none placeholder:text-muted-foreground" placeholder={t('home.search', 'Search projects')} value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <button className="flex h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-sm hover:bg-accent" onClick={pickAndOpenProject}>
                <FolderOpen className="size-3.5" /> {t('home.openDisk', 'Open from disk')}
              </button>
            </div>
            {!projects ? (
              <div className="grid h-40 place-items-center">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : !shown.length ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
                <Sparkles className="size-6 text-primary" />
                <div className="text-sm font-medium">{q ? t('home.noMatch', 'No project matches') : t('home.empty', 'No projects yet')}</div>
                {!q && <div className="text-xs text-muted-foreground">{t('home.emptyHint', 'Press “Create project” and pick a video to start.')}</div>}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
                {shown.map((p) => (
                  <ProjectTile key={p.dir} p={p} busy={opening === p.dir} disabled={!!opening} onOpen={() => open(p.dir)} onRename={(n) => rename(p, n)} onDelete={() => remove(p)} />
                ))}
              </div>
            )}
            {root && <p className="text-[11px] text-muted-foreground">{t('home.folder', 'Projects folder: {{dir}}', { dir: root })}</p>}
          </section>
        </div>
      </main>
    </div>
  )
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm', active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
      <Icon className="size-4" /> {label}
    </button>
  )
}

/** Sign in / plan at the top of the sidebar. */
function AccountCard() {
  const { t } = useTranslation()
  const { loaded, signedIn, user, access } = useAccount()
  const setUi = useUi((s) => s.set)
  const ok = hasAccess()
  const pro = access?.kind === 'paid' || access?.kind === 'lifetime'
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-2.5">
      <button className="flex items-center gap-2 text-left" onClick={() => setUi({ dialog: 'account' })}>
        {user?.avatar ? (
          <img src={user.avatar} referrerPolicy="no-referrer" className="size-8 rounded-full object-cover" />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-bold">{signedIn && user ? (user.name || user.email).slice(0, 2).toUpperCase() : '?'}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{!loaded ? '…' : signedIn && user ? user.name : t('home.signIn', 'Sign in')}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {signedIn ? (pro ? access?.plan : ok ? t('home.trial', 'Free trial') : t('home.noPlan', 'No active plan')) : t('home.signInHint', 'Google, Telegram or email')}
          </span>
        </span>
      </button>
      {!pro && (
        <button
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
          onClick={() => setUi({ dialog: 'account' })}
        >
          <Crown className="size-3.5" /> {t('home.getPro', 'Get Pro')}
        </button>
      )}
    </div>
  )
}

function ProjectTile({ p, busy, disabled, onOpen, onRename, onDelete }: { p: ProjectCard; busy: boolean; disabled: boolean; onOpen: () => void; onRename: (name: string) => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.name)
  const done = (save: boolean) => {
    setEditing(false)
    if (save) onRename(name)
    else setName(p.name)
  }
  return (
    <div className="group relative flex min-w-0 flex-col gap-1.5" title={p.dir}>
      <button onClick={onOpen} disabled={disabled} className="relative aspect-square overflow-hidden rounded-xl border bg-muted text-left transition group-hover:border-primary/60 group-hover:shadow-lg group-hover:shadow-primary/10">
        {p.thumb ? (
          <img src={p.thumb} className="size-full object-cover transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-primary/20 to-transparent">
            <AudioLines className="size-8 text-primary/60" />
          </div>
        )}
        {p.episodes > 1 && <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{t('home.eps', '{{n}} episodes', { n: p.episodes })}</span>}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}
      </button>
      {/* ⋯ menu: open / rename / show in folder / delete */}
      <DropdownMenu>
        <DropdownTrigger asChild>
          <button
            className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/75 focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            title={t('home.menu', 'Project menu')}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownTrigger>
        <DropdownContent align="end">
          <DropdownItem onSelect={onOpen}>
            <Play className="size-4" /> {t('home.open', 'Open')}
          </DropdownItem>
          <DropdownItem onSelect={() => setTimeout(() => setEditing(true), 0)}>
            <Pencil className="size-4" /> {t('home.rename', 'Rename')}
          </DropdownItem>
          <DropdownItem onSelect={() => window.api.showInFolder(`${p.dir}\\project.json`)}>
            <FolderOpen className="size-4" /> {t('home.showFolder', 'Show in folder')}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
            <Trash2 className="size-4" /> {t('home.delete', 'Delete')}
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>
      {editing ? (
        <input
          autoFocus
          className="h-6 w-full min-w-0 rounded border border-primary bg-card px-1.5 text-sm font-medium outline-none"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => (e.key === 'Enter' ? done(true) : e.key === 'Escape' ? done(false) : undefined)}
          onBlur={() => done(true)}
        />
      ) : (
        <button className="w-full min-w-0 truncate text-left text-sm font-medium" onDoubleClick={() => setEditing(true)} onClick={onOpen} title={p.name}>
          {p.name}
        </button>
      )}
      <div className="truncate text-[11px] text-muted-foreground">
        {dur(p.durationSec)} · {new Date(p.updatedAt).toLocaleDateString()}
      </div>
    </div>
  )
}

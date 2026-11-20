// Project state: single source of truth, undo/redo (100 states), debounced autosave.

import { create } from 'zustand'
import type { Episode, MediaInfo, Project, Segment } from '@shared/types'
import { episodeLabel, newEpisode } from '@shared/defaults'
import { fullClip } from '@shared/ranges'
import { api, post } from '@/lib/api'

type Snapshot = Pick<Project, 'episodes' | 'cast' | 'glossary'>

interface ProjectState {
  dir: string | null
  project: Project | null
  activeId: string | null
  selected: Set<string>
  /** last focused segment (keyboard navigation, timeline sync) */
  focusId: string | null
  past: Snapshot[]
  future: Snapshot[]
  saving: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  saveError?: string
  /** legacy Phase 1 field: media of the active episode */
  video: MediaInfo | null
}

export const useProject = create<ProjectState>()(() => ({
  dir: null,
  project: null,
  activeId: null,
  selected: new Set(),
  focusId: null,
  past: [],
  future: [],
  saving: 'idle',
  video: null
}))

const snap = (p: Project): Snapshot => ({ episodes: p.episodes, cast: p.cast, glossary: p.glossary })

// ───────── autosave ─────────
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  useProject.setState({ saving: 'pending' })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 1000)
}

export async function saveNow() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const { dir, project } = useProject.getState()
  if (!dir || !project) return
  useProject.setState({ saving: 'saving' })
  try {
    await post('/projects/save', { dir, project })
    useProject.setState({ saving: 'saved', saveError: undefined })
  } catch (e) {
    useProject.setState({ saving: 'error', saveError: (e as Error).message })
  }
}

// ───────── core mutation ─────────
export interface MutateOpts {
  /** record in undo history (default true) */
  undo?: boolean
}

export function mutate(fn: (p: Project) => Project, opts: MutateOpts = {}) {
  const { project, past } = useProject.getState()
  if (!project) return
  const next = fn(project)
  if (next === project) return
  const media = next.episodes.find((e) => e.id === useProject.getState().activeId)?.media ?? null
  if (opts.undo === false) useProject.setState({ project: next, video: media })
  else useProject.setState({ project: next, past: [...past, snap(project)].slice(-100), future: [], video: media })
  scheduleSave()
}

export function undo() {
  const { project, past, future } = useProject.getState()
  if (!project || !past.length) return
  const prev = past[past.length - 1]
  useProject.setState({ project: { ...project, ...prev }, past: past.slice(0, -1), future: [snap(project), ...future].slice(0, 100) })
  scheduleSave()
}

export function redo() {
  const { project, past, future } = useProject.getState()
  if (!project || !future.length) return
  const [next, ...rest] = future
  useProject.setState({ project: { ...project, ...next }, past: [...past, snap(project)].slice(-100), future: rest })
  scheduleSave()
}

// ───────── helpers ─────────
export const activeEpisode = (s = useProject.getState()): Episode | null =>
  s.project?.episodes.find((e) => e.id === s.activeId) ?? s.project?.episodes[0] ?? null

export function useActiveEpisode(): Episode | null {
  return useProject((s) => s.project?.episodes.find((e) => e.id === s.activeId) ?? s.project?.episodes[0] ?? null)
}

export function updateEpisode(id: string, fn: (e: Episode) => Episode, opts?: MutateOpts) {
  mutate((p) => ({ ...p, episodes: p.episodes.map((e) => (e.id === id ? fn(e) : e)) }), opts)
}

export function updateSegments(epId: string, fn: (segs: Segment[]) => Segment[], opts?: MutateOpts) {
  updateEpisode(epId, (e) => ({ ...e, segments: fn(e.segments) }), opts)
}

export function patchSegments(epId: string, ids: Iterable<string>, patch: Partial<Segment> | ((s: Segment) => Partial<Segment>), opts?: MutateOpts) {
  const set = new Set(ids)
  updateSegments(epId, (segs) => segs.map((s) => (set.has(s.id) ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)), opts)
}

export const sortSegments = (segs: Segment[]) => [...segs].sort((a, b) => a.start - b.start || a.end - b.end)

// ───────── open / create ─────────
function load(dir: string, project: Project) {
  const activeId = project.episodes[0]?.id ?? null
  useProject.setState({
    dir,
    project,
    activeId,
    selected: new Set(),
    focusId: null,
    past: [],
    future: [],
    saving: 'saved',
    video: project.episodes[0]?.media ?? null
  })
}

export async function createProject(name: string, parentDir?: string) {
  const r = await post<{ dir: string; project: Project }>('/projects/create', { name, parentDir })
  load(r.dir, r.project)
  return r
}

export async function openProject(path: string) {
  const r = await post<{ dir: string; project: Project }>('/projects/open', { path })
  load(r.dir, r.project)
  return r
}

export async function closeProject() {
  await saveNow()
  useProject.setState({ dir: null, project: null, activeId: null, past: [], future: [], selected: new Set(), video: null })
}

export function setActiveEpisode(id: string) {
  const ep = useProject.getState().project?.episodes.find((e) => e.id === id)
  useProject.setState({ activeId: id, selected: new Set(), focusId: null, video: ep?.media ?? null })
}

export function addEpisode() {
  let id = ''
  mutate((p) => {
    const used = new Set(p.episodes.map((e) => e.label))
    let n = p.episodes.length + 1
    while (used.has(episodeLabel(n))) n++
    const ep = newEpisode(n)
    id = ep.id
    return { ...p, episodes: [...p.episodes, ep] }
  })
  if (id) setActiveEpisode(id)
}

export function removeEpisode(id: string) {
  const { project, activeId } = useProject.getState()
  if (!project || project.episodes.length <= 1) return
  const idx = project.episodes.findIndex((e) => e.id === id)
  mutate((p) => ({ ...p, episodes: p.episodes.filter((e) => e.id !== id) }))
  if (activeId === id) setActiveEpisode(project.episodes[Math.max(0, idx - 1)]?.id ?? project.episodes[0].id)
}

/** Attach a probed video to an episode (resets edit clips to the full video). */
export function setEpisodeVideo(epId: string, media: MediaInfo) {
  updateEpisode(epId, (e) => ({
    ...e,
    videoPath: media.path,
    durationSec: media.durationSec,
    media,
    stems: {},
    edit: { ...e.edit, clips: fullClip(media.durationSec), removed: [] }
  }))
  if (useProject.getState().activeId === epId) useProject.setState({ video: media })
}

export const epDir = (ep: Episode, dir = useProject.getState().dir) => `${dir}\\episodes\\${ep.id}`

export async function projectsRoot() {
  return (await api<{ root: string }>('/projects/root')).root
}

// legacy Phase 1 API (VideoPlayer used setVideo); kept as a no-op-safe setter
export const setVideoLegacy = (v: MediaInfo | null) => useProject.setState({ video: v })

import { create } from 'zustand'
import type { SectionId } from '@/features/settings/SettingsModal'

export type CenterTab = 'dub' | 'editor'
/** a Home-screen tool that needs a project: opened right after the new project is made */
export type HomeIntent = 'ai-video' | 'claude-video' | 'ai-creator' | 'link'

interface UiState {
  time: number
  playing: boolean
  centerTab: CenterTab
  zoom: number // px per second on the timeline
  previewEdit: boolean
  settings: SectionId | null
  dialog: null | 'export' | 'automate' | 'newProject' | 'find' | 'clone' | 'link' | 'source' | 'watermark' | 'gateway' | 'account' | 'readscreen' | 'subcover' | 'ads' | 'effects' | 'overlays'
  editingId: string | null
  intent: HomeIntent | null
  /** which tab the Stickers & text window opens on */
  overlayTab: 'stickers' | 'text' | 'list'
  set: (p: Partial<Omit<UiState, 'set'>>) => void
}

export const useUi = create<UiState>()((set) => ({
  time: 0,
  playing: false,
  centerTab: 'dub',
  zoom: 40,
  previewEdit: false,
  settings: null,
  dialog: null,
  editingId: null,
  intent: null,
  overlayTab: 'stickers',
  set: (p) => set(p)
}))

/** Imperative handle registered by the VideoPlayer. */
export interface PlayerApi {
  seek(t: number): void
  play(): void
  pause(): void
  toggle(): void
  /** play just [start,end] (used by "play line") */
  playRange(start: number, end: number): void
  /** play an audio file once (line preview) while keeping video muted at that time */
  playAudio(url: string, at?: number): void
}

let player: PlayerApi | null = null
export const registerPlayer = (p: PlayerApi | null) => (player = p)
export const playerApi = (): PlayerApi | null => player

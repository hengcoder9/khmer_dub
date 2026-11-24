import { create } from 'zustand'
import type { SectionId } from '@/features/settings/SettingsModal'

export type CenterTab = 'dub' | 'editor'

interface UiState {
  time: number
  playing: boolean
  centerTab: CenterTab
  zoom: number // px per second on the timeline
  previewEdit: boolean
  settings: SectionId | null
  dialog: null | 'export' | 'automate' | 'newProject' | 'find' | 'clone' | 'link' | 'source' | 'watermark' | 'gateway' | 'account' | 'readscreen' | 'subcover'
  editingId: string | null
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

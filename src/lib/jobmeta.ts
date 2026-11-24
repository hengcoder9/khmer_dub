import { AudioWaveform, Captions, Download, Film, Image as ImageIcon, Languages, Mic2, ScanText, Sparkles, Users, Wand2, Wrench, type LucideIcon } from 'lucide-react'
import type { JobInfo } from '@shared/types'

export interface JobMeta {
  /** engine / area shown above the job title */
  group: string
  icon: LucideIcon
  /** tailwind text + bg tint classes */
  tint: string
}

const META: Record<string, JobMeta> = {
  extract: { group: 'Media Intake', icon: Film, tint: 'text-sky-500 bg-sky-500/10' },
  separate: { group: 'Demucs Vocal Split', icon: AudioWaveform, tint: 'text-fuchsia-500 bg-fuchsia-500/10' },
  transcribe: { group: 'Timeline & Subtitle Sync', icon: Captions, tint: 'text-blue-500 bg-blue-500/10' },
  diarize: { group: 'Speaker Detection', icon: Users, tint: 'text-amber-500 bg-amber-500/10' },
  translate: { group: 'AI Translation', icon: Languages, tint: 'text-indigo-500 bg-indigo-500/10' },
  tts: { group: 'Khmer Neural Voice Engine', icon: Mic2, tint: 'text-emerald-500 bg-emerald-500/10' },
  mix: { group: 'Audio Mixer', icon: AudioWaveform, tint: 'text-teal-500 bg-teal-500/10' },
  export: { group: 'Master Export', icon: Film, tint: 'text-cyan-500 bg-cyan-500/10' },
  download: { group: 'Downloader', icon: Download, tint: 'text-sky-500 bg-sky-500/10' },
  polish: { group: 'Voice Polish', icon: Wand2, tint: 'text-violet-500 bg-violet-500/10' },
  genvideo: { group: 'AI Video', icon: Sparkles, tint: 'text-pink-500 bg-pink-500/10' },
  thumbnail: { group: 'AI Thumbnail', icon: ImageIcon, tint: 'text-fuchsia-500 bg-fuchsia-500/10' },
  story: { group: 'Claude Video', icon: Sparkles, tint: 'text-orange-500 bg-orange-500/10' },
  ocr: { group: 'Screen OCR', icon: ScanText, tint: 'text-lime-600 bg-lime-500/10' },
  ocrarea: { group: 'Screen OCR', icon: ScanText, tint: 'text-lime-600 bg-lime-500/10' },
  'engines.install': { group: 'AI Installer', icon: Wrench, tint: 'text-slate-500 bg-slate-500/10' }
}

export const jobMeta = (j: Pick<JobInfo, 'type'>): JobMeta => META[j.type] ?? { group: 'Studio', icon: Sparkles, tint: 'text-primary bg-primary/10' }

/** short background jobs that would only flicker in the live dock */
export const QUIET_JOBS = new Set(['peaks', 'silences'])

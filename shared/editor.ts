// AI video editor helpers (pure, unit tested).

import type { Range, Segment } from './types'
import { normalize, shrinkRanges } from './ranges'

const FILLERS: Record<string, string[]> = {
  en: ['um', 'uh', 'umm', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'uh-huh', 'you know', 'i mean', 'like'],
  km: ['អឺ', 'អ៊ឹម', 'អា', 'អើ', 'ហ៊ឹម', 'អូ'],
  zh: ['嗯', '呃', '那个', '这个', '啊'],
  ko: ['음', '어', '그', '저기'],
  ja: ['えー', 'あの', 'えっと', 'まあ'],
  th: ['เอ่อ', 'อืม', 'แบบ'],
  vi: ['ờ', 'ừm', 'à', 'thì'],
  fr: ['euh', 'ben', 'bah'],
  es: ['eh', 'este', 'pues', 'o sea']
}

const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:"'“”…\s]+/g, '')

/** Word-level ranges of filler words (needs word timestamps from Whisper). */
export function findFillers(segments: Segment[], lang = 'en', pad = 0.03): Range[] {
  const list = new Set([...(FILLERS[lang] ?? []), ...FILLERS.en].map(norm))
  // "like" is too often a real word; only count it when isolated between pauses
  const out: Range[] = []
  for (const s of segments) {
    const words = s.words ?? []
    words.forEach((w, i) => {
      const n = norm(w.text)
      if (!n || !list.has(n)) return
      if (n === 'like') {
        const gapBefore = i > 0 ? w.start - words[i - 1].end : 1
        const gapAfter = i < words.length - 1 ? words[i + 1].start - w.end : 1
        if (gapBefore < 0.15 || gapAfter < 0.15) return
      }
      const r3 = (n: number) => Math.round(n * 1000) / 1000
      out.push({ start: r3(Math.max(s.start, w.start - pad)), end: r3(Math.min(s.end, w.end + pad)) })
    })
  }
  return normalize(out)
}

/** Silences long enough to remove, shrunk by `keep` seconds on each side so speech isn't clipped. */
export function silenceCuts(silences: Range[], minLen: number, keep = 0.15): Range[] {
  return shrinkRanges(silences.filter((s) => s.end - s.start >= minLen), keep, 0.1)
}

/** Lines whose time range is (mostly) inside removed ranges. */
export function removedLineIds(segments: Segment[], removed: Range[]): Set<string> {
  const r = normalize(removed)
  const ids = new Set<string>()
  for (const s of segments) {
    let covered = 0
    for (const x of r) covered += Math.max(0, Math.min(s.end, x.end) - Math.max(s.start, x.start))
    if (covered >= (s.end - s.start) * 0.8) ids.add(s.id)
  }
  return ids
}

export const AI_EDIT_PRESETS = [
  { id: 'badTakes', en: 'Remove bad takes and repeated lines, keep the best last take', km: 'លុបការថតខុស និងប្រយោគដដែលៗ ទុកតែការថតចុងក្រោយល្អបំផុត' },
  { id: 'tighten', en: 'Tighten the pacing: remove long pauses, ums and dead air', km: 'ធ្វើឱ្យលឿនជាងមុន៖ លុបការស្ងៀមយូរ និងពាក្យ អឺ អ៊ឹម' },
  { id: 'short60', en: 'Make a 60-second vertical short with a strong hook at the start', km: 'បង្កើតវីដេអូខ្លី ៦០ វិនាទី បញ្ឈរ ដែលមានចំណុចទាក់ទាញនៅដើម' },
  { id: 'highlights', en: 'Keep only the most important and emotional moments (about 30% of the video)', km: 'ទុកតែគ្រាសំខាន់ៗ និងមានអារម្មណ៍ខ្លាំង (ប្រហែល ៣០% នៃវីដេអូ)' },
  { id: 'intro', en: 'Cut the intro/outro and anything that is not the main story', km: 'កាត់ផ្នែកណែនាំ/បញ្ចប់ និងអ្វីដែលមិនមែនជារឿងសំខាន់' },
  { id: 'tiktok', en: 'Prepare for TikTok: 9:16, word-by-word captions, fade in and out', km: 'រៀបចំសម្រាប់ TikTok៖ 9:16 អក្សររត់មួយពាក្យៗ និង fade ចូល/ចេញ' }
]

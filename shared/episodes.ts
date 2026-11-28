// Episode numbers from file names, so a series lands in the right order (pure, unit tested).
// Understands S01E03, 1x03, EP 3, Ep.03, Episode 3, E03, 第3集 / 第三集 / 第03话, ភាគ៣ / ភាគទី 3,
// tập 3, ตอนที่ 3, 3화 / 3회 — and otherwise the last plain number that isn't a resolution, codec or year.

export interface EpKey {
  season: number
  episode: number
}

const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩'
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
const toAscii = (s: string) =>
  s.replace(/[០-៩]/g, (d) => String(KHMER_DIGITS.indexOf(d))).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d))).replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))

const CN: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
/** 一 … 九十九 (also 百 for 100+) */
export function chineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  if (!/^[零〇一二两三四五六七八九十百]+$/.test(s)) return null
  let total = 0
  let cur = 0
  for (const ch of s) {
    if (ch === '百') {
      total += (cur || 1) * 100
      cur = 0
    } else if (ch === '十') {
      total += (cur || 1) * 10
      cur = 0
    } else cur = CN[ch] ?? 0
  }
  return total + cur
}

/** Tokens that look like numbers but are not episode numbers. */
const NOISE = /\b(\d{3,4}p|[248]k|x26[45]|h\.?26[45]|hevc|av1|10bit|8bit|5\.1|7\.1|2\.0|ddp?\d?(\.\d)?|aac\d?(\.\d)?|mp4|mkv|(19|20)\d{2}|\d+fps)\b/gi

export function episodeKey(fileName: string): EpKey | null {
  const name = toAscii(fileName.replace(/\.[a-z0-9]{2,4}$/i, ''))
  let m: RegExpMatchArray | null
  if ((m = name.match(/\bs(\d{1,2})\s*[._-]?\s*e(\d{1,4})\b/i))) return { season: +m[1], episode: +m[2] }
  if ((m = name.match(/\b(\d{1,2})x(\d{2,3})\b/i))) return { season: +m[1], episode: +m[2] }
  if ((m = name.match(/第\s*([\d零〇一二两三四五六七八九十百]+)\s*[集话話回期]/))) {
    const n = chineseNumber(m[1])
    if (n != null) return { season: 1, episode: n }
  }
  if ((m = name.match(/ភាគ\s*(?:ទី)?\s*(\d{1,4})/))) return { season: 1, episode: +m[1] }
  if ((m = name.match(/(?:ตอนที่|ตอน)\s*(\d{1,4})/))) return { season: 1, episode: +m[1] }
  if ((m = name.match(/(\d{1,4})\s*[화회]/))) return { season: 1, episode: +m[1] }
  if ((m = name.match(/\b(?:episode|episodio|ep|e|tập|tap)\s*[._#-]?\s*(\d{1,4})\b/i))) return { season: 1, episode: +m[1] }
  // last plain number, ignoring resolutions, codecs and years
  const nums = [...name.replace(NOISE, ' ').matchAll(/(?<![\d.])(\d{1,4})(?![\d.])/g)].map((x) => +x[1])
  if (nums.length) return { season: 1, episode: nums[nums.length - 1] }
  return null
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/**
 * Sort items by episode number (season, then episode; items without one go last, by name).
 * When fewer than half have a number, it is a plain natural (EP2 before EP10) sort.
 */
export function sortByEpisode<T>(items: T[], name: (x: T) => string): T[] {
  const keyed = items.map((x) => ({ x, n: name(x), k: episodeKey(name(x)) }))
  if (keyed.filter((e) => e.k).length * 2 < items.length) return [...items].sort((a, b) => natural(name(a), name(b)))
  return keyed
    .sort((a, b) => {
      if (a.k && b.k) return a.k.season - b.k.season || a.k.episode - b.k.episode || natural(a.n, b.n)
      if (a.k) return -1
      if (b.k) return 1
      return natural(a.n, b.n)
    })
    .map((e) => e.x)
}

/**
 * Two files for the same episode (e.g. "EP03 720p" and "EP03 1080p"): keep the biggest one.
 * Returns the kept items (in the given order) and the skipped ones.
 */
export function dropDuplicateEpisodes<T>(items: T[], name: (x: T) => string, size: (x: T) => number): { kept: T[]; skipped: T[] } {
  const best = new Map<string, T>()
  for (const x of items) {
    const k = episodeKey(name(x))
    if (!k) continue
    const id = `${k.season}:${k.episode}`
    const cur = best.get(id)
    if (!cur || size(x) > size(cur)) best.set(id, x)
  }
  const keptSet = new Set<T>()
  const kept: T[] = []
  const skipped: T[] = []
  for (const x of items) {
    const k = episodeKey(name(x))
    const winner = k ? best.get(`${k.season}:${k.episode}`) : x
    if (winner === x && !keptSet.has(x)) (keptSet.add(x), kept.push(x))
    else skipped.push(x)
  }
  return { kept, skipped }
}

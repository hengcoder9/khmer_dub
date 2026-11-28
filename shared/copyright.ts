// Copyright risk check before uploading to YouTube / Facebook / TikTok (pure, unit tested).
// Not the platforms' own check (Content ID, Rights Manager and TikTok's music check have no public pre-check):
// it combines what the AI heard in the source with what the export will really contain, and says what to fix.

export type Level = 'low' | 'medium' | 'high'
export type Platform = 'youtube' | 'facebook' | 'tiktok'
export type CopyrightFix = 'muteOriginal' | 'stopAutoOriginal' | 'addBgm' | 'source' | 'flip'

export interface MusicFinding {
  /** music heard in the source (any) */
  hasMusic: boolean
  /** what kind: a released song, a film / TV score, stock music */
  kind: 'song' | 'score' | 'stock' | 'none' | 'unknown'
  /** songs the AI recognised (title / artist) */
  songs: Array<{ title: string; artist?: string }>
  /** how it was judged */
  by: 'ai' | 'level' | 'none'
}

export interface CopyrightInput {
  music: MusicFinding
  /** export audio */
  muteOriginal: boolean
  keepOriginal: boolean
  autoOriginal: boolean
  /** a separated instrumental (music + effects of the source) is used under the dub */
  instrumentalUnderDub: boolean
  hasDub: boolean
  ownBgm: boolean
  /** project "Source & licence" */
  licence: boolean
  /** picture changed: cuts / reframe / flip / overlays / burned Khmer subtitles */
  transformed: boolean
}

export interface CopyrightItem {
  id: string
  level: Level
  platforms: Platform[]
  title: string
  detail: string
  fix?: CopyrightFix
}

export interface CopyrightReport {
  platforms: Record<Platform, Level>
  items: CopyrightItem[]
}

const ALL: Platform[] = ['youtube', 'facebook', 'tiktok']
const rank: Record<Level, number> = { low: 0, medium: 1, high: 2 }

export function assessCopyright(x: CopyrightInput): CopyrightReport {
  const items: CopyrightItem[] = []
  const songName = x.music.songs.map((s) => (s.artist ? `“${s.title}” by ${s.artist}` : `“${s.title}”`)).join(', ')
  const musicWord = x.music.songs.length ? songName : x.music.kind === 'score' ? 'the film / TV soundtrack' : x.music.kind === 'song' ? 'a commercial song' : 'the original music'
  const musicKnown = x.music.hasMusic || x.music.kind === 'unknown'
  const musicLevel: Level = x.music.songs.length || x.music.kind === 'song' || x.music.kind === 'score' ? 'high' : x.music.hasMusic ? 'medium' : 'low'

  // 1) the source's own sound in the export
  if (!x.muteOriginal) {
    if (x.keepOriginal) {
      items.push({
        id: 'keepOriginal',
        level: musicKnown ? (musicLevel === 'low' ? 'medium' : musicLevel) : 'medium',
        platforms: ALL,
        title: 'The original audio plays under the dub',
        detail: `${musicKnown ? `It contains ${musicWord}. ` : ''}YouTube Content ID and Facebook Rights Manager match audio; TikTok mutes music it can't license.`,
        fix: 'muteOriginal'
      })
    } else if (x.instrumentalUnderDub && musicKnown) {
      items.push({
        id: 'instrumental',
        level: musicLevel === 'low' ? 'medium' : musicLevel,
        platforms: ALL,
        title: 'The source music is still under your dub',
        detail: `“Remove BGM” keeps the music and effects of the source (the instrumental) under the Khmer voices — ${musicWord} can still be matched. Mute the original and add music you own instead.`,
        fix: 'muteOriginal'
      })
    }
    if (x.autoOriginal && !x.keepOriginal) {
      items.push({
        id: 'autoOriginal',
        level: musicKnown ? 'medium' : 'low',
        platforms: ALL,
        title: 'The original sound plays between dubbed lines',
        detail: 'Where nobody speaks, the source audio (music, effects, original voices) is heard — enough for audio matching.',
        fix: 'stopAutoOriginal'
      })
    }
  }
  if (x.music.songs.length) {
    items.push({
      id: 'song',
      level: 'high',
      platforms: ALL,
      title: `Recognised music: ${songName}`,
      detail: x.muteOriginal
        ? 'You mute the original audio, so it is not in your export. Keep it that way.'
        : 'This is very likely registered with the platforms: on YouTube a claim (ads to the owner) or block, on Facebook muting or blocking, on TikTok the sound is muted.',
      fix: x.muteOriginal ? undefined : 'muteOriginal'
    })
    if (x.muteOriginal) items[items.length - 1].level = 'low'
  }

  // 2) the picture itself
  if (!x.licence) {
    items.push({
      id: 'picture',
      level: 'high',
      platforms: ['youtube', 'facebook'],
      title: 'The video picture can be matched too',
      detail: 'Content ID and Rights Manager also match video, not only sound — dubbing does not change that. Only upload videos you have the rights to, and note the licence in Source & licence.',
      fix: 'source'
    })
  } else {
    items.push({ id: 'licence', level: 'low', platforms: ALL, title: 'Licence noted', detail: 'Keep your licence ready: if a claim comes, dispute it with the licence from Source & licence.' })
  }

  // 3) "reused / unoriginal content" (Facebook / TikTok reach, YouTube monetisation)
  if (!x.hasDub && !x.transformed) {
    items.push({
      id: 'reused',
      level: 'medium',
      platforms: ALL,
      title: 'Looks like a re-upload',
      detail: 'No dub and no visible changes: platforms may treat it as reused content (less reach, no monetisation). The Khmer dub, subtitles and edits are what make it yours.',
      fix: 'flip'
    })
  }

  // 4) your own music
  if (x.ownBgm) {
    items.push({ id: 'bgm', level: 'low', platforms: ALL, title: 'Your background music', detail: 'Use music you own or free libraries (YouTube Audio Library, Facebook Sound Collection, TikTok Commercial Music Library).' })
  } else if (x.muteOriginal && x.hasDub) {
    items.push({ id: 'noBgm', level: 'low', platforms: ALL, title: 'No music at all', detail: 'Only the Khmer voices: safe. Add royalty-free music for a better feel if you like.', fix: 'addBgm' })
  }
  if (x.music.by === 'none') {
    items.push({ id: 'unheard', level: 'low', platforms: ALL, title: 'Music not checked', detail: 'Add a Gemini key (or run Remove BGM) so the check can listen for songs.' })
  }

  const platforms = Object.fromEntries(
    ALL.map((p) => [p, items.filter((i) => i.platforms.includes(p)).reduce<Level>((m, i) => (rank[i.level] > rank[m] ? i.level : m), 'low')])
  ) as Record<Platform, Level>
  return { platforms, items: items.sort((a, b) => rank[b.level] - rank[a.level]) }
}

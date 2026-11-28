import { describe, expect, it } from 'vitest'
import { chineseNumber, dropDuplicateEpisodes, episodeKey, sortByEpisode } from '../shared/episodes'

describe('episode numbers from file names', () => {
  it.each([
    ['Show.S01E03.1080p.WEB.x264.mp4', 1, 3],
    ['show s2e10 720p.mkv', 2, 10],
    ['Show 1x07.mp4', 1, 7],
    ['My Drama EP 12 [1080p].mp4', 1, 12],
    ['My Drama Ep.05 2024.mp4', 1, 5],
    ['Episode 9 - Finale.mp4', 1, 9],
    ['drama_E03.mp4', 1, 3],
    ['甜蜜的爱 第3集.mp4', 1, 3],
    ['甜蜜的爱 第十二集.mp4', 1, 12],
    ['短剧 第03话 4K.mp4', 1, 3],
    ['រឿង ភាគ៣.mp4', 1, 3],
    ['រឿង ភាគទី 14.mp4', 1, 14],
    ['Phim tập 8.mp4', 1, 8],
    ['ละคร ตอนที่ 6.mp4', 1, 6],
    ['드라마 7화.mp4', 1, 7],
    ['Love 2023 - 04 1080p x265.mp4', 1, 4]
  ])('%s → S%iE%i', (n, s, e) => {
    expect(episodeKey(n)).toEqual({ season: s, episode: e })
  })

  it('no number at all', () => {
    expect(episodeKey('trailer.mp4')).toBeNull()
  })

  it('Chinese numerals', () => {
    expect([chineseNumber('三'), chineseNumber('十'), chineseNumber('十二'), chineseNumber('二十'), chineseNumber('九十九'), chineseNumber('一百零五')]).toEqual([3, 10, 12, 20, 99, 105])
  })

  it('sorts a messy series in episode order, items without a number last', () => {
    const files = ['ep10.mp4', 'Ep 2 720p.mp4', 'trailer.mp4', 'EP1 1080p.mp4', 'S01E03.mp4', 'episode 11.mp4']
    expect(sortByEpisode(files, (x) => x)).toEqual(['EP1 1080p.mp4', 'Ep 2 720p.mp4', 'S01E03.mp4', 'ep10.mp4', 'episode 11.mp4', 'trailer.mp4'])
  })

  it('keeps the biggest file when an episode is there twice', () => {
    const files = [
      { n: 'EP01 720p.mp4', s: 300 },
      { n: 'EP01 1080p.mp4', s: 900 },
      { n: 'EP02.mp4', s: 500 },
      { n: 'notes.mp4', s: 1 }
    ]
    const r = dropDuplicateEpisodes(files, (x) => x.n, (x) => x.s)
    expect(r.kept.map((x) => x.n)).toEqual(['EP01 1080p.mp4', 'EP02.mp4', 'notes.mp4'])
    expect(r.skipped.map((x) => x.n)).toEqual(['EP01 720p.mp4'])
  })
})

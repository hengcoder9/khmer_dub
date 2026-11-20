import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Captions, Film, Pause, Play, Scissors, Square, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveEpisode, useProject } from '@/store/project'
import { useSettings } from '@/store/settings'
import { registerPlayer, useUi } from '@/store/ui'
import { mediaUrl } from '@/lib/api'
import { cn, formatTime, isTyping } from '@/lib/utils'
import { effectiveClips } from '@shared/ranges'
import { CaptionPreview } from './CaptionPreview'

const ASPECT: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 }

export function VideoPlayer() {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const captions = useProject((s) => s.project?.settings.captions)
  const targetLang = useProject((s) => s.project?.settings.targetLang ?? 'km')
  const { volume, setVolume, showSubtitles, set: setSettings } = useSettings()
  const previewEdit = useUi((s) => s.previewEdit)
  const setUi = useUi((s) => s.set)
  const ref = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const rangeEnd = useRef<number | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [boxH, setBoxH] = useState(240)

  const videoPath = ep?.videoPath
  useEffect(() => {
    setUnsupported(false)
    setPlaying(false)
    setTime(0)
    setDuration(ep?.durationSec ?? 0)
    if (!videoPath) return setSrc(null)
    let alive = true
    mediaUrl(videoPath).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPath])

  useEffect(() => {
    if (ref.current) {
      ref.current.volume = volume
      ref.current.muted = muted
    }
  }, [volume, muted, src])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // edited-cut preview: playback order of clips
  const clips = useMemo(() => (ep?.edit.enabled ? effectiveClips(ep.edit) : []), [ep?.edit])

  // smooth time updates while playing + range stop + edit-cut skipping
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = ref.current
      if (v) {
        const now = v.currentTime
        if (rangeEnd.current !== null && now >= rangeEnd.current) {
          v.pause()
          rangeEnd.current = null
        } else if (previewEdit && clips.length && rangeEnd.current === null) {
          const idx = clips.findIndex((c) => now >= c.start - 0.03 && now < c.end)
          if (idx < 0) {
            // outside kept material: jump to the next clip in playback order after the one we came from
            const next = clips.find((c) => c.start > now) ?? null
            if (next) v.currentTime = next.start
            else v.pause()
          } else if (now >= clips[idx].end - 0.04) {
            const next = clips[idx + 1]
            if (next) v.currentTime = next.start
            else v.pause()
          }
        }
        setTime(v.currentTime)
        setUi({ time: v.currentTime })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, previewEdit, clips, setUi])

  const seek = useCallback(
    (t: number) => {
      const v = ref.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(t, (v.duration || duration) - 0.01))
      setTime(v.currentTime)
      setUi({ time: v.currentTime })
    },
    [duration, setUi]
  )

  const stopAudio = () => {
    const a = audioRef.current
    if (a && !a.paused) a.pause()
    if (ref.current && ref.current.dataset.dubbing) {
      ref.current.muted = muted
      delete ref.current.dataset.dubbing
    }
  }

  const toggle = useCallback(() => {
    const v = ref.current
    if (!v || !src || unsupported) return
    stopAudio()
    rangeEnd.current = null
    if (v.paused) {
      if (previewEdit && clips.length && !clips.some((c) => v.currentTime >= c.start && v.currentTime < c.end)) v.currentTime = clips[0].start
      v.play().catch(() => {})
    } else v.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, unsupported, previewEdit, clips])

  useEffect(() => {
    registerPlayer({
      seek,
      play: () => ref.current?.play().catch(() => {}),
      pause: () => {
        ref.current?.pause()
        stopAudio()
      },
      toggle,
      playRange: (start, end) => {
        const v = ref.current
        if (!v) return
        stopAudio()
        v.currentTime = start
        rangeEnd.current = end
        v.play().catch(() => {})
      },
      playAudio: (url, at) => {
        const v = ref.current
        const a = audioRef.current
        if (!a) return
        stopAudio()
        if (v && at !== undefined) {
          v.currentTime = at
          v.dataset.dubbing = '1'
          v.muted = true
          rangeEnd.current = null
          v.play().catch(() => {})
        }
        a.src = url
        a.volume = volume
        a.onended = () => {
          ref.current?.pause()
          stopAudio()
        }
        a.play().catch(() => {})
      }
    })
    return () => {
      registerPlayer(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek, toggle, volume, muted])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target) || e.repeat || e.ctrlKey) return
      e.preventDefault()
      toggle()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [toggle])

  // current caption
  const cue = useMemo(() => {
    if (!ep || !showSubtitles) return null
    const s = ep.segments.find((x) => time >= x.start && time < x.end)
    if (!s) return null
    const text = captions?.source === 'original' ? s.textOriginal || s.textTarget : s.textTarget || s.textOriginal
    return text ? { text, start: s.start, end: s.end } : null
  }, [ep, time, showSubtitles, captions?.source])

  const aspect = ep?.edit.enabled && ep.edit.aspect !== 'source' ? ASPECT[ep.edit.aspect] : null
  const srcAspect = ep?.media?.video ? ep.media.video.width / Math.max(1, ep.media.video.height) : 16 / 9
  const cutHere = ep?.edit.enabled && clips.length > 0 && !clips.some((c) => time >= c.start && time < c.end)

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-black">
      <div ref={boxRef} className="relative grid aspect-video place-items-center overflow-hidden">
        {src && !unsupported ? (
          <div
            className={cn('relative h-full overflow-hidden', aspect && ep?.edit.fitMode !== 'crop' && 'bg-neutral-900')}
            style={{ aspectRatio: String(aspect ?? srcAspect), maxWidth: '100%' }}
          >
            <video
              ref={ref}
              src={src}
              className={cn('size-full', aspect && ep?.edit.fitMode === 'crop' ? 'object-cover' : 'object-contain')}
              preload="auto"
              onClick={toggle}
              onPlay={() => {
                setPlaying(true)
                setUi({ playing: true })
              }}
              onPause={() => {
                setPlaying(false)
                setUi({ playing: false })
              }}
              onSeeked={(e) => {
                setTime(e.currentTarget.currentTime)
                setUi({ time: e.currentTarget.currentTime })
              }}
              onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
              onError={() => setUnsupported(true)}
            />
            {cue && captions && (
              <CaptionPreview style={captions} text={cue.text} start={cue.start} end={cue.end} time={time} height={boxH} lang={captions.source === 'target' ? targetLang : 'en'} />
            )}
            {cutHere && (
              <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-destructive/90 px-1.5 py-0.5 text-[11px] text-white">
                <Scissors className="size-3" /> {t('player.cut', 'Cut')}
              </div>
            )}
          </div>
        ) : (
          <div className="grid size-full place-items-center p-6 text-center text-sm text-white/60">
            <div className="flex flex-col items-center gap-2">
              <Film className="size-8 opacity-60" />
              {unsupported ? t('player.unsupported', "This video can't be previewed (unsupported codec). Processing and export still work.") : t('player.empty', 'No video yet — click “Import Video”')}
            </div>
          </div>
        )}
        <audio ref={audioRef} className="hidden" />
      </div>

      <div className="flex flex-col gap-1.5 bg-card px-2 pb-2 pt-1.5 text-card-foreground">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(time, duration)}
          disabled={!src || unsupported}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full"
          aria-label="Seek"
        />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggle} disabled={!src || unsupported} title={t(playing ? 'player.pause' : 'player.play', playing ? 'Pause (Space)' : 'Play (Space)')}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              ref.current?.pause()
              stopAudio()
              seek(0)
            }}
            disabled={!src || unsupported}
            title={t('player.stop', 'Stop')}
          >
            <Square />
          </Button>
          <span className="ml-1 whitespace-nowrap font-mono text-[11px] tabular-nums">
            {formatTime(time)} <span className="text-muted-foreground">/ {formatTime(duration)}</span>
          </span>
          <div className="flex-1" />
          {ep?.edit.enabled && (
            <Button
              variant={previewEdit ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setUi({ previewEdit: !previewEdit })}
              title={t('player.previewEditHint', 'Play only the kept clips, in edit order')}
            >
              <Scissors className="size-3.5" /> {t('player.previewEdit', 'Edited')}
            </Button>
          )}
          <Button variant={showSubtitles ? 'secondary' : 'ghost'} size="icon" onClick={() => setSettings({ showSubtitles: !showSubtitles })} title={t('player.subtitles', 'Subtitles')}>
            <Captions />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setMuted((m) => !m)} title={t('player.mute', 'Mute')}>
            {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              setVolume(Number(e.target.value))
              setMuted(false)
            }}
            className="w-16"
            aria-label={t('player.volume', 'Volume')}
          />
        </div>
      </div>
    </div>
  )
}

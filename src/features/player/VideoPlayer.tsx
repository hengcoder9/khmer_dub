import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AudioLines, Captions, Columns2, Film, Flame, Maximize, Minimize, Pause, Play, Scissors, Square, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveEpisode, useProject } from '@/store/project'
import { useSettings } from '@/store/settings'
import { registerPlayer, useUi } from '@/store/ui'
import { mediaUrl } from '@/lib/api'
import { cn, formatTime, isTyping } from '@/lib/utils'
import { clipSpeed, dubOnAt, dubSpans, effectiveClips, outputDuration, outputToSource, sourceToOutput, transitionDur } from '@shared/ranges'
import { CaptionPreview } from './CaptionPreview'
import { WatermarkLayer } from '@/features/project/WatermarkLayer'
import { SubCoverLayer } from '@/features/project/SubCoverLayer'
import { BannerLayer } from '@/features/project/BannerLayer'
import { OverlayLayer } from '@/features/project/OverlayLayer'
import { setBurnSubtitles } from './burn'

const ASPECT: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 }

/** `fill`: grow to the height of the panel (workspace) instead of a fixed 16:9 box */
export function VideoPlayer({ fill }: { fill?: boolean } = {}) {
  const { t } = useTranslation()
  const ep = useActiveEpisode()
  const captions = useProject((s) => s.project?.settings.captions)
  const targetLang = useProject((s) => s.project?.settings.targetLang ?? 'km')
  const muteOrig = useProject((s) => s.project?.settings.muteOriginal ?? false)
  const burn = useProject((s) => s.project?.settings.burnSubtitles ?? false)
  const wm = useProject((s) => s.project?.settings.watermark)
  const subCover = useProject((s) => s.project?.settings.subCover)
  const flip = useProject((s) => s.project?.settings.flip)
  const banners = useProject((s) => s.project?.settings.ads?.banners)
  const [wmUrl, setWmUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (wm?.path) void mediaUrl(wm.path).then((u) => alive && setWmUrl(u))
    else setWmUrl(null)
    return () => {
      alive = false
    }
  }, [wm?.path])
  const { volume, setVolume, showSubtitles, set: setSettings } = useSettings()
  const previewEdit = useUi((s) => s.previewEdit)
  const setUi = useUi((s) => s.set)
  const ref = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const bigPlayer = useSettings((s) => s.bigPlayer)
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen().catch(() => {})
  }, [])
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  // F = full screen (Esc leaves it)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !isTyping(e.target) && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        toggleFull()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggleFull])
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
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // edited-cut preview: playback order of clips
  const clips = useMemo(() => (ep?.edit.enabled ? effectiveClips(ep.edit) : []), [ep?.edit])

  // per-clip speed / volume / color (applied whenever edits are on, like the export)
  const curIdx = clips.findIndex((c) => time >= c.start && time < c.end)
  const cur = curIdx >= 0 ? clips[curIdx] : null
  const speed = cur ? clipSpeed(cur) : 1
  const gain = cur?.volume ?? 1
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.playbackRate = speed
    v.volume = Math.min(1, volume * gain)
  }, [speed, gain, volume, src])
  const col = cur?.color
  const cssFilter = col ? `brightness(${(1 + col.brightness).toFixed(2)}) contrast(${col.contrast.toFixed(2)}) saturate(${col.saturation.toFixed(2)})` : undefined
  // transition preview: a quick dip at the cut (the export renders the real xfade)
  let dip = 0
  if (previewEdit && cur) {
    const d = transitionDur(clips, curIdx)
    const left = (cur.end - time) / speed
    if (d > 0 && left < d / 2) dip = Math.max(dip, 1 - left / (d / 2))
    const dIn = curIdx > 0 ? transitionDur(clips, curIdx - 1) : 0
    const into = (time - cur.start) / speed
    if (dIn > 0 && into < dIn / 2) dip = Math.max(dip, 1 - into / (dIn / 2))
  }
  // in "Edited" view the seek bar and clock show the finished video's timeline
  const outMode = previewEdit && clips.length > 0
  const outDur = outMode ? outputDuration(clips) : duration
  const outTime = outMode ? (sourceToOutput(time, clips) ?? 0) : time

  // ───────── dub preview: hear the voiced lines (A1), an imported AI voice and the instrumental with the video ─────────
  const [hearDub, setHearDub] = useState(true)
  const settings = useProject((s) => s.project?.settings)
  const dubSegs = useMemo(() => (ep?.segments ?? []).filter((s) => s.audioPath && s.audioDur).sort((a, b) => a.start - b.start), [ep?.segments])
  const hasDub = dubSegs.length > 0 || !!ep?.voiceTrack
  // like the mix: under the dub, the instrumental replaces the original audio (unless "keep original voices" is on)
  const autoOrig = (settings?.autoOriginal ?? true) && !ep?.voiceTrack && dubSegs.length > 0
  const bgPath = hearDub && hasDub && !muteOrig && !settings?.keepOriginal && !autoOrig ? ep?.stems.instrumental : undefined
  // auto mode: the instrumental only fills in under the dub lines; the video's own sound plays in the gaps
  const instAuto = hearDub && autoOrig && !muteOrig && !settings?.keepOriginal ? ep?.stems.instrumental : undefined
  // the same merged spans and fade curve as the export mix, so preview and export sound alike
  const spans = useMemo(() => dubSpans(dubSegs.map((s) => ({ start: s.start, dur: s.audioDur! }))), [dubSegs])
  const urls = useRef(new Map<string, string>())
  useEffect(() => {
    const paths = [...dubSegs.map((s) => s.audioPath!), ep?.voiceTrack, ep?.stems.instrumental].filter((p): p is string => !!p)
    for (const p of paths) if (!urls.current.has(p)) void mediaUrl(p).then((u) => urls.current.set(p, u))
  }, [dubSegs, ep?.voiceTrack, ep?.stems.instrumental])
  const dub = useRef<{ id: string; el: HTMLAudioElement } | null>(null)
  const preload = useRef(new Map<string, HTMLAudioElement>())
  const tracks = useRef(new Map<string, HTMLAudioElement>())
  const stopDub = () => {
    dub.current?.el.pause()
    dub.current = null
    tracks.current.forEach((a) => a.pause())
  }
  useEffect(() => () => stopDub(), [])
  // the video's own sound: off when muted, when "Mute Original" is on, or while the instrumental plays instead
  useEffect(() => {
    if (ref.current && !ref.current.dataset.dubbing) ref.current.muted = muted || muteOrig || !!bgPath
  }, [muted, muteOrig, bgPath, src])
  const live = useRef({ hearDub, dubSegs, volume, gain, settings, voiceTrack: ep?.voiceTrack, bgPath, autoOrig, instAuto, spans })
  live.current = { hearDub, dubSegs, volume, gain, settings, voiceTrack: ep?.voiceTrack, bgPath, autoOrig, instAuto, spans }

  /** Keep a long source-time audio file playing in step with the video. */
  const follow = (path: string | undefined, t: number, vol: number, rate: number) => {
    const u = path && urls.current.get(path)
    if (!u) return
    let a = tracks.current.get(u)
    if (!a) tracks.current.set(u, (a = new Audio(u)))
    a.volume = Math.max(0, Math.min(1, vol))
    a.playbackRate = rate
    if (Math.abs(a.currentTime - t) > 0.25) a.currentTime = t
    if (a.paused) a.play().catch(() => {})
  }

  /** Called every frame while playing. */
  const syncDub = (v: HTMLVideoElement) => {
    const L = live.current
    const t = v.currentTime
    // single-line preview / "play line" use their own audio
    if (!L.hearDub || v.dataset.dubbing || rangeEnd.current !== null) {
      stopDub()
      v.volume = Math.min(1, L.volume * L.gain)
      return
    }
    const gv = L.settings?.globalVolume ?? 1
    const seg = L.dubSegs.find((s) => t >= s.start && t < s.start + (s.audioDur ?? 0))
    if (seg?.id !== dub.current?.id) {
      dub.current?.el.pause()
      dub.current = null
      const u = seg && urls.current.get(seg.audioPath!)
      if (seg && u) {
        const el = preload.current.get(u) ?? new Audio(u)
        preload.current.delete(u)
        el.currentTime = Math.max(0, t - seg.start)
        el.playbackRate = v.playbackRate
        el.volume = Math.min(1, L.volume * seg.volume * gv)
        el.play().catch(() => {})
        dub.current = { id: seg.id, el }
      }
    }
    // load the next two lines ahead so they start on time instead of after a fetch
    for (const nx of L.dubSegs.filter((s) => s.start > t).slice(0, 2)) {
      const nu = urls.current.get(nx.audioPath!)
      if (nu && !preload.current.has(nu)) {
        const a = new Audio(nu)
        a.preload = 'auto'
        preload.current.set(nu, a)
        if (preload.current.size > 6) preload.current.delete(preload.current.keys().next().value!)
      }
    }
    follow(L.voiceTrack, t, L.volume * gv, v.playbackRate)
    if (L.autoOrig) {
      // Auto original: original sound off while a dub line speaks, back on in the gaps (quick fade, like the export)
      const k = dubOnAt(L.spans, t)
      const under = L.settings?.keepOriginal ? (L.settings.origVolume ?? 0.15) : 0
      v.volume = Math.max(0, Math.min(1, L.volume * L.gain * (1 - (1 - under) * k)))
      if (L.instAuto) follow(L.instAuto, t, L.volume * L.gain * k, v.playbackRate)
    } else {
      // background (instrumental or the original audio), ducked while a dub line speaks — like the export mix
      const speaking = !!dub.current || !!L.voiceTrack
      const duck = speaking && L.settings?.ducking ? Math.pow(10, (L.settings.duckLevelDb ?? -12) / 20) : 1
      if (L.bgPath) follow(L.bgPath, t, L.volume * L.gain * duck, v.playbackRate)
      else v.volume = Math.min(1, L.volume * L.gain) * duck
    }
    // stop tracks that are no longer part of the mix (e.g. the dub toggle or Mute Original changed while playing)
    const used = new Set([L.voiceTrack, L.bgPath, L.instAuto].filter(Boolean).map((p) => urls.current.get(p!)))
    tracks.current.forEach((a, u) => !used.has(u) && !a.paused && a.pause())
  }

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
        if (!v.paused) syncDub(v)
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
      ref.current.muted = muted || muteOrig || !!bgPath
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
    <div ref={rootRef} className={cn('flex flex-col overflow-hidden bg-black', full ? 'h-screen w-screen' : fill ? 'h-full rounded-lg' : 'rounded-lg border')}>
      <div ref={boxRef} className={cn('relative grid place-items-center overflow-hidden', full || fill ? 'min-h-0 flex-1' : 'aspect-video')}>
        {src && !unsupported ? (
          <div
            className={cn('relative h-full overflow-hidden', aspect && ep?.edit.fitMode !== 'crop' && 'bg-neutral-900')}
            style={{ aspectRatio: String(aspect ?? srcAspect), maxWidth: '100%' }}
          >
            {/* mirrored picture (and the cover box drawn on it), like the export; captions and logos are not mirrored */}
            <div className="relative size-full" style={flip?.h || flip?.v ? { transform: `scale(${flip.h ? -1 : 1}, ${flip.v ? -1 : 1})` } : undefined}>
            <video
              ref={ref}
              src={src}
              className={cn('size-full', aspect && ep?.edit.fitMode === 'crop' ? 'object-cover' : 'object-contain')}
              style={{ filter: cssFilter }}
              preload="auto"
              onClick={toggle}
              onDoubleClick={toggleFull}
              onPlay={() => {
                setPlaying(true)
                setUi({ playing: true })
              }}
              onPause={() => {
                stopDub()
                setPlaying(false)
                setUi({ playing: false })
              }}
              onSeeked={(e) => {
                // restart the dub line at the new position on the next frame
                dub.current?.el.pause()
                dub.current = null
                setTime(e.currentTarget.currentTime)
                setUi({ time: e.currentTarget.currentTime })
              }}
              onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
              onError={() => setUnsupported(true)}
            />
            {/* old burned-in subtitles blurred / covered, like the export */}
            {subCover?.enabled && (
              <SubCoverLayer cover={subCover} srcAspect={srcAspect} boxAspect={aspect ?? srcAspect} fit={aspect && ep?.edit.fitMode === 'crop' ? 'cover' : 'contain'} />
            )}
            </div>
            {/* banner ads on their schedule */}
            {banners && banners.length > 0 && <BannerLayer banners={banners} time={time} />}
            {/* stickers and text: drag to move, corner to resize */}
            {ep?.overlays && ep.overlays.length > 0 && <OverlayLayer epId={ep.id} overlays={ep.overlays} time={time} />}
            {/* logo and/or text watermark, animated like the export */}
            {wm && (wmUrl || wm.text?.trim()) && <WatermarkLayer wm={wm} imageUrl={wmUrl} />}
            {dip > 0 && <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: dip }} />}
            {cue && captions && (
              <CaptionPreview style={captions} text={cue.text} start={cue.start} end={cue.end} time={time} height={boxH} lang={captions.source === 'target' ? targetLang : 'en'} />
            )}
            {cue && captions && (
              <div
                className={cn(
                  'pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white',
                  burn ? 'bg-primary/90' : 'bg-black/60'
                )}
              >
                {burn ? <Flame className="size-3" /> : <Captions className="size-3" />}
                {burn ? t('player.burnBadge', 'Burned in') : t('player.previewBadge', 'Preview only')}
              </div>
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
          max={outDur || 0}
          step={0.01}
          value={Math.min(outTime, outDur)}
          disabled={!src || unsupported}
          onChange={(e) => {
            const v = Number(e.target.value)
            seek(outMode ? (outputToSource(v, clips) ?? 0) : v)
          }}
          className="w-full"
          aria-label="Seek"
        />
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
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
            {formatTime(outTime)} <span className="text-muted-foreground">/ {formatTime(outDur)}</span>
            {speed !== 1 && <span className="ml-1 text-primary">{speed}×</span>}
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
          {hasDub && (
            <Button
              variant={hearDub ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setHearDub((x) => !x)
                stopDub()
              }}
              title={t('player.dubHint', 'Hear the dub voices (A1) with the video, mixed like the export')}
            >
              <AudioLines className="size-3.5" /> {t('player.dub', 'Dub')}
            </Button>
          )}
          <Button
            variant={burn ? 'secondary' : 'ghost'}
            size="sm"
            className={cn('h-7 px-2 text-[11px]', burn && 'text-primary')}
            onClick={() => setBurnSubtitles(!burn)}
            disabled={!ep}
            title={t('player.burnHint', 'Burn captions into the exported video (ON = shown on the video, OFF = hidden)')}
          >
            <Flame className="size-3.5" /> {burn ? t('player.burnOn', 'Burn ON') : t('player.burnOff', 'Burn OFF')}
          </Button>
          <Button
            variant={showSubtitles ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setSettings({ showSubtitles: !showSubtitles })}
            title={t('player.subtitlesHint', 'Show / hide captions in the preview only (does not change the export)')}
          >
            <Captions />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setMuted((m) => !m)} title={t('player.mute', 'Mute')}>
            {muted || muteOrig || volume === 0 ? <VolumeX /> : <Volume2 />}
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
          {!full && (
            <Button
              variant={bigPlayer ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => useSettings.getState().set({ bigPlayer: !bigPlayer })}
              title={t('player.half', 'Half screen: make the player bigger')}
            >
              <Columns2 />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={toggleFull} title={full ? t('player.exitFull', 'Exit full screen (Esc)') : t('player.full', 'Full screen (F, or double-click the video)')}>
            {full ? <Minimize /> : <Maximize />}
          </Button>
        </div>
      </div>
    </div>
  )
}

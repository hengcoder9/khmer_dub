// "AI prompt commands" for the video editor: the LLM proposes an edit plan the user approves.

import type { Aspect } from '../../shared/types'
import { llmJson } from '../lib/llm'
import type { Provider } from '../lib/keys'

export interface AiEditRequest {
  prompt: string
  provider: Provider
  model: string
  durationSec: number
  lines: Array<{ id: string; start: number; end: number; text: string; speaker?: string }>
  silences: Array<{ start: number; end: number }>
  clips: Array<{ start: number; end: number }>
  aspect: Aspect
}

export interface AiEditPlan {
  summary: string
  /** source ranges to keep, in playback order; empty = don't change cuts */
  keep: Array<{ start: number; end: number; reason?: string }>
  aspect?: Aspect | ''
  fadeIn?: number
  fadeOut?: number
  captionPreset?: string
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    keep: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { start: { type: 'NUMBER' }, end: { type: 'NUMBER' }, reason: { type: 'STRING' } },
        required: ['start', 'end']
      }
    },
    aspect: { type: 'STRING', enum: ['', 'source', '16:9', '9:16', '1:1', '4:5'] },
    fadeIn: { type: 'NUMBER' },
    fadeOut: { type: 'NUMBER' },
    captionPreset: { type: 'STRING', enum: ['', 'classic', 'boldYellow', 'karaoke', 'wordPop', 'boxed', 'minimal'] }
  },
  required: ['summary', 'keep']
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function planEdit(req: AiEditRequest): Promise<AiEditPlan> {
  const transcript = req.lines.map((l) => `[${l.id}] ${r2(l.start)}–${r2(l.end)}${l.speaker ? ` ${l.speaker}` : ''}: ${l.text}`).join('\n')
  const silences = req.silences
    .filter((s) => s.end - s.start >= 0.6)
    .slice(0, 400)
    .map((s) => `${r2(s.start)}–${r2(s.end)}`)
    .join(', ')
  const system = [
    'You are an expert video editor working from a timestamped transcript.',
    'You return an edit plan as JSON. Times are SOURCE seconds in the original video.',
    '"keep" lists the source ranges to keep, in the order they should play (you may reorder for highlights/hooks).',
    'Cut on line boundaries or inside silences so words are never chopped. Keep 0.1–0.2 s of padding around speech.',
    'If the instruction does not require changing what is kept (e.g. only reframing or captions), return "keep": [].',
    'For bad takes: when a line is repeated or restarted, keep only the LAST complete take.',
    'For filler words or long pauses, use the silences list to tighten pacing.',
    'Set "aspect" only if the user asks for a format (e.g. TikTok/Reels/Shorts = 9:16, Instagram feed = 4:5 or 1:1, YouTube = 16:9).',
    'Set fadeIn/fadeOut in seconds only if asked. Set captionPreset only if the user asks for a caption style.',
    '"summary" explains the plan in one or two short sentences for the user.'
  ].join('\n')
  const user = [
    `Video duration: ${r2(req.durationSec)} s. Current format: ${req.aspect}.`,
    `Currently kept clips: ${req.clips.map((c) => `${r2(c.start)}–${r2(c.end)}`).join(', ') || 'whole video'}`,
    `Silences: ${silences || 'unknown'}`,
    `Transcript:\n${transcript || '(no transcript)'}`,
    `\nInstruction: ${req.prompt}`
  ].join('\n')

  const plan = await llmJson<AiEditPlan>({
    provider: req.provider,
    model: req.model,
    system,
    parts: [{ text: user }],
    schema: req.provider === 'gemini' ? SCHEMA : undefined,
    temperature: 0.2
  })
  const keep = (plan.keep ?? [])
    .map((k) => ({ start: Math.max(0, r2(Number(k.start))), end: Math.min(req.durationSec, r2(Number(k.end))), reason: k.reason }))
    .filter((k) => Number.isFinite(k.start) && Number.isFinite(k.end) && k.end - k.start >= 0.1)
  return { summary: plan.summary ?? '', keep, aspect: plan.aspect, fadeIn: plan.fadeIn, fadeOut: plan.fadeOut, captionPreset: plan.captionPreset }
}

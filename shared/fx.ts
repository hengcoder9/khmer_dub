// Voice effects (on a line or a whole actor) and built-in sound effects, as ffmpeg audio filters (pure).
// Built-in sounds are synthesised by the app itself (no samples, no licences needed).

export type VoiceFx = 'echo' | 'hall' | 'radio' | 'phone' | 'megaphone' | 'robot' | 'giant' | 'chipmunk' | 'whisper' | 'ghost' | 'underwater'

const SR = 44100

/** ffmpeg -af chain per voice effect (input already 44.1 kHz). Effects with a tail get some room first (apad). */
export const VOICE_FX: Record<VoiceFx, { name: string; chain: string }> = {
  echo: { name: 'Echo', chain: 'apad=pad_dur=0.8,aecho=0.8:0.7:180|360:0.35|0.18' },
  hall: { name: 'Hall', chain: 'apad=pad_dur=1,aecho=0.8:0.85:60|97|151|213:0.42|0.32|0.24|0.16' },
  radio: { name: 'Radio', chain: 'highpass=f=450,lowpass=f=3400,acompressor=threshold=0.1:ratio=6:attack=5:release=80,volume=1.6' },
  phone: { name: 'Phone', chain: 'highpass=f=600,lowpass=f=2700,acrusher=bits=10:mode=log:aa=1,volume=1.5' },
  megaphone: { name: 'Megaphone', chain: 'highpass=f=700,lowpass=f=4200,acompressor=threshold=0.05:ratio=10:attack=2:release=50,volume=2.2,alimiter=limit=0.9' },
  robot: {
    name: 'Robot',
    chain: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75,volume=1.3"
  },
  giant: { name: 'Giant (deep)', chain: `asetrate=${Math.round(SR * 0.78)},aresample=${SR},atempo=${(1 / 0.78).toFixed(4)}` },
  chipmunk: { name: 'Chipmunk', chain: `asetrate=${Math.round(SR * 1.4)},aresample=${SR},atempo=${(1 / 1.4).toFixed(4)}` },
  whisper: {
    name: 'Whisper',
    chain: "afftfilt=real='hypot(re,im)*cos((random(0)*2-1)*2*3.14)':imag='hypot(re,im)*sin((random(1)*2-1)*2*3.14)':win_size=128:overlap=0.8,highpass=f=300,volume=1.4"
  },
  ghost: { name: 'Ghost', chain: 'apad=pad_dur=1,chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3,aecho=0.8:0.8:300:0.3' },
  underwater: { name: 'Underwater', chain: 'lowpass=f=450,vibrato=f=4:d=0.3,volume=1.4' }
}
export const VOICE_FX_IDS = Object.keys(VOICE_FX) as VoiceFx[]

export interface SfxDef {
  id: string
  name: string
  /** ffmpeg lavfi source (one input), already shaped */
  src: string
  dur: number
}

const ev = (expr: string, d: number) => `aevalsrc='${expr}':s=${SR}:d=${d}`

/** Built-in sounds, synthesised. */
export const SFX_LIBRARY: SfxDef[] = [
  { id: 'whoosh', name: 'Whoosh', dur: 0.8, src: `anoisesrc=d=0.8:c=pink:r=${SR}:a=0.6,bandpass=f=1400:width_type=h:w=1800,afade=t=in:d=0.35,afade=t=out:st=0.4:d=0.4` },
  { id: 'swoosh', name: 'Swoosh down', dur: 0.7, src: ev('0.5*sin(2*PI*(1400-1100*t)*t)*sin(PI*t/0.7)+0.15*(random(0)*2-1)*sin(PI*t/0.7)', 0.7) },
  { id: 'ding', name: 'Ding', dur: 1.6, src: ev('0.55*sin(2*PI*1318*t)*exp(-3.5*t)+0.25*sin(2*PI*2637*t)*exp(-5*t)+0.1*sin(2*PI*3951*t)*exp(-7*t)', 1.6) },
  { id: 'chime', name: 'Chime', dur: 1.2, src: ev('0.5*sin(2*PI*880*t)*exp(-5*t)*lt(t,0.18)+0.5*sin(2*PI*1320*t)*exp(-4*(t-0.18))*gte(t,0.18)', 1.2) },
  { id: 'pop', name: 'Pop', dur: 0.18, src: ev('0.9*sin(2*PI*(300+1400*exp(-35*t))*t)*exp(-28*t)', 0.18) },
  { id: 'click', name: 'Click', dur: 0.06, src: ev('0.9*exp(-180*t)*(random(0)*2-1)', 0.06) },
  { id: 'boom', name: 'Boom', dur: 1.8, src: ev('0.95*sin(2*PI*(45+70*exp(-9*t))*t)*exp(-2.6*t)+0.25*(random(0)*2-1)*exp(-14*t)', 1.8) },
  { id: 'hit', name: 'Dramatic hit', dur: 2.2, src: ev('0.8*sin(2*PI*(50+40*exp(-6*t))*t)*exp(-2*t)+0.18*(sin(2*PI*440*t)+sin(2*PI*466*t)+sin(2*PI*622*t))*exp(-1.6*t)', 2.2) },
  { id: 'riser', name: 'Riser', dur: 2.5, src: ev('0.45*sin(2*PI*(150+700*t*t/2.5)*t)*(t/2.5)+0.12*(random(0)*2-1)*(t/2.5)', 2.5) },
  { id: 'heartbeat', name: 'Heartbeat', dur: 1.1, src: ev('0.95*sin(2*PI*55*t)*exp(-22*t)+0.8*sin(2*PI*50*(t-0.28))*exp(-22*(t-0.28))*gte(t,0.28)', 1.1) },
  { id: 'beep', name: 'Beep (censor)', dur: 0.6, src: ev('0.5*sin(2*PI*1000*t)*lt(t,0.58)', 0.6) }
]
export const sfxById = (id: string) => SFX_LIBRARY.find((s) => s.id === id)

/** "builtin:whoosh" → the built-in sound; anything else is a file path. */
export const builtinId = (src: string) => (src.startsWith('builtin:') ? src.slice(8) : null)

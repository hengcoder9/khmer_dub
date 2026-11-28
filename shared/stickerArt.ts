// Built-in stickers: original vector art drawn for KhmerDub (no third-party assets, no licences).
// Added to a project they are rasterised to PNG (the export overlays PNG files).

export interface StickerArt {
  id: string
  name: string
  group: 'arrows' | 'social' | 'shapes' | 'bubbles' | 'labels'
  w: number
  h: number
  svg: string
}

const F = `font-family="'Arial Black','Segoe UI Black','Segoe UI',Arial,sans-serif" font-weight="900"`
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`

export const STICKER_ART: StickerArt[] = [
  // arrows & highlights
  { id: 'arrow-right', name: 'Arrow →', group: 'arrows', w: 240, h: 140, svg: svg(240, 140, `<path d="M10 52h140V12l80 58-80 58V88H10z" fill="#FF2E4D" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`) },
  { id: 'arrow-down', name: 'Arrow ↓', group: 'arrows', w: 140, h: 240, svg: svg(140, 240, `<path d="M52 10h36v140h40l-58 80-58-80h40z" fill="#FFD400" stroke="#111" stroke-width="10" stroke-linejoin="round"/>`) },
  { id: 'arrow-curve', name: 'Curved arrow', group: 'arrows', w: 240, h: 200, svg: svg(240, 200, `<path d="M30 170C40 80 110 40 180 52" fill="none" stroke="#FF2E4D" stroke-width="16" stroke-linecap="round"/><path d="M160 20l50 34-48 38" fill="none" stroke="#FF2E4D" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 'circle', name: 'Highlight circle', group: 'arrows', w: 260, h: 200, svg: svg(260, 200, `<path d="M70 30C150 0 245 40 240 100s-110 95-180 80S10 120 20 80s70-60 130-62" fill="none" stroke="#FF2E4D" stroke-width="11" stroke-linecap="round"/>`) },
  { id: 'underline', name: 'Underline', group: 'arrows', w: 300, h: 60, svg: svg(300, 60, `<path d="M12 38C80 18 160 16 288 30" fill="none" stroke="#FFD400" stroke-width="16" stroke-linecap="round"/>`) },
  // social buttons
  { id: 'subscribe', name: 'Subscribe', group: 'social', w: 420, h: 120, svg: svg(420, 120, `<rect x="6" y="6" width="408" height="108" rx="54" fill="#FF0033"/><path d="M62 38l30 22-30 22z" fill="#fff"/><text x="245" y="76" text-anchor="middle" ${F} font-size="44" fill="#fff">SUBSCRIBE</text>`) },
  { id: 'like', name: 'Like', group: 'social', w: 300, h: 120, svg: svg(300, 120, `<rect x="6" y="6" width="288" height="108" rx="54" fill="#1877F2"/><path d="M48 58h18v38H48zM70 58l18-28c8-4 14 2 12 10l-4 16h24c8 0 12 6 10 13l-7 22c-2 5-6 7-11 7H70z" fill="#fff"/><text x="205" y="76" text-anchor="middle" ${F} font-size="44" fill="#fff">LIKE</text>`) },
  { id: 'follow', name: 'Follow', group: 'social', w: 320, h: 120, svg: svg(320, 120, `<rect x="6" y="6" width="308" height="108" rx="54" fill="#FE2C55"/><path d="M58 40v40M38 60h40" stroke="#fff" stroke-width="12" stroke-linecap="round"/><text x="200" y="76" text-anchor="middle" ${F} font-size="44" fill="#fff">FOLLOW</text>`) },
  { id: 'bell', name: 'Bell', group: 'social', w: 160, h: 180, svg: svg(160, 180, `<path d="M80 18c-30 0-48 22-48 52v34l-16 24h128l-16-24V70c0-30-18-52-48-52z" fill="#FFC400" stroke="#111" stroke-width="8" stroke-linejoin="round"/><circle cx="80" cy="146" r="16" fill="#FFC400" stroke="#111" stroke-width="8"/><path d="M128 30l16-14M138 56h20" stroke="#FF2E4D" stroke-width="8" stroke-linecap="round"/>`) },
  // shapes
  { id: 'heart', name: 'Heart', group: 'shapes', w: 200, h: 180, svg: svg(200, 180, `<path d="M100 166C30 118 8 86 8 56 8 28 30 10 56 10c20 0 34 10 44 26 10-16 24-26 44-26 26 0 48 18 48 46 0 30-22 62-92 110z" fill="#FF2E63" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`) },
  { id: 'star', name: 'Star', group: 'shapes', w: 200, h: 190, svg: svg(200, 190, `<path d="M100 8l27 58 63 7-47 43 13 63-56-32-56 32 13-63L10 73l63-7z" fill="#FFD400" stroke="#111" stroke-width="9" stroke-linejoin="round"/>`) },
  { id: 'sparkles', name: 'Sparkles', group: 'shapes', w: 200, h: 200, svg: svg(200, 200, `<path d="M80 20q8 52 60 60-52 8-60 60-8-52-60-60 52-8 60-60z" fill="#FFF7B0" stroke="#FFC400" stroke-width="5"/><path d="M155 110q4 26 30 30-26 4-30 30-4-26-30-30 26-4 30-30z" fill="#fff" stroke="#FFC400" stroke-width="4"/>`) },
  { id: 'fire', name: 'Fire', group: 'shapes', w: 160, h: 200, svg: svg(160, 200, `<path d="M80 190c-42 0-66-28-66-62 0-40 30-58 36-96 22 16 30 36 28 56 10-10 14-24 14-38 30 22 50 50 50 82 0 34-24 58-62 58z" fill="#FF5A1F" stroke="#7A1A00" stroke-width="7" stroke-linejoin="round"/><path d="M80 184c-20 0-32-14-32-30 0-20 16-28 20-46 16 12 26 26 26 44 6-4 10-12 10-18 10 10 10 22 10 26 0 14-14 24-34 24z" fill="#FFD43B"/>`) },
  { id: 'check', name: 'Check', group: 'shapes', w: 200, h: 200, svg: svg(200, 200, `<circle cx="100" cy="100" r="90" fill="#22C55E" stroke="#fff" stroke-width="10"/><path d="M58 102l28 28 58-60" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 'cross', name: 'Cross', group: 'shapes', w: 200, h: 200, svg: svg(200, 200, `<circle cx="100" cy="100" r="90" fill="#EF4444" stroke="#fff" stroke-width="10"/><path d="M66 66l68 68M134 66l-68 68" stroke="#fff" stroke-width="18" stroke-linecap="round"/>`) },
  { id: 'crown', name: 'Crown', group: 'shapes', w: 220, h: 170, svg: svg(220, 170, `<path d="M20 140L10 40l55 45 45-70 45 70 55-45-10 100z" fill="#FFC400" stroke="#7A4A00" stroke-width="9" stroke-linejoin="round"/><circle cx="110" cy="100" r="12" fill="#E11D48"/>`) },
  // bubbles
  { id: 'speech', name: 'Speech bubble', group: 'bubbles', w: 260, h: 200, svg: svg(260, 200, `<path d="M30 20h200q20 0 20 20v90q0 20-20 20H110l-50 40 8-40H30q-20 0-20-20V40q0-20 20-20z" fill="#fff" stroke="#111" stroke-width="9" stroke-linejoin="round"/>`) },
  { id: 'thought', name: 'Thought bubble', group: 'bubbles', w: 260, h: 210, svg: svg(260, 210, `<path d="M70 140c-40 0-60-26-50-52 6-18 24-26 40-24 6-30 40-48 72-36 22-14 58-8 70 18 30 4 46 30 38 56-6 22-26 34-50 34-12 12-34 16-52 8-18 10-44 8-68-4z" fill="#fff" stroke="#111" stroke-width="8"/><circle cx="60" cy="168" r="12" fill="#fff" stroke="#111" stroke-width="7"/><circle cx="36" cy="194" r="7" fill="#fff" stroke="#111" stroke-width="6"/>`) },
  { id: 'question', name: '???', group: 'bubbles', w: 240, h: 160, svg: svg(240, 160, `<text x="120" y="128" text-anchor="middle" ${F} font-size="130" fill="#fff" stroke="#111" stroke-width="10" paint-order="stroke">???</text>`) },
  { id: 'exclaim', name: '!!', group: 'bubbles', w: 160, h: 170, svg: svg(160, 170, `<text x="80" y="140" text-anchor="middle" ${F} font-size="150" fill="#FF2E4D" stroke="#fff" stroke-width="10" paint-order="stroke">!!</text>`) },
  // labels
  { id: 'new', name: 'NEW', group: 'labels', w: 220, h: 220, svg: svg(220, 220, `<path d="M110 8l22 30 36-8 4 36 34 14-18 32 18 32-34 14-4 36-36-8-22 30-22-30-36 8-4-36-34-14 18-32-18-32 34-14 4-36 36 8z" fill="#FF2E4D" stroke="#fff" stroke-width="7"/><text x="110" y="126" text-anchor="middle" ${F} font-size="48" fill="#fff">NEW</text>`) },
  { id: 'sale', name: 'SALE', group: 'labels', w: 200, h: 240, svg: svg(200, 240, `<path d="M30 40h140v180H30z" rx="12" fill="#111"/><circle cx="100" cy="62" r="12" fill="#fff"/><text x="100" y="140" text-anchor="middle" ${F} font-size="54" fill="#FFD400">50%</text><text x="100" y="188" text-anchor="middle" ${F} font-size="38" fill="#fff">OFF</text>`) },
  { id: 'wow', name: 'WOW', group: 'labels', w: 260, h: 200, svg: svg(260, 200, `<path d="M130 6l26 40 46-18-6 48 52 14-40 30 30 40-50-2-10 46-36-32-36 32-10-46-50 2 30-40-40-30 52-14-6-48 46 18z" fill="#FFD400" stroke="#111" stroke-width="7"/><text x="130" y="122" text-anchor="middle" ${F} font-size="58" fill="#FF2E4D" stroke="#111" stroke-width="4" paint-order="stroke">WOW</text>`) },
  { id: 'live', name: 'LIVE', group: 'labels', w: 220, h: 100, svg: svg(220, 100, `<rect x="6" y="6" width="208" height="88" rx="16" fill="#E11D48"/><circle cx="48" cy="50" r="14" fill="#fff"/><text x="132" y="68" text-anchor="middle" ${F} font-size="46" fill="#fff">LIVE</text>`) },
  { id: 'ep', name: 'EP badge', group: 'labels', w: 220, h: 110, svg: svg(220, 110, `<rect x="6" y="6" width="208" height="98" rx="20" fill="#111" stroke="#FFD400" stroke-width="7"/><text x="110" y="74" text-anchor="middle" ${F} font-size="50" fill="#FFD400">EP 01</text>`) }
]

export const stickerArt = (id: string) => STICKER_ART.find((s) => s.id === id)
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

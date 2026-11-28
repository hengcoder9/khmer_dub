// Renders the Windows installer artwork (build/installerSidebar.bmp, build/installerHeader.bmp) with ffmpeg:
// the brand gradient, the app icon and Khmer + English text (libass shapes Khmer correctly).
//   node scripts/installer-art.mjs
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ffmpeg = join(root, 'resources', 'bin', 'ffmpeg.exe')
const work = mkdtempSync(join(tmpdir(), 'kd-art-'))
mkdirSync(join(work, 'fonts'))
for (const f of readdirSync(join(root, 'resources', 'fonts'))) if (/\.ttf$/i.test(f)) copyFileSync(join(root, 'resources', 'fonts', f), join(work, 'fonts', f))
copyFileSync(join(root, 'build', 'icon.png'), join(work, 'icon.png'))

// brand gradient: violet → blue (the app's --primary → --primary-2), corner to corner
const A = [110, 71, 238]
const B = [43, 134, 246]
const grad = (w, h) => {
  const mix = (i) => `${A[i]}+(${B[i] - A[i]})*(X/${w}+Y/${h})/2`
  return `color=c=black:s=${w}x${h}:d=1,format=rgb24,geq=r='${mix(0)}':g='${mix(1)}':b='${mix(2)}'`
}
const ass = (w, h, lines) =>
  [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${w}`, `PlayResY: ${h}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: T,Kantumruy Pro,18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H50000000,-1,0,0,0,100,100,0,0,1,0,1,8,8,8,0,1',
    '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines.map((l) => `Dialogue: 0,0:00:00.00,0:00:05.00,T,,0,0,0,,${l}`)
  ].join('\n') + '\n'

function render(name, w, h, iconSize, iconX, iconY, lines) {
  writeFileSync(join(work, `${name}.ass`), ass(w, h, lines), 'utf8')
  const graph = [
    `${grad(w, h)}[b1]`,
    `[1:v]scale=${iconSize}:${iconSize}[ic]`,
    `[b1][ic]overlay=${iconX}:${iconY}[b2]`,
    `[b2]subtitles=${name}.ass:fontsdir=fonts,format=bgr24[v]`
  ].join(';')
  const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', 'icon.png', '-i', 'icon.png', '-filter_complex', graph.replace('[1:v]', '[0:v]'), '-map', '[v]', '-frames:v', '1', '-pix_fmt', 'bgr24', `${name}.bmp`], { cwd: work })
  if (r.status !== 0) throw new Error(r.stderr.toString())
  copyFileSync(join(work, `${name}.bmp`), join(root, 'build', `${name}.bmp`))
  console.log(`build/${name}.bmp ${w}x${h}`)
}

// welcome / finish page: 164 × 314
render('installerSidebar', 164, 314, 76, 44, 40, [
  '{\\pos(82,128)\\fs19\\b1}KhmerDub Studio',
  '{\\pos(82,154)\\fs12\\b0\\1a&H20&}បញ្ចូលសំឡេងខ្មែរដោយ AI',
  '{\\pos(82,214)\\fs11\\b0\\an8\\1a&H10&}• Subtitles & translation',
  '{\\pos(82,234)\\fs11\\b0\\an8\\1a&H10&}• Neural Khmer voices',
  '{\\pos(82,254)\\fs11\\b0\\an8\\1a&H10&}• Shorts, ads & thumbnails',
  '{\\pos(82,286)\\fs10\\b0\\an8\\1a&H60&}miennams.net'
])
// header on the other pages: 150 × 57
render('installerHeader', 150, 57, 37, 10, 10, ['{\\an4\\pos(55,28)\\fs14\\b1}KhmerDub', '{\\an4\\pos(55,43)\\fs9\\b0\\1a&H30&}Studio'])
copyFileSync(join(root, 'build', 'installerSidebar.bmp'), join(root, 'build', 'uninstallerSidebar.bmp'))
rmSync(work, { recursive: true, force: true })

// Downloads open-licensed (OFL) Khmer fonts into resources/fonts for subtitle burn-in.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'resources', 'fonts')
mkdirSync(dir, { recursive: true })

const BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl'
const files = [
  ['kantumruypro/KantumruyPro[wght].ttf', 'KantumruyPro.ttf'],
  ['kantumruypro/OFL.txt', 'KantumruyPro-OFL.txt'],
  ['hanuman/Hanuman[wght].ttf', 'Hanuman.ttf'],
  ['hanuman/OFL.txt', 'Hanuman-OFL.txt']
]

for (const [src, name] of files) {
  const out = join(dir, name)
  if (existsSync(out) && !process.argv.includes('--force')) continue
  const url = `${BASE}/${src.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  console.log(`✔ ${name}`)
}
console.log(`Fonts ready → ${dir}`)

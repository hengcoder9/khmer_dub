// Builds src/i18n/km.json from src/i18n/km.tsv (key<TAB>translation). English lives inline as t() defaults.
// Keys may contain dots inside the last segment (e.g. "shortcuts.Ctrl+Z / Ctrl+Y") — only the first dot nests.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n')
const out = {}
for (const line of readFileSync(join(dir, 'km.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue
  const tab = line.indexOf('\t')
  if (tab < 1) throw new Error(`km.tsv: a line without "key<TAB>text": ${line.slice(0, 60)}`)
  const key = line.slice(0, tab)
  // "\n" written in the file = a line break in the text (every entry stays on one line)
  const value = line.slice(tab + 1).replace(/\\n/g, '\n')
  // nest on dots, except for shortcut keys whose last part contains punctuation
  const parts = key.startsWith('shortcuts.') ? ['shortcuts', key.slice(10)] : key.split('.')
  let o = out
  for (const p of parts.slice(0, -1)) o = o[p] ??= {}
  o[parts[parts.length - 1]] = value
}
writeFileSync(join(dir, 'km.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`km.json: ${Object.keys(out).length} sections`)

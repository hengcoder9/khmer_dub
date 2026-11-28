import type { FastifyInstance } from 'fastify'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Project } from '../../shared/types'
import { migrateProject, newProject } from '../../shared/defaults'
import { parseSubtitles, serializeSrt, serializeVtt, type Cue } from '../../shared/srt'
import { allowDir, allowFile } from '../lib/allow'
import { projectsRoot, logsDir } from '../lib/paths'
import { getThumb } from '../lib/peaks'
import { appendFile } from 'node:fs/promises'

const safeName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Project'

function uniqueDir(parent: string, name: string): string {
  let dir = join(parent, safeName(name))
  for (let i = 2; existsSync(dir); i++) dir = join(parent, `${safeName(name)} (${i})`)
  return dir
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, file)
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects/root', async () => ({ root: projectsRoot }))

  /**
   * Home screen: every project in the projects folder plus the given (recent) folders, newest first, with a
   * small thumbnail from the first episode's video. Reads project.json only — nothing is opened or changed.
   */
  app.post<{ Body: { dirs?: string[] } }>('/projects/list', async (req) => {
    const dirs = new Set<string>()
    try {
      for (const d of readdirSync(projectsRoot, { withFileTypes: true })) if (d.isDirectory()) dirs.add(join(projectsRoot, d.name))
    } catch {
      /* no projects folder yet */
    }
    for (const d of req.body?.dirs ?? []) if (typeof d === 'string' && d) dirs.add(resolve(d))
    const out: Array<{ dir: string; name: string; episodes: number; durationSec: number; updatedAt: number; thumb: string | null; aspect: number }> = []
    for (const dir of dirs) {
      const file = join(dir, 'project.json')
      if (!existsSync(file)) continue
      try {
        const p = JSON.parse(readFileSync(file, 'utf8')) as Project
        if (!p || !Array.isArray(p.episodes)) continue
        const withVideo = p.episodes.find((e) => e.videoPath && existsSync(e.videoPath))
        let thumb: string | null = null
        if (withVideo) {
          try {
            const buf = await getThumb(withVideo.videoPath!, Math.min(8, (withVideo.durationSec || 10) * 0.2), 320)
            thumb = `data:image/jpeg;base64,${buf.toString('base64')}`
          } catch {
            /* unreadable video: no picture */
          }
        }
        const v = withVideo?.media?.video
        out.push({
          dir,
          name: p.name || 'Untitled',
          episodes: p.episodes.length,
          durationSec: p.episodes.reduce((a, e) => a + (e.durationSec || 0), 0),
          updatedAt: statSync(file).mtimeMs,
          thumb,
          aspect: v?.width && v.height ? v.width / v.height : 16 / 9
        })
      } catch {
        /* not a readable project */
      }
    }
    return { root: projectsRoot, projects: out.sort((a, b) => b.updatedAt - a.updatedAt) }
  })

  app.post<{ Body: { name: string; parentDir?: string } }>('/projects/create', async (req) => {
    const parent = req.body.parentDir || projectsRoot
    mkdirSync(parent, { recursive: true })
    const dir = uniqueDir(parent, req.body.name)
    mkdirSync(dir, { recursive: true })
    const project = newProject(req.body.name.trim() || 'Untitled')
    writeAtomic(join(dir, 'project.json'), JSON.stringify(project, null, 2))
    allowDir(dir)
    return { dir, project }
  })

  app.post<{ Body: { path: string } }>('/projects/open', async (req, reply) => {
    let file = resolve(req.body.path)
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'project.json')
    if (!existsSync(file)) return reply.code(404).send({ error: 'project.json not found' })
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Project
    if (!raw || !Array.isArray(raw.episodes)) return reply.code(400).send({ error: 'Not a KhmerDub project file' })
    const dir = dirname(file)
    allowDir(dir)
    const project = migrateProject(raw)
    for (const e of project.episodes) {
      if (e.videoPath) allowFile(e.videoPath)
      if (e.edit.bgm?.path) allowFile(e.edit.bgm.path)
    }
    return { dir, project }
  })

  app.post<{ Body: { dir: string; project: Project } }>('/projects/save', async (req, reply) => {
    const { dir, project } = req.body
    if (!dir || !project?.id) return reply.code(400).send({ error: 'dir and project required' })
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'project.json')
    // never let a stale renderer overwrite a different project in the same folder
    if (existsSync(file)) {
      try {
        const cur = JSON.parse(readFileSync(file, 'utf8')) as Project
        if (cur.id && cur.id !== project.id) return reply.code(409).send({ error: 'Folder contains a different project' })
      } catch {
        /* corrupt file: overwrite */
      }
    }
    writeAtomic(file, JSON.stringify(project, null, 2))
    return { ok: true, savedAt: Date.now() }
  })

  app.post<{ Body: { path: string } }>('/subs/import', async (req, reply) => {
    const p = resolve(req.body.path)
    if (!existsSync(p)) return reply.code(404).send({ error: 'file not found' })
    const cues = parseSubtitles(readFileSync(p, 'utf8'))
    if (!cues.length) return reply.code(400).send({ error: 'No subtitles found in file' })
    return { cues }
  })

  app.post<{ Body: { path: string; cues: Cue[]; format: 'srt' | 'vtt' } }>('/subs/export', async (req) => {
    const { path, cues, format } = req.body
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, format === 'vtt' ? serializeVtt(cues) : serializeSrt(cues), 'utf8')
    return { ok: true, path }
  })

  app.post<{ Body: { name: string; lines: string[] } }>('/logs/append', async (req) => {
    const name = req.body.name.replace(/[^\w.-]/g, '_')
    await appendFile(join(logsDir, name), req.body.lines.map((l) => `${new Date().toISOString()} ${l}\n`).join(''), 'utf8')
    return { ok: true, path: join(logsDir, name) }
  })
}

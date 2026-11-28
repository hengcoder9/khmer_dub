import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectRoutes } from '../backend/routes/projects'
import { newProject } from '../shared/defaults'

describe('Home: rename a project', () => {
  it('changes only the name inside project.json; the folder stays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-proj-'))
    const app = Fastify()
    await app.register(projectRoutes)
    try {
      const p = newProject('Old name')
      writeFileSync(join(dir, 'project.json'), JSON.stringify(p))
      const r = await app.inject({ method: 'POST', url: '/projects/rename', payload: { dir, name: '  New name  ' } })
      expect(r.json()).toEqual({ ok: true, name: 'New name' })
      const saved = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
      expect(saved.name).toBe('New name')
      expect(saved.id).toBe(p.id)
      expect((await app.inject({ method: 'POST', url: '/projects/rename', payload: { dir, name: '   ' } })).statusCode).toBe(400)
      expect((await app.inject({ method: 'POST', url: '/projects/rename', payload: { dir: join(dir, 'nope'), name: 'x' } })).statusCode).toBe(404)
      // the list shows the new name
      const list = await app.inject({ method: 'POST', url: '/projects/list', payload: { dirs: [dir] } })
      expect(list.json().projects.find((x: { dir: string }) => x.dir === dir)?.name).toBe('New name')
    } finally {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

import type { FastifyInstance } from 'fastify'
import { totalmem, freemem } from 'node:os'
import { statfs } from 'node:fs/promises'
import { parse } from 'node:path'
import type { SystemStats } from '../../shared/types'
import { listChecks, runCheck } from '../lib/checks'
import { userDataDir } from '../lib/paths'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, pid: process.pid }))

  app.get('/health/checks', async () => listChecks())

  app.get<{ Params: { id: string } }>('/health/check/:id', async (req, reply) => {
    const r = await runCheck(req.params.id)
    return r ?? reply.code(404).send({ error: 'unknown check' })
  })

  app.get('/system/stats', async (): Promise<SystemStats> => {
    let disk = { total: 0, free: 0 }
    try {
      const s = await statfs(parse(userDataDir).root)
      disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
    } catch {
      /* ignore */
    }
    return { memTotal: totalmem(), memFree: freemem(), diskTotal: disk.total, diskFree: disk.free }
  })
}

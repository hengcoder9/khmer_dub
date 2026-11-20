import Fastify from 'fastify'
import cors from '@fastify/cors'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { healthRoutes } from './routes/health'
import { mediaRoutes } from './routes/media'
import { projectRoutes } from './routes/projects'
import { apiRoutes } from './routes/api'
import { registerAllJobs } from './jobs'
import { keyPool, type Provider } from './lib/keys'
import { stopAllWorkers } from './lib/python'

// Per-launch secret from electron main. Any web page can reach 127.0.0.1, so every request must carry it.
const TOKEN = Buffer.from(process.env.KD_TOKEN ?? '')

function tokenOk(value: unknown): boolean {
  if (typeof value !== 'string' || TOKEN.length === 0) return false
  const v = Buffer.from(value)
  return v.length === TOKEN.length && timingSafeEqual(v, TOKEN)
}

type ParentMsg =
  | { type: 'keys'; keys: Array<{ id: string; provider: Provider; key: string }> }
  | { type: 'shutdown' }

const parentPort = (process as unknown as {
  parentPort?: { postMessage(m: unknown): void; on(ev: 'message', cb: (e: { data: ParentMsg }) => void): void }
}).parentPort

function shutdown() {
  stopAllWorkers()
  setTimeout(() => process.exit(0), 300)
}

async function main() {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 * 1024 })

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-kd-token']
  })

  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return
    // header for fetch(); ?token= for <video src>/WebSocket which can't send headers
    const t = req.headers['x-kd-token'] ?? (req.query as Record<string, unknown> | undefined)?.token
    if (!tokenOk(t)) return reply.code(401).send({ error: 'unauthorized' })
  })

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(err)
    reply.code(err.statusCode ?? 500).send({ error: err.message })
  })

  registerAllJobs()
  await app.register(healthRoutes)
  await app.register(mediaRoutes)
  await app.register(projectRoutes)
  await app.register(apiRoutes)

  // Hosting platforms inject PORT and route traffic from outside, so bind all interfaces there.
  // Desktop (no PORT): loopback only, random free port.
  const port0 = Number(process.env.PORT || process.env.KD_PORT || 0)
  const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1')
  await app.listen({ host, port: port0 })
  const { port } = app.server.address() as AddressInfo

  if (parentPort) {
    parentPort.on('message', (e) => {
      try {
        const msg = (e && typeof e === 'object' && 'data' in e) ? (e as any).data : e
        if (msg?.type === 'keys' && Array.isArray(msg.keys)) keyPool.set(msg.keys)
        else if (msg?.type === 'shutdown') shutdown()
      } catch (err) {
        console.error('[backend message error]', err)
      }
    })
    parentPort.postMessage({ type: 'ready', port })
  } else {
    console.log(`KD_READY ${port}`) // standalone mode (tests / debugging)
    if (process.env.KD_TEST_GEMINI_KEY) keyPool.set([{ id: 'test', provider: 'gemini', key: process.env.KD_TEST_GEMINI_KEY }])
  }
}

process.on('uncaughtException', (err) => {
  console.error('[backend uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[backend unhandledRejection]', reason)
})
process.on('exit', stopAllWorkers)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

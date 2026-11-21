import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { join } from 'node:path'
import type { Gender } from '../../shared/types'
import { cancelJob, createJob, listJobs, setGpuLanes } from '../queue'
import { subscribe } from '../lib/events'
import { keyPool, type Provider } from '../lib/keys'
import { testKey } from '../lib/llm'
import { setCloneLanes, nextCloneLane } from '../lib/python'
import { cacheDir } from '../lib/paths'
import { allowFile } from '../lib/allow'
import { shortenLine } from '../pipeline/translate'
import { planEdit, type AiEditRequest } from '../pipeline/aiedit'
import { planCreate, videoPrompt, writeMeta, type CreatorRequest } from '../pipeline/aicreate'
import { allVoices, createCloneVoice, deleteCloneVoice, edgeVoices } from '../pipeline/voices'
import { previewVoice } from '../pipeline/tts'
import { cudaInfo, engineStatus, hasNvidia } from '../pipeline/pysetup'

export async function apiRoutes(app: FastifyInstance) {
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'keys', ...keyPool.stats('gemini') }))
    const off = subscribe((ev) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(ev))
    })
    socket.on('close', off)
  })

  // jobs
  app.post<{ Body: { type: string; payload: unknown; episodeId?: string } }>('/jobs', async (req) =>
    createJob(req.body.type, req.body.payload, req.body.episodeId)
  )
  app.get('/jobs', async () => listJobs())
  app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (req) => ({ ok: cancelJob(req.params.id) }))

  // keys (values come from electron main; renderer only sees ids/stats)
  app.get('/keys/stats', async () => ({ gemini: keyPool.stats('gemini'), openrouter: keyPool.stats('openrouter'), claude: keyPool.stats('claude') }))
  app.post<{ Body: { provider: Provider } }>('/keys/test', async (req) => {
    const results = await Promise.all(keyPool.all(req.body.provider).map(async (k) => ({ id: k.id, ...(await testKey(k.provider, k.key)) })))
    return { results }
  })

  // AI helpers
  app.post<{ Body: Parameters<typeof shortenLine>[0] }>('/ai/shorten', async (req) => ({ text: await shortenLine(req.body) }))
  app.post<{ Body: AiEditRequest }>('/ai/edit', async (req) => planEdit(req.body))
  app.post<{ Body: CreatorRequest }>('/ai/create', async (req) => planCreate(req.body))
  app.post<{ Body: Parameters<typeof writeMeta>[0] }>('/ai/meta', async (req) => writeMeta(req.body))
  app.post<{ Body: Parameters<typeof videoPrompt>[0] }>('/ai/video-prompt', async (req) => videoPrompt(req.body))

  // voices
  app.get<{ Querystring: { refresh?: string } }>('/voices', async (req) => {
    if (req.query.refresh) await edgeVoices(true)
    return allVoices()
  })
  app.post<{ Body: { name: string; gender: Gender; refPath: string; refText: string; start?: number; duration?: number } }>('/voices/clone', async (req) =>
    createCloneVoice(req.body)
  )
  app.delete<{ Params: { id: string } }>('/voices/clone/:id', async (req) => {
    deleteCloneVoice(req.params.id)
    return { ok: true }
  })
  app.post<{ Body: { voiceId: string; text: string; defaultMale: string; defaultFemale: string } }>('/voices/preview', async (req) => {
    const path = await previewVoice({ ...req.body, outDir: join(cacheDir, 'preview') })
    allowFile(path)
    return { path }
  })

  // engines
  app.get('/engines/status', async () => ({ groups: await engineStatus(), nvidia: await hasNvidia() }))
  app.get('/engines/cuda', async () => cudaInfo())
  app.post<{ Body: { gpuLanes?: number; cloneLanes?: number; clone?: { model?: string; ckptFile?: string; vocabFile?: string } } }>(
    '/engines/config',
    async (req) => {
      if (req.body.gpuLanes) setGpuLanes(req.body.gpuLanes)
      if (req.body.cloneLanes || req.body.clone) setCloneLanes(req.body.cloneLanes ?? 1, req.body.clone)
      return { ok: true }
    }
  )
  app.get('/engines/clone/health', async () => nextCloneLane().call('/health', undefined, 120_000))
  // first load of VoxCPM2 downloads the model (~5 GB): allow a long time
  app.post('/engines/clone/warmup', async () => nextCloneLane().call('/warmup', {}, 3_600_000))
}

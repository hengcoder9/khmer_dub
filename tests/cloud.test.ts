import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { cloudLink, downloadDropboxFolder, oneDriveShareId, parseDriveFolder, systemTar } from '../backend/pipeline/cloud'
import { resolveLink } from '../backend/pipeline/download'

const ctx = { id: 't', signal: new AbortController().signal, progress: () => {}, log: () => {}, throwIfCanceled: () => {} }

describe('cloud share links', () => {
  it('recognises folders and files of each service', () => {
    expect(cloudLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toEqual({ kind: 'gdrive-folder', url: '1AbCdEfGhIjKlMnOp' })
    expect(cloudLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBeNull() // a single Drive file: the old direct path
    expect(cloudLink('https://www.dropbox.com/scl/fo/abc123/xyz?rlkey=k&dl=0')?.kind).toBe('dropbox-folder')
    expect(cloudLink('https://www.dropbox.com/scl/fi/abc/video.mp4?dl=0')).toBeNull()
    expect(cloudLink('https://1drv.ms/f/s!AbCdEf')?.kind).toBe('onedrive')
    expect(cloudLink('https://mega.nz/folder/AbCd1234#KeyKeyKey')?.kind).toBe('mega')
    expect(cloudLink('https://example.com/a.mp4')).toBeNull()
  })

  it('unlicensed drama sites and their short links are refused', () => {
    expect(() => resolveLink('https://kisskh.co/Drama/Some-Show/Episode-1')).toThrow(/streaming/)
    expect(() => resolveLink('https://t.kisskh.id/FZWR')).toThrow(/streaming/)
  })

  it('OneDrive pre-signed download URLs are plain files', () => {
    expect(resolveLink('https://public.bn.files.1drv.com/y4mAbC/EP01.mp4?download').kind).toBe('direct')
    expect(resolveLink('https://public.bn.files.1drv.com/y4mAbC?download').kind).toBe('direct')
  })

  it('OneDrive share id: "u!" + unpadded base64url', () => {
    const id = oneDriveShareId('https://1drv.ms/f/s!AbC?x=1')
    expect(id.startsWith('u!')).toBe(true)
    expect(id).not.toMatch(/[=+/]/)
    expect(Buffer.from(id.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).toBe('https://1drv.ms/f/s!AbC?x=1')
  })

  it('reads the files of a public Google Drive folder page', () => {
    const html = `<html><title>My Series</title><div class="flip-entries">
      <div class="flip-entry" id="entry-1aaaaaaaaaaaa" tabindex="0"><a href="https://drive.google.com/file/d/1aaaaaaaaaaaa/view"><div class="flip-entry-info"><div class="flip-entry-title">Show EP10.mp4</div></div></a></div>
      <div class="flip-entry" id="entry-1bbbbbbbbbbbb" tabindex="0"><a href="#"><div class="flip-entry-title">Show EP2 &amp; more.mp4</div></a></div>
    </div></html>`
    expect(parseDriveFolder(html)).toEqual([
      { id: '1aaaaaaaaaaaa', name: 'Show EP10.mp4' },
      { id: '1bbbbbbbbbbbb', name: 'Show EP2 & more.mp4' }
    ])
  })

  it('Dropbox folder: zip downloaded, videos unpacked in episode order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kd-dbx-test-'))
    const src = join(dir, 'src')
    spawnSync('cmd', ['/c', 'mkdir', src])
    for (const n of ['Drama EP10.mp4', 'Drama EP2.mp4', 'Drama EP1.mp4', 'readme.txt']) writeFileSync(join(src, n), `fake ${n}`.padEnd(2048, '.'))
    const zip = join(dir, 'f.zip')
    const t = spawnSync(systemTar(), ['-a', '-cf', zip, '-C', src, '.'])
    expect(t.status).toBe(0)
    const server = createServer((req, res) => {
      expect(req.url).toContain('dl=1')
      res.writeHead(200, { 'content-type': 'application/zip' })
      res.end(readFileSync(zip))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    try {
      const port = (server.address() as AddressInfo).port
      const r = await downloadDropboxFolder(`http://127.0.0.1:${port}/scl/fo/abc/xyz?dl=0`, join(dir, 'out'), ctx)
      expect(r.paths.map((p) => basename(p))).toEqual(['Drama EP1.mp4', 'Drama EP2.mp4', 'Drama EP10.mp4'])
      expect(r.path).toBe(r.paths[0])
    } finally {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

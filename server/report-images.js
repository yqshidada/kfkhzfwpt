const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')

function command(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, {
    windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' }
  }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}

function createImageStore(cacheRoot) {
  const jobs = new Map()
  let queue = Promise.resolve()
  const maxPages = 80
  async function cached(dir) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
      if (!Number.isInteger(manifest.pages) || manifest.pages < 1 || manifest.pages > maxPages) return null
      await Promise.all(Array.from({ length: manifest.pages }, (_, i) => fs.access(path.join(dir, `${i + 1}.jpg`))))
      return manifest
    } catch (_) { return null }
  }
  async function render(pdfPath, dir) {
    const info = await command(process.env.PDFINFO_PATH || 'pdfinfo', [pdfPath])
    const pages = Number((info.match(/^Pages:\s+(\d+)/m) || [])[1])
    if (!Number.isInteger(pages) || pages < 1 || pages > maxPages) throw new Error('Unsupported page count')
    await fs.mkdir(dir, { recursive: true })
    // One page at a time bounds the conversion process's memory use.
    for (let page = 1; page <= pages; page++) {
      await command(process.env.PDFTOPPM_PATH || 'pdftoppm', [
        '-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '1800',
        '-jpeg', '-jpegopt', 'quality=85,optimize=y', pdfPath, path.join(dir, String(page))
      ])
    }
    await fs.writeFile(path.join(dir, 'manifest.json.tmp'), JSON.stringify({ pages }))
    await fs.rename(path.join(dir, 'manifest.json.tmp'), path.join(dir, 'manifest.json'))
  }
  async function status(pdfPath) {
    const stat = await fs.stat(pdfPath)
    if (stat.size > 16 * 1024 * 1024) throw new Error('PDF too large')
    const key = crypto.createHash('sha256').update('jpeg-1800-v1:').update(await fs.readFile(pdfPath)).digest('hex')
    const dir = path.join(cacheRoot, key)
    const manifest = await cached(dir)
    if (manifest) return { state: 'ready', pages: manifest.pages, dir, version: key }
    const job = jobs.get(key)
    if (job && job.state === 'failed' && Date.now() < job.retryAt) return { state: 'failed' }
    if (job && job.state === 'processing') return { state: 'processing' }
    // Failed attempts cannot grow the queue/map indefinitely.
    for (const [id, value] of jobs) if (value.state === 'failed' && value.retryAt <= Date.now()) jobs.delete(id)
    if (jobs.size >= 20) return { state: 'busy' }
    jobs.set(key, { state: 'processing' })
    queue = queue.then(async () => {
      try {
        await render(pdfPath, dir)
        jobs.delete(key)
      } catch (error) {
        jobs.set(key, { state: 'failed', retryAt: Date.now() + 30000 })
        console.error('PDF image conversion failed:', error.code || error.message)
        // Only derived files under this document hash are removed.
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    })
    return { state: 'processing' }
  }
  return { status }
}

function registerImageRoutes(app, { prefix, resolvePdf, store }) {
  app.get(prefix + '/images', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const pdfPath = await resolvePdf(req)
      if (!pdfPath) return res.status(404).json({ message: '链接已失效或文档不存在' })
      const result = await store.status(pdfPath)
      if (result.state === 'ready') return res.json({ state: 'ready', pages: result.pages, version: result.version })
      if (result.state === 'processing') return res.status(202).json({ state: 'processing' })
      res.status(503).json({ state: result.state, message: '图片暂时无法准备，请稍后重试或下载 PDF。' })
    } catch (error) { next(error) }
  })
  app.get(prefix + '/images/:page', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      if (!/^[1-9]\d{0,2}$/.test(req.params.page)) return res.status(404).end()
      // Validate token expiry/revocation on EVERY image request, including cached images.
      const pdfPath = await resolvePdf(req)
      if (!pdfPath) return res.status(404).end()
      const result = await store.status(pdfPath)
      const page = Number(req.params.page)
      if (result.state !== 'ready') return res.status(503).end()
      if (page > result.pages || (req.query.v && req.query.v !== result.version)) return res.status(404).end()
      res.type('image/jpeg').sendFile(path.join(result.dir, `${page}.jpg`), error => { if (error) next(error) })
    } catch (error) { next(error) }
  })
}

module.exports = { createImageStore, registerImageRoutes }

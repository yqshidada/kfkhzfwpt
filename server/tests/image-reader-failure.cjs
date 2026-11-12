// Verify missing/corrupt converter inputs are retryable without exposing partial images.
const fs = require('fs/promises')
const path = require('path')
const assert = require('assert/strict')
const { createImageStore } = require('../report-images')
const { imageReader } = require('../image-reader')

;(async () => {
  const root = path.resolve(__dirname, '../../tmp')
  await fs.mkdir(root, { recursive: true })
  const work = await fs.mkdtemp(path.join(root, 'image-failure-'))
  const previous = process.env.PDFINFO_PATH
  try {
    const source = path.resolve(__dirname, '../documents/admission-flow.pdf')
    process.env.PDFINFO_PATH = path.join(work, 'missing-pdfinfo.exe')
    const store = createImageStore(path.join(work, 'cache'))
    const concurrent = await Promise.all([store.status(source), store.status(source)])
    assert.ok(concurrent.every(result => ['processing', 'failed'].includes(result.state)))
    let state
    for (let i = 0; i < 100; i++) {
      state = await store.status(source)
      if (state.state === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(state.state, 'failed')
    assert.equal((await store.status(source)).state, 'failed', 'Failure cooldown should prevent repeated conversion attempts')
    const html = imageReader({ title: '<script>unsafe</script>', baseUrl: '/share/example' })
    assert.ok(!html.includes('<script>unsafe</script>'))
    assert.ok(html.includes('/share/example/pdf?download=1'))
    assert.ok(!html.includes('<iframe'))
    console.log('PASS: converter failure/cooldown, shared conversion job, escaped HTML and PDF fallback')
  } finally {
    if (previous === undefined) delete process.env.PDFINFO_PATH
    else process.env.PDFINFO_PATH = previous
    // Delete only this test's verified temporary directory.
    assert.equal(path.dirname(work), root)
    await fs.rm(work, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

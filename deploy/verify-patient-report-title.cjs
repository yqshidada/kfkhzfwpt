// Read-only verification of the deployed patient discharge report QR card title.
const fs = require('fs')
const https = require('https')
const assert = require('assert/strict')
const app = '/opt/rehab-app/server/public'
const decode = text => text.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
function request(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: 'gzitwmkfk.cn', path,
      lookup: (name, options, cb) => options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)
    }, response => {
      const chunks = []
      response.on('data', value => chunks.push(value))
      response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }))
    })
    req.setTimeout(15000, () => req.destroy(Error('Request timeout')))
    req.on('error', reject)
  })
}
;(async () => {
  const chunks = fs.readdirSync(app + '/static/js').filter(name => /^pages-nurse-detail\.[^.]+\.js$/.test(name))
  assert.equal(chunks.length, 1, 'Expected exactly one patient detail bundle')
  const bytes = fs.readFileSync(app + '/static/js/' + chunks[0])
  const text = decode(bytes.toString('utf8'))
  assert.ok(/card-title[\s\S]{0,120}患者出院报告二维码/.test(text), 'Patient discharge report QR card title missing')
  assert.ok(!/card-title[\s\S]{0,120}["']患者报告二维码["']/.test(text), 'Old QR card title remains')
  const remote = await request('/static/js/' + chunks[0])
  assert.equal(remote.status, 200)
  assert.equal(remote.bytes.compare(bytes), 0, 'HTTPS must serve the exact new patient detail bundle')
  console.log('PASS: exact HTTPS patient detail bundle displays 患者出院报告二维码 as the QR card title')
})().catch(error => { console.error('Patient report title verification failed:', error.code || error.message); process.exitCode = 1 })

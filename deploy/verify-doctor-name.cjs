// Read-only verification of the deployed corrected reservation doctor name.
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
  const chunks = fs.readdirSync(app + '/static/js').filter(name => /^pages-bed-reservation-index(?:~pages-nurse-list)?\.[^.]+\.js$/.test(name))
  assert.equal(chunks.length, 2, 'Expected reservation page and shared validation bundles')
  let text = ''
  for (const chunk of chunks) {
    const bytes = fs.readFileSync(app + '/static/js/' + chunk)
    text += decode(bytes.toString('utf8'))
    const remote = await request('/static/js/' + chunk)
    assert.equal(remote.status, 200)
    assert.equal(remote.bytes.compare(bytes), 0, 'HTTPS reservation/shared validation bundle mismatch')
  }
  const options = require('/opt/rehab-app/server/reservation-validation')
  assert.deepEqual(options.RESERVATION_DOCTORS, ['殷茵', '杨浩宇', '朱广浩', '饶志远', '其他'])
  for (const doctor of options.RESERVATION_DOCTORS) assert.ok(text.includes(doctor), 'Doctor option missing from H5: ' + doctor)
  assert.ok(!text.includes('姚志远'), 'Old doctor name remains in the form')
  console.log('PASS: exact HTTPS reservation form and backend doctor options use 饶志远')
})().catch(error => { console.error('Doctor name verification failed:', error.code || error.message); process.exitCode = 1 })

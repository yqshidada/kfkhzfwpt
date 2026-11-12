// Read-only verification of the deployed login heading.
const fs = require('fs')
const https = require('https')
const assert = require('assert/strict')
const app = '/opt/rehab-app/server/public'
const title = '康复科患者服务平台'
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
  const home = await request('/')
  assert.equal(home.status, 200)
  assert.equal(home.bytes.compare(fs.readFileSync(app + '/index.html')), 0)
  const matches = fs.readdirSync(app + '/static/js').filter(name => /^pages-bed-reservation-index\.[^.]+\.js$/.test(name))
  assert.equal(matches.length, 1, 'Expected exactly one reservation page bundle')
  const bytes = fs.readFileSync(app + '/static/js/' + matches[0])
  const text = decode(bytes.toString('utf8'))
  const warning = '⚠️预约仅排队登记，须等康复科电话通知入院，未通知请勿自行来院。'
  for (const value of [warning, 'booking-notice', 'bookingNotice', '提交前请确认', '已知晓，提交', '返回检查', 'confirmBookingNotice', 'validateSubmission', 'submissionBusy', '当前状态：预约中（仅排队登记）。请等待康复科电话通知入院。']) assert.ok(text.includes(value), 'Deployed notice/confirmation missing: ' + value)
  const remote = await request('/static/js/' + matches[0])
  assert.equal(remote.status, 200)
  assert.equal(remote.bytes.compare(bytes), 0, 'HTTPS reservation bundle mismatch')
  console.log('PASS: exact deployed HTTPS reservation bundle includes entry notice, pre-submit acknowledgement, return-to-check, submission lock and waiting-for-phone success notice; no appointment writes')
})().catch(error => { console.error('Admission notice verification failed:', error.code || error.message); process.exitCode = 1 })

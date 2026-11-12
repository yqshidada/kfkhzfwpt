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
  const response = await request('/')
  assert.equal(response.status, 200)
  assert.equal(response.bytes.compare(fs.readFileSync(app + '/index.html')), 0)
  assert.ok(response.bytes.toString('utf8').includes('<title>' + title + '</title>'), 'Platform name missing from browser title')
  const chunk = fs.readdirSync(app + '/static/js').find(name => /^pages-login-index\..+\.js$/.test(name))
  assert.ok(chunk, 'Login bundle missing')
  const bytes = fs.readFileSync(app + '/static/js/' + chunk)
  const text = decode(bytes.toString('utf8'))
  assert.ok(/brand-title[\s\S]{0,120}登录/.test(text), 'Login heading must be 登录')
  assert.ok(!text.includes('康复科出院指导'), 'Old login heading remains')
  for (const label of ['请输入手机号', '请输入密码', '暂不登录，返回首页']) assert.ok(text.includes(label), 'Existing login control missing')
  const remote = await request('/static/js/' + chunk)
  assert.equal(remote.status, 200)
  assert.equal(remote.bytes.compare(bytes), 0, 'HTTPS must serve the exact new login bundle')
  console.log('PASS: HTTPS login heading is updated, old heading absent, login controls and platform browser title retained')
})().catch(error => { console.error('Login title verification failed:', error.code || error.message); process.exitCode = 1 })

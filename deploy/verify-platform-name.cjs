// Read-only verification of the deployed homepage and platform name.
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
  const chunk = fs.readdirSync(app + '/static/js').find(name => /^pages-index-index\..+\.js$/.test(name))
  assert.ok(chunk, 'Homepage bundle missing')
  const bytes = fs.readFileSync(app + '/static/js/' + chunk)
  const text = decode(bytes.toString('utf8'))
  assert.ok(text.includes(title), 'Homepage title missing')
  assert.ok(!text.includes('功能入口'), 'Old homepage title remains')
  for (const label of ['入院流程', '预约床位', '患者入口', '护士入口', '出院流程', '退出登录']) assert.ok(text.includes(label), 'Existing entry missing')
  const remote = await request('/static/js/' + chunk)
  assert.equal(remote.status, 200)
  assert.equal(remote.bytes.compare(bytes), 0, 'HTTPS must serve the exact new homepage bundle')
  console.log('PASS: HTTPS homepage and browser title use the platform name; all existing entries and logout retained')
})().catch(error => { console.error('Platform name verification failed:', error.code || error.message); process.exitCode = 1 })

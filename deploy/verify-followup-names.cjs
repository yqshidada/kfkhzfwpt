// Verify the deployed report-generation bundle without modifying patient reports.
const fs = require('fs')
const https = require('https')
const assert = require('assert/strict')
const directory = '/opt/rehab-app/server/public/static/js'
const file = fs.readdirSync(directory).find(name => /^pages-hzjbxx-index\..+\.js$/.test(name))
assert.ok(file, 'Patient form bundle must exist')
const bytes = fs.readFileSync(directory + '/' + file)
// JavaScript minifiers may encode Chinese strings as Unicode escapes.
const text = bytes.toString('utf8').replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
for (const name of ['白艳甫副主任医师', '邓眉敏副主任医师']) assert.ok(text.includes(name), 'Corrected follow-up name missing from bundle')
for (const name of ['白艳青', '邓眉帆']) assert.ok(!text.includes(name), 'Old typo still in bundle')
const req = https.get({ hostname: 'gzitwmkfk.cn', path: '/static/js/' + file,
  lookup: (name, options, callback) => options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)
}, response => {
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  response.on('end', () => {
    try {
      assert.equal(response.statusCode, 200)
      assert.equal(Buffer.concat(chunks).compare(bytes), 0)
      console.log('PASS: HTTPS serves the exact new report-generation bundle with both corrected names and neither old typo')
    } catch (error) { console.error(error.message); process.exitCode = 1 }
  })
})
req.setTimeout(15000, () => req.destroy(new Error('Request timeout')))
req.on('error', error => { console.error(error.code || error.message); process.exitCode = 1 })

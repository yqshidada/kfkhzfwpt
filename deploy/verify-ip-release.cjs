// Run as root on the IP deployment target. Creates a marked verification record and removes it in finally.
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const assert = require('assert/strict')
const mysql = require('/opt/rehab-app/server/node_modules/mysql2/promise')
const config = {}
for (const line of fs.readFileSync('/opt/rehab-app/server/.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match) config[match[1]] = match[2]
}
const marker = `MIGRATION-CHECK-${crypto.randomUUID()}`
const requestId = crypto.randomUUID()
const tables = ['system_users', 'discharge_records', 'hospitalization_number_registry', 'discharge_record_shares', 'discharge_record_flows']
function request(route, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ hostname: '134.175.42.162', port: 80, path: route, method,
      lookup: (name, options, callback) => options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
    }, res => {
      const buffers = []
      res.on('data', data => buffers.push(data))
      res.on('end', () => {
        const bytes = Buffer.concat(buffers)
        resolve({ status: res.statusCode, headers: res.headers, bytes, text: bytes.toString('utf8') })
      })
    })
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}
function pdfDocument() {
  const stream = 'BT /F1 18 Tf 50 780 Td (Migration verification) Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
  ]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
;(async () => {
  const db = await mysql.createConnection({ user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: config.DB_NAME })
  async function counts() {
    const result = {}
    for (const table of tables) result[table] = Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n)
    return result
  }
  const before = await counts()
  let success = false
  try {
    assert.equal((await request('/api/health')).status, 200)
    const home = await request('/')
    assert.equal(home.status, 200)
    assert.equal(home.text, fs.readFileSync('/opt/rehab-app/server/public/index.html', 'utf8'))
    const assets = [...home.text.matchAll(/(?:src|href)=["']?([^"'\s>]+\.(?:js|css))/g)].map(match => match[1])
    assert.ok(assets.length > 0)
    for (const asset of assets) assert.equal((await request(new URL(asset, 'http://134.175.42.162/').pathname)).status, 200, asset)
    for (const route of ['/.env', '/index.js', '/storage/reports/test.pdf']) assert.equal((await request(route)).status, 404)
    assert.equal((await request('/api/discharge-records')).status, 401)
    const login = await request('/api/auth/login', { method: 'POST', body: { username: config.TEST_LOGIN_PHONE, password: config.TEST_LOGIN_PASSWORD } })
    assert.equal(login.status, 200, 'Migrated account login failed')
    const token = JSON.parse(login.text).token
    const currentUser = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
    const form = { hospitalizationNumber: marker, gender: '男', age: '60-70岁', phone: '13800138000', diagnosis: '脑卒中', hasDischargeMedication: '有', medicationTypes: ['降压药', '降糖药'], hasTube: '有', tubeTypes: ['PICC管', 'CVC管'], skinTypes: ['皮肤护理', '营养支持'] }
    const body = { requestId, form, reportSnapshot: [{ title: '迁移验证', items: ['临时验证记录'] }] }
    const created = await request('/api/discharge-records', { method: 'POST', token, body })
    assert.equal(created.status, 201, created.text)
    const record = JSON.parse(created.text).record
    assert.deepEqual(record.form, form)
    const createdAt = Date.parse(record.createdAt.replace(' ', 'T') + '+08:00')
    assert.ok(Math.abs(Date.now() - createdAt) < 120000, 'Shanghai timestamp mismatch')
    const route = `/api/discharge-records/${record.id}`
    assert.equal((await request(route, { token })).status, 200)
    const list = JSON.parse((await request('/api/discharge-records?keyword=' + encodeURIComponent(marker), { token })).text)
    assert.equal(list.items.length, 1)
    assert.equal((await request('/api/discharge-records', { method: 'POST', token, body: { ...body, requestId: crypto.randomUUID() } })).status, 409)
    const [[otherUser]] = await db.execute('SELECT id FROM system_users WHERE id <> ? ORDER BY id LIMIT 1', [currentUser])
    const jwtHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const jwtBody = Buffer.from(JSON.stringify({ sub: otherUser.id, exp: Math.floor(Date.now()/1000)+60 })).toString('base64url')
    const unsigned = `${jwtHeader}.${jwtBody}`
    const otherToken = unsigned + '.' + crypto.createHmac('sha256', config.JWT_SECRET).update(unsigned).digest('base64url')
    assert.equal((await request(route, { token: otherToken })).status, 404)
    assert.equal((await request(route + '/share', { token: otherToken })).status, 404)
    const pdf = pdfDocument()
    assert.equal((await request(route + '/share', { method: 'POST', token, body: { pdfBase64: Buffer.from('invalid document').toString('base64') } })).status, 400)
    const shared = await request(route + '/share', { method: 'POST', token, body: { pdfBase64: pdf.toString('base64'), fileName: 'migration-check.pdf' } })
    assert.equal(shared.status, 201, shared.text)
    const share = JSON.parse(shared.text).share
    assert.ok(share.qrDataUrl.startsWith('data:image/png;base64,'))
    assert.ok(share.url.startsWith('http://134.175.42.162/share/'))
    const sharePath = new URL(share.url).pathname
    assert.equal((await request(sharePath)).status, 200)
    const downloaded = await request(sharePath + '/pdf')
    assert.equal(downloaded.status, 200)
    assert.equal(downloaded.headers['content-type'], 'application/pdf')
    assert.deepEqual(downloaded.bytes, pdf)
    assert.equal((await request(route + '/share', { method: 'DELETE', token })).status, 200)
    assert.equal((await request(sharePath)).status, 404)
    assert.equal((await request(sharePath + '/pdf')).status, 404)
    const flowBody = { requestId: crypto.randomUUID(), form: { settlementMethod: '自助机结算', westernMedicine: '有', chineseMedicine: '无' }, pdfBase64: pdf.toString('base64') }
    const flow = await request(route + '/flow', { method: 'POST', token, body: flowBody })
    assert.equal(flow.status, 201, flow.text)
    const flowShare = JSON.parse(flow.text).flow.share
    assert.ok(flowShare.url.startsWith('http://134.175.42.162/share/'))
    assert.equal((await request(new URL(flowShare.url).pathname)).status, 200)
    assert.deepEqual((await request(new URL(flowShare.url).pathname + '/pdf')).bytes, pdf)
    const duplicate = await request(route + '/flow', { method: 'POST', token, body: { ...flowBody, requestId: crypto.randomUUID() } })
    assert.equal(duplicate.status, 409)
    assert.equal(JSON.parse(duplicate.text).message, '已生成出院流程，请前往患者详情页查看')
    assert.equal((await request(route + '/flow', { token: otherToken })).status, 404)
    assert.equal((await request('/api/admission-flow/share')).status, 401)
    const admission = JSON.parse((await request('/api/admission-flow/share', { token })).text).share
    assert.equal(admission.url, 'http://134.175.42.162/documents/admission-flow')
    assert.ok(admission.qrDataUrl.startsWith('data:image/png;base64,'))
    assert.equal((await request('/documents/admission-flow')).status, 200)
    assert.deepEqual((await request('/documents/admission-flow/pdf')).bytes, fs.readFileSync('/opt/rehab-app/server/documents/admission-flow.pdf'))
    for (const icon of ['admission', 'discharge']) assert.equal((await request('/static/icons/' + icon + '.svg')).status, 200)
    success = true
  } finally {
    const [rows] = await db.execute('SELECT r.id, s.file_path FROM discharge_records r LEFT JOIN discharge_record_shares s ON s.record_id=r.id WHERE r.request_id=? AND r.hospitalization_number=?', [requestId, marker])
    for (const row of rows) {
      const [flows] = await db.execute('SELECT file_path FROM discharge_record_flows WHERE record_id=?', [row.id])
      for (const flow of flows) {
        const storage = '/opt/rehab-app/server/storage/reports'
        const file = path.resolve(storage, flow.file_path)
        assert.equal(path.dirname(file), storage)
        if (fs.existsSync(file)) fs.unlinkSync(file)
      }
      if (row.file_path) {
        const storage = '/opt/rehab-app/server/storage/reports'
        const file = path.resolve(storage, row.file_path)
        assert.equal(path.dirname(file), storage)
        if (fs.existsSync(file)) fs.unlinkSync(file)
      }
      await db.execute('DELETE FROM discharge_records WHERE id=? AND request_id=?', [row.id, requestId])
    }
    await db.execute('DELETE FROM hospitalization_number_registry WHERE hospitalization_number=?', [marker])
    const after = await counts()
    await db.end()
    assert.deepEqual(after, before, 'Temporary data cleanup mismatch')
    console.log(JSON.stringify({ success, counts: after, temporaryDataCleaned: true }))
  }
  console.log('PASS: IP HTTP access, admission and discharge flow PDF/QR, H5 assets, login, record save/search/detail, account isolation, duplicate rejection, Shanghai time, QR generation, anonymous PDF download, revocation')
})().catch(error => { console.error(error.message); process.exitCode = 1 })

// Read-only / negative-request production smoke test. Never inserts test patients.
const fs = require('fs')
const https = require('https')
const crypto = require('crypto')
const assert = require('assert/strict')
const app = '/opt/rehab-app/server'
const config = {}
for (const line of fs.readFileSync(app + '/.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (match) config[match[1]] = match[2]
}
function request(route, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = https.request({ hostname: 'gzitwmkfk.cn', port: 443, path: route, method,
      lookup: (name, options, callback) => options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }
    }, res => {
      const buffers = []
      res.on('data', chunk => buffers.push(chunk))
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
function shortToken(id) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')
  return header + '.' + body + '.' + crypto.createHmac('sha256', config.JWT_SECRET).update(header + '.' + body).digest('base64url')
}
;(async () => {
  assert.equal((await request('/api/health')).status, 200)
  const home = await request('/')
  assert.equal(home.status, 200)
  assert.equal(home.text, fs.readFileSync(app + '/public/index.html', 'utf8'))
  const assets = [...home.text.matchAll(/(?:src|href)=["']?(\/static\/[^"'\s>]+)/g)].map(match => match[1])
  assert.ok(assets.length >= 2)
  for (const asset of assets) { const response = await request(asset); assert.equal(response.status, 200); assert.ok(!response.text.startsWith('<!DOCTYPE')) }
  const chunks = fs.readdirSync(app + '/public/static/js')
  for (const page of ['pages-bed-reservation-index.', 'pages-nurse-list.', 'pages-nurse-reservation-detail.', 'pages-hzjbxx-index.']) {
    const chunk = chunks.find(file => file.startsWith(page))
    assert.ok(chunk, 'Missing new H5 page chunk')
    const response = await request('/static/js/' + chunk)
    assert.equal(response.status, 200)
    assert.equal(response.bytes.compare(fs.readFileSync(app + '/public/static/js/' + chunk)), 0)
  }
  const captchaResponse = await request('/api/bed-reservations/captcha')
  assert.equal(captchaResponse.status, 200)
  assert.equal(captchaResponse.headers['cache-control'], 'no-store')
  const captcha = JSON.parse(captchaResponse.text)
  assert.match(captcha.id, /^[a-f0-9]{48}$/)
  assert.equal(captcha.expiresIn, 300)
  assert.ok(captcha.image.startsWith('data:image/svg+xml;base64,'))
  assert.equal(captcha.text, undefined)
  const svg = Buffer.from(captcha.image.split(',')[1], 'base64').toString('utf8')
  assert.ok(svg.includes('<path'))
  assert.ok(!svg.includes('<text'))
  assert.equal((svg.match(/<path\b/g) || []).length, 7, 'Four glyph paths plus three noise paths')
  const captchaModule = require(app + '/reservation-captcha')
  for (let i = 0; i < 100; i++) {
    const text = captchaModule.generateText()
    assert.match(text, /^[A-HJ-NP-Z2-9]{4}$/)
    assert.match(text, /[A-Z]/); assert.match(text, /[2-9]/)
  }
  // Isolated in-process service: test case-insensitive verification without
  // revealing live answers or creating production patient/reservation records.
  const isolated = captchaModule.createReservationCaptcha({ textFactory: () => 'A2B3' })
  const challenge = isolated.issue('local-release-unit')
  isolated.verify({ id: challenge.id, code: 'a2b3' }, 'local-release-unit', 'release-unit')
  assert.throws(() => isolated.verify({ id: challenge.id, code: 'A2B3C4' }, 'local-release-unit', 'release-unit'), error => error.code === 'CAPTCHA_INVALID')
  for (const route of ['/api/bed-reservations', '/api/bed-reservations/1', '/api/bed-reservations/reminders', '/api/discharge-records']) assert.equal((await request(route)).status, 401)
  assert.equal((await request('/api/bed-reservations', { method: 'POST', body: {} })).status, 400)
  assert.equal((await request('/api/bed-reservations/0/cancel', { method: 'POST', body: {} })).status, 401)
  assert.equal((await request('/api/bed-reservations/0/rebook', { method: 'POST', body: {} })).status, 401)
  assert.equal((await request('/api/bed-reservations/0', { method: 'DELETE' })).status, 401)
  const validShapeOnly = { requestId: crypto.randomUUID(), form: { name: 'RELEASE-NEGATIVE-CHECK', gender: '女', age: '30', phone: '13800138000', idCard: '11010519491231002X', diagnosis: '验证缺失验证码必定拒绝，不保存记录', reservationDate: '2099-12-31', specialNeeds: '' } }
  const missingCaptcha = await request('/api/bed-reservations', { method: 'POST', body: validShapeOnly })
  assert.equal(missingCaptcha.status, 400)
  assert.equal(JSON.parse(missingCaptcha.text).code, 'CAPTCHA_INVALID')
  assert.equal(JSON.parse(missingCaptcha.text).message, '请输入4位数字字母验证码')
  for (const value of [undefined, '', null]) {
    const optionalDate = await request('/api/bed-reservations', { method: 'POST', body: { ...validShapeOnly, requestId: crypto.randomUUID(), form: { ...validShapeOnly.form, reservationDate: value, repeatReservation: '是' } } })
    assert.equal(optionalDate.status, 400)
    assert.equal(JSON.parse(optionalDate.text).code, 'CAPTCHA_INVALID', 'Optional date and repeat option pass business checks, but captcha is still required')
  }
  const oldLength = await request('/api/bed-reservations', { method: 'POST', body: {
    ...validShapeOnly, captcha: { id: captcha.id, code: 'A2B3C4' }
  } })
  assert.equal(oldLength.status, 400)
  assert.equal(JSON.parse(oldLength.text).code, 'CAPTCHA_INVALID')
  const mysql = require(app + '/node_modules/mysql2/promise')
  // Test the real application account, not root or an invalid ID that exits before SQL.
  // Constant false means no existing booking can ever be removed.
  const applicationDb = await mysql.createConnection({ host: config.DB_HOST || '127.0.0.1', port: Number(config.DB_PORT || 3306), user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME })
  try {
    const [probe] = await applicationDb.execute('DELETE FROM bed_reservations WHERE 1 = 0')
    assert.equal(probe.affectedRows, 0)
  } finally { await applicationDb.end() }
  const db = await mysql.createConnection({ user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: config.DB_NAME })
  try {
    const [users] = await db.query('SELECT id FROM system_users ORDER BY id LIMIT 1')
    assert.ok(users.length)
    const token = shortToken(users[0].id)
    // Invalid-ID rebooking/delete probes fail before any database mutation.
    for (const [route, method] of [['/api/bed-reservations/0/rebook', 'POST'], ['/api/bed-reservations/0', 'DELETE']]) {
      const result = await request(route, { method, token, body: method === 'POST' ? {} : undefined })
      assert.equal(result.status, 400)
      assert.equal(JSON.parse(result.text).message, '预约编号无效')
    }
    const reminderResponse = await request('/api/bed-reservations/reminders', { token })
    assert.equal(reminderResponse.status, 200)
    assert.equal(reminderResponse.headers['cache-control'], 'no-store')
    const reminderSummary = JSON.parse(reminderResponse.text)
    assert.deepEqual(Object.keys(reminderSummary).sort(), ['date', 'total'])
    assert.match(reminderSummary.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(reminderSummary.date, require(app + '/bed-reservations').nextReservationDate())
    const expectedReminders = Number((await db.execute('SELECT COUNT(*) AS n FROM bed_reservations WHERE reservation_date = ? AND cancelled_at_ms IS NULL', [reminderSummary.date]))[0][0].n)
    assert.equal(reminderSummary.total, expectedReminders)
    const reminderList = await request('/api/bed-reservations?limit=1&reminder=tomorrow', { token })
    assert.equal(reminderList.status, 200)
    const due = JSON.parse(reminderList.text)
    assert.equal(due.total, expectedReminders)
    assert.ok(due.items.every(item => item.reservationDate === reminderSummary.date && item.status !== '取消预约'))
    assert.equal((await request('/api/bed-reservations?reminder=invalid', { token })).status, 400)
    const [dbCounts] = await db.query('SELECT COUNT(*) AS n FROM bed_reservations')
    for (const status of ['', '预约中', '预约成功', '取消预约']) {
      const response = await request('/api/bed-reservations?limit=1&status=' + encodeURIComponent(status), { token })
      assert.equal(response.status, 200)
      const value = JSON.parse(response.text)
      assert.ok(Array.isArray(value.items)); assert.ok(Number.isSafeInteger(value.total))
      if (!status) assert.equal(value.total, Number(dbCounts[0].n))
      else {
        const condition = status === '取消预约' ? 'cancelled_at_ms IS NOT NULL' : status === '预约中' ? 'confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL' : 'confirmed_at_ms IS NOT NULL AND cancelled_at_ms IS NULL'
        assert.equal(value.total, Number((await db.query('SELECT COUNT(*) AS n FROM bed_reservations WHERE ' + condition))[0][0].n))
      }
      for (const item of value.items) {
        assert.equal(item.specialNeeds, undefined); assert.equal(item.diagnosis, undefined);
        assert.equal(item.idCard, undefined); assert.equal(item.identity_fingerprint, undefined)
        assert.equal(item.doctor, undefined); assert.equal(item.tubeTypes, undefined); assert.equal(item.otherTube, undefined)
        if (status) assert.equal(item.status, status)
      }
    }
    assert.equal((await request('/api/discharge-records?limit=1', { token })).status, 200)
    const [columns] = await db.query('SHOW COLUMNS FROM bed_reservations')
    for (const field of ['reservation_date', 'special_needs', 'repeat_reservation', 'rebooked_from_id', 'rebooked_by_user_id', 'doctor', 'tube_types', 'other_tube', 'cancelled_at_ms', 'cancelled_by_user_id']) assert.ok(columns.some(column => column.Field === field))
    const [generated] = await db.query("SELECT GENERATION_EXPRESSION AS expression FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bed_reservations' AND COLUMN_NAME = 'pending_identity_fingerprint'")
    assert.ok(String(generated[0].expression).includes('cancelled_at_ms'), 'Cancelled reservations must release duplicate protection')
    for (const patch of [{ reservationDate: '2000-01-01' }, { reservationDate: '2099-02-30' }, { specialNeeds: 'a'.repeat(501) }, { repeatReservation: 'invalid' }, { reservationDate: {} }, { doctor: 'invalid' }, { tubeTypes: ['invalid'] }, { tubeTypes: ['其他'], otherTube: '' }]) {
      const rejected = await request('/api/bed-reservations', { method: 'POST', body: { ...validShapeOnly, requestId: crypto.randomUUID(), form: { ...validShapeOnly.form, ...patch } } })
      assert.equal(rejected.status, 400)
      assert.ok(!JSON.parse(rejected.text).code, 'Invalid business fields fail before captcha')
    }
    const [reminderIndexes] = await db.query("SHOW INDEX FROM bed_reservations WHERE Key_name = 'idx_bed_reservations_reminder'")
    assert.equal(reminderIndexes.length, 2)
    const [indexes] = await db.query("SHOW INDEX FROM bed_reservations WHERE Key_name = 'uq_bed_reservations_pending_identity'")
    assert.equal(indexes.length, 1); assert.equal(indexes[0].Non_unique, 0)
    // Negative test UUID must not have reached the database.
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM bed_reservations WHERE request_id = ?', [validShapeOnly.requestId]))[0][0].n, 0)
    let verifiedShares = 0
    for (const table of ['discharge_record_shares', 'discharge_record_flows']) {
      const [shares] = await db.query('SELECT token FROM ' + table + ' WHERE revoked_at IS NULL AND expires_at > NOW() LIMIT 3')
      for (const share of shares) {
        const base = '/share/' + encodeURIComponent(share.token)
        assert.equal((await request(base)).status, 200)
        const pdf = await request(base + '/pdf')
        assert.equal(pdf.status, 200); assert.ok(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
        let manifest
        for (let attempt = 0; attempt < 40; attempt++) {
          const response = await request(base + '/images')
          if (response.status === 200) { manifest = JSON.parse(response.text); break }
          assert.equal(response.status, 202)
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        assert.equal(manifest && manifest.state, 'ready')
        const image = await request(base + '/images/1?v=' + manifest.version)
        assert.equal(image.status, 200); assert.equal(image.bytes.subarray(0, 3).toString('hex'), 'ffd8ff')
        verifiedShares++
      }
    }
    console.log('Existing active report/flow shares verified without modification:', verifiedShares)
    console.log('PASS: HTTPS, new H5 assets, four-character mixed case-insensitive SVG captcha, six-character rejection, expiry, no-store, anonymous access guards, missing-captcha rejection, authenticated patient/reservation reads, staff tomorrow reminders, filters/counts, database uniqueness and zero inserted test patients')
  } finally { await db.end() }
  const pdf = await request('/documents/admission-flow/pdf')
  assert.equal(pdf.status, 200); assert.ok(pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
  let images
  for (let i = 0; i < 40; i++) {
    const response = await request('/documents/admission-flow/images')
    if (response.status === 200) { images = JSON.parse(response.text); break }
    assert.equal(response.status, 202)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.equal(images && images.state, 'ready')
  const firstImage = await request('/documents/admission-flow/images/1?v=' + images.version)
  assert.equal(firstImage.status, 200); assert.equal(firstImage.bytes.subarray(0, 3).toString('hex'), 'ffd8ff')
  console.log('PASS: fixed admission PDF and image reading remain available')
})().catch(error => { console.error('Production smoke test failed:', error.code || error.message); process.exitCode = 1 })

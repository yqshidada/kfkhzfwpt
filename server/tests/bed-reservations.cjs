// Isolated local integration tests. Never use production or existing business data.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const net = require('net')
const assert = require('assert/strict')
const { spawn } = require('child_process')
const mysql = require('mysql2/promise')
const { validateReservation, mapReservation, createSubmissionLimiter, initializeReservationTable, nextReservationDate } = require('../bed-reservations')
const root = path.resolve(__dirname, '../..')
const settings = {}
for (const line of fs.readFileSync(path.join(root, 'server/.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match) settings[match[1]] = match[2]
}
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(settings.DB_HOST || '127.0.0.1'), 'Local database only')
const database = 'rehab_reservation_test_' + crypto.randomBytes(6).toString('hex')
const work = path.join(root, 'tmp', database)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const form = { name: '预约测试', gender: '女', age: '68', phone: '13800138000', idCard: '11010519491231002X', diagnosis: '仅测试使用的诊断内容\n第二行', reservationDate: '2099-12-31', specialNeeds: '需要协助行动' }
function testId(sequence) {
  const prefix = '11010519900101' + String(sequence).padStart(3, '0')
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  return prefix + '10X98765432'[weights.reduce((sum, weight, i) => sum + Number(prefix[i]) * weight, 0) % 11]
}
async function freePort() {
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return port
}
;(async () => {
  assert.equal(nextReservationDate(new Date('2026-11-02T15:59:59Z')), '2026-11-03')
  assert.equal(nextReservationDate(new Date('2026-11-02T16:00:00Z')), '2026-11-04')
  assert.equal(nextReservationDate(new Date('2026-12-31T16:00:00Z')), '2027-01-02')
  assert.equal(nextReservationDate(new Date('2028-02-28T00:00:00Z')), '2028-02-29')
  assert.equal(validateReservation({ requestId: crypto.randomUUID(), form }).form.age, 68)
  for (const [field, message] of Object.entries({ name: '请输入姓名', gender: '请选择性别', age: '请输入年龄', phone: '请输入手机号', idCard: '请输入身份证号', diagnosis: '请输入诊断及病情介绍'  })) {
    for (const empty of ['', '   ', undefined]) assert.throws(() => validateReservation({ requestId: crypto.randomUUID(), form: { ...form, [field]: empty } }), error => error.message === message)
  }
  for (const value of [undefined, null, '', '   ']) {
    const optional = validateReservation({ requestId: crypto.randomUUID(), form: { ...form, reservationDate: value } }).form
    assert.equal(optional.reservationDate, '')
    assert.equal(optional.repeatReservation, '否')
  }
  assert.equal(validateReservation({ requestId: crypto.randomUUID(), form: { ...form, repeatReservation: '是' } }).form.repeatReservation, '是')
  for (const value of [true, false, 1, 'yes', null, '', {}, []]) assert.throws(() => validateReservation({ requestId: crypto.randomUUID(), form: { ...form, repeatReservation: value } }))
  const mapped = mapReservation({ id: 1, name: '测试', gender: '男', age: 60, phone: '13800138000', created_at_ms: 1000, confirmed_at_ms: 1000 + 216000000 }, true)
  assert.equal(mapped.waitingDays, 2.5)
  assert.equal(mapped.repeatReservation, null)
  // Appointment doctor/tubes are optional; 'other' requires a bounded free-text name.
  const careOptions = require('../reservation-validation')
  assert.deepEqual(careOptions.RESERVATION_DOCTORS, ['殷茵', '杨浩宇', '朱广浩', '姚志远', '其他'])
  assert.deepEqual(careOptions.RESERVATION_TUBES, ['胃管', '尿管', 'PICC管', '气切管', 'CVC管', '胃造瘘管', '输液港', '其他'])
  for (const doctor of careOptions.RESERVATION_DOCTORS) assert.equal(validateReservation({ requestId: crypto.randomUUID(), form: { ...form, doctor } }).form.doctor, doctor)
  for (const value of [undefined, null, '']) {
    const optional = validateReservation({ requestId: crypto.randomUUID(), form: { ...form, doctor: value, tubeTypes: value === '' ? [] : value } }).form
    assert.equal(optional.doctor, ''); assert.deepEqual(optional.tubeTypes, []); assert.equal(optional.otherTube, '')
  }
  const allCare = validateReservation({ requestId: crypto.randomUUID(), form: { ...form, doctor: ' 殷茵 ', tubeTypes: careOptions.RESERVATION_TUBES.slice().reverse(), otherTube: '  其他管道测试  ' } }).form
  assert.equal(allCare.doctor, '殷茵'); assert.deepEqual(allCare.tubeTypes, careOptions.RESERVATION_TUBES); assert.equal(allCare.otherTube, '其他管道测试')
  assert.deepEqual(validateReservation({ requestId: crypto.randomUUID(), form: { ...form, tubeTypes: ['胃管', '胃管', 'PICC管'] } }).form.tubeTypes, ['胃管', 'PICC管'])
  assert.equal(validateReservation({ requestId: crypto.randomUUID(), form: { ...form, otherTube: '未勾选时不保存' } }).form.otherTube, '')
  const invalidCare = [{ doctor: '不存在的医生' }, { doctor: 1 }, { doctor: {} }, { tubeTypes: '胃管' }, { tubeTypes: {} }, { tubeTypes: [null] }, { tubeTypes: ['不存在的管道'] }, { tubeTypes: Array(9).fill('胃管') }, { tubeTypes: ['其他'] }, { tubeTypes: ['其他'], otherTube: '  ' }, { tubeTypes: ['其他'], otherTube: 'a'.repeat(101) }, { otherTube: {} }]
  for (const patch of invalidCare) assert.throws(() => validateReservation({ requestId: crypto.randomUUID(), form: { ...form, ...patch } }))
  let accepted = 0, rejected = 0
  const limiter = createSubmissionLimiter()
  const response = { setHeader() {}, status(code) { assert.equal(code, 429); return this }, json() { rejected++ } }
  for (let i = 0; i < 31; i++) limiter({ ip: 'local-test' }, response, () => accepted++)
  assert.equal(accepted, 30); assert.equal(rejected, 1)

  const db = await mysql.createConnection({ host: settings.DB_HOST || '127.0.0.1', port: Number(settings.DB_PORT || 3306), user: settings.DB_USER || 'root', password: settings.DB_PASSWORD || '' })
  let child
  try {
    await db.query('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4')
    await db.changeUser({ database })
    // Simulate the old schema so startup must migrate without clearing data.
    await initializeReservationTable(db)
    await db.query('ALTER TABLE bed_reservations DROP INDEX uq_bed_reservations_pending_identity, DROP COLUMN pending_identity_fingerprint, DROP COLUMN identity_fingerprint, DROP COLUMN id_card_encrypted')
    await initializeReservationTable(db)
    assert.equal((await db.query("SHOW COLUMNS FROM bed_reservations LIKE 'identity_fingerprint'"))[0].length, 1, 'Old table gains identity lookup')
    // Simulate the previous generated expression, retaining the unique index.
    await db.query('ALTER TABLE bed_reservations MODIFY COLUMN pending_identity_fingerprint VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN confirmed_at_ms IS NULL THEN RTRIM(identity_fingerprint) ELSE NULL END) STORED')
    await db.query('ALTER TABLE bed_reservations DROP COLUMN reservation_date, DROP COLUMN special_needs, DROP COLUMN cancelled_at_ms, DROP COLUMN cancelled_by_user_id')
    await db.query('ALTER TABLE bed_reservations DROP COLUMN repeat_reservation, DROP COLUMN doctor, DROP COLUMN tube_types, DROP COLUMN other_tube')
    await initializeReservationTable(db)
    assert.equal((await db.query("SHOW COLUMNS FROM bed_reservations LIKE 'repeat_reservation'"))[0].length, 1, 'Old tables gain a nullable repeat option')
    for (const name of ['doctor', 'tube_types', 'other_tube']) assert.equal((await db.query('SHOW COLUMNS FROM bed_reservations LIKE ?', [name]))[0].length, 1, 'Old schema gains care field')
    const [migrationColumns] = await db.query("SHOW COLUMNS FROM bed_reservations LIKE 'cancelled_at_ms'")
    assert.equal(migrationColumns.length, 1)
    await db.query('ALTER TABLE bed_reservations DROP INDEX uq_bed_reservations_pending_identity, DROP COLUMN pending_identity_fingerprint, DROP COLUMN identity_fingerprint')
    // Resume an interrupted migration with a CHAR source column, too. RTRIM makes
    // the stored generated column independent of PAD_CHAR_TO_FULL_LENGTH sql_mode.
    await db.query('ALTER TABLE bed_reservations ADD COLUMN identity_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL')
    fs.mkdirSync(work, { recursive: true })
    for (const file of ['index.js', 'discharge-flow.js', 'bed-reservations.js', 'reservation-validation.js', 'reservation-identity.js', 'reservation-captcha.js', 'report-images.js', 'image-reader.js', 'image-reader-client.js']) fs.copyFileSync(path.join(root, 'server', file), path.join(work, file))
    // Deterministic generator exists only in this disposable test copy, never in the real server.
    fs.appendFileSync(path.join(work, 'reservation-captcha.js'), "\nconst originalFactory = module.exports.createReservationCaptcha; module.exports.createReservationCaptcha = options => originalFactory({ ...options, textFactory: () => 'A2B3' });\n")
    fs.cpSync(path.join(root, 'server/documents'), path.join(work, 'documents'), { recursive: true })
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(work, 'node_modules'), 'junction')
    const port = await freePort()
    const base = 'http://127.0.0.1:' + port
    child = spawn(process.execPath, ['index.js'], { cwd: work, env: { ...process.env, ...settings, NODE_ENV: 'test', DB_NAME: database, HOST: '127.0.0.1', PORT: String(port), JWT_SECRET: crypto.randomBytes(32).toString('hex'), RESERVATION_ID_KEY: crypto.randomBytes(32).toString('hex'), TEST_LOGIN_PHONE: '13800138000', TEST_LOGIN_PASSWORD: 'ReservationTest1234', SHARE_BASE_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] })
    let logs = ''
    child.stdout.on('data', value => { logs += value })
    child.stderr.on('data', value => { logs += value })
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error('Test server stopped: ' + logs)
      try { ready = (await (await fetch(base + '/api/health')).json()).ok } catch (_) {}
      if (ready) break
      await sleep(100)
    }
    assert.ok(ready, 'Test server health')
    let testIp = '192.0.2.10'
    async function request(url, method = 'GET', body, token) {
      const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': testIp, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: response.status, data: await response.json(), headers: response.headers }
    }
    const url = '/api/bed-reservations'
    async function submitFresh(value, requestId = crypto.randomUUID()) {
      const fresh = await request(url + '/captcha')
      assert.equal(fresh.status, 200)
      return request(url, 'POST', { requestId, form: value, captcha: { id: fresh.data.id, code: 'A2B3' } })
    }
    const login = await request('/api/auth/login', 'POST', { username: '13800138000', password: 'ReservationTest1234' })
    assert.equal(login.status, 200)
    const token = login.data.token
    for (const [route, method] of [[url + '/reminders', 'GET'], [url, 'GET'], [url + '/1', 'GET'], [url + '/1/confirm', 'POST'], [url + '/1/cancel', 'POST'], ['/api/discharge-records', 'GET']]) assert.equal((await request(route, method)).status, 401)
    for (const patch of [{ name: '' }, { name: '字'.repeat(51) }, { gender: '未知' }, { age: '121' }, { age: '-1' }, { age: '2.5' }, { phone: '123' }, { phone: '020-12345678' }, { idCard: '' }, { idCard: '110105194912310020' }, { diagnosis: '' }, { reservationDate: '2026-02-30' }, { reservationDate: '2000-01-01' }, { specialNeeds: 'a'.repeat(501) }, { repeatReservation: 'yes' }, { repeatReservation: 1 }, { reservationDate: {} }]) {
      assert.equal((await request(url, 'POST', { requestId: crypto.randomUUID(), form: { ...form, ...patch } })).status, 400)
    }
    assert.equal((await request(url, 'POST', { requestId: 'bad', form })).status, 400)
    // Validation cases have their own rate-limit bucket; preserve the real limit.
    testIp = '192.0.2.9'
    const challenge = await request(url + '/captcha')
    assert.equal(challenge.status, 200)
    assert.equal(challenge.headers.get('cache-control'), 'no-store')
    assert.equal(challenge.data.text, undefined)
    assert.ok(challenge.data.image.startsWith('data:image/svg+xml;base64,'))
    assert.equal((await request(url, 'POST', { requestId: crypto.randomUUID(), form })).data.code, 'CAPTCHA_INVALID')
    const wrong = await request(url, 'POST', { requestId: crypto.randomUUID(), form, captcha: { id: challenge.data.id, code: 'ZZ99' } })
    assert.equal(wrong.data.code, 'CAPTCHA_INVALID')
    assert.equal((await request(url, 'POST', { requestId: crypto.randomUUID(), form, captcha: { id: challenge.data.id, code: 'A2B3' } })).data.code, 'CAPTCHA_EXPIRED')
    const goodChallenge = await request(url + '/captcha')
    const captcha = { id: goodChallenge.data.id, code: 'a2b3' }
    const requestId = crypto.randomUUID()
    const payload = { requestId, form, captcha, status: '预约成功', createdAt: '2000-01-01', confirmedAt: '2000-01-02' }
    const creationStart = Date.now()
    const firstAttempts = await Promise.all(Array.from({ length: 3 }, () => request(url, 'POST', payload)))
    for (const attempt of firstAttempts) assert.equal(attempt.status, 201, 'Concurrent identical submissions reuse one challenge')
    const created = firstAttempts[0]
    assert.equal(created.status, 201)
    assert.equal(created.data.accepted, true)
    assert.equal(created.data.reservation, undefined, 'Anonymous receipt must not expose private records')
    for (const retry of await Promise.all(Array.from({ length: 3 }, () => request(url, 'POST', payload)))) assert.equal(retry.status, 201)
    assert.equal((await request(url, 'POST', { requestId: crypto.randomUUID(), form, captcha })).data.code, 'CAPTCHA_USED')
    assert.equal((await request(url, 'POST', { requestId, form })).status, 201, 'Saved receipt can be retried after challenge expiry')
    const [initialRows] = await db.query('SELECT * FROM bed_reservations')
    assert.equal(initialRows.length, 1, 'Network retries are idempotent')
    const id = initialRows[0].id
    assert.ok(Number(initialRows[0].created_at_ms) >= creationStart)
    assert.equal(initialRows[0].confirmed_at_ms, null)
    assert.match(initialRows[0].identity_fingerprint, /^[a-f0-9]{64}$/)
    assert.equal(initialRows[0].pending_identity_fingerprint, initialRows[0].identity_fingerprint)
    assert.ok(!initialRows[0].identity_fingerprint.includes(form.idCard))
    const duplicate = await submitFresh({ ...form, idCard: form.idCard.toLowerCase(), name: '改过的姓名', phone: '13900139000' })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.data.code, 'RESERVATION_ALREADY_PENDING')
    assert.equal(duplicate.data.reservation, undefined, 'Duplicate receipt must not disclose another record')
    // Existing encrypted records without the new fingerprint must also block resubmission.
    await db.execute('UPDATE bed_reservations SET identity_fingerprint = NULL WHERE id = ?', [id])
    assert.equal((await submitFresh({ ...form, phone: '13900139000' })).status, 409)
    await db.execute('UPDATE bed_reservations SET identity_fingerprint = ? WHERE id = ?', [initialRows[0].identity_fingerprint, id])
    assert.ok(initialRows[0].id_card_encrypted.startsWith('v1.'))
    assert.ok(!initialRows[0].id_card_encrypted.includes(form.idCard), 'Identity must not be stored in plaintext')
    assert.equal((await request(url, 'POST', { requestId, form: { ...form, name: '修改后的测试名' } })).status, 409)
    let detail = await request(url + '/' + id, 'GET', undefined, token)
    assert.equal(detail.data.reservation.status, '预约中')
    assert.equal(detail.data.reservation.waitingDays, null)
    assert.equal(detail.data.reservation.diagnosis, form.diagnosis)
    assert.equal(detail.data.reservation.reservationDate, form.reservationDate)
    assert.equal(detail.data.reservation.repeatReservation, '否')
    assert.equal(detail.data.reservation.specialNeeds, form.specialNeeds)
    assert.equal(detail.data.reservation.idCard, form.idCard)
    assert.equal(detail.data.reservation.identity_fingerprint, undefined)
    assert.equal(detail.data.reservation.pending_identity_fingerprint, undefined)
    assert.equal(detail.data.reservation.id_card_encrypted, undefined)
    assert.equal(detail.headers.get('cache-control'), 'no-store')
    assert.equal((await request(url + '/999999', 'GET', undefined, token)).status, 404)
    assert.equal((await request(url + '/bad', 'GET', undefined, token)).status, 400)
    assert.equal((await request(url + '/999999/confirm', 'POST', {}, token)).status, 404)
    // Multiple authenticated staff accounts share the anonymous reservation queue.
    await db.execute('INSERT INTO system_users (username, password_hash) SELECT ?, password_hash FROM system_users WHERE username = ?', ['13900139000', '13800138000'])
    const otherLogin = await request('/api/auth/login', 'POST', { username: '13900139000', password: 'ReservationTest1234' })
    assert.equal(otherLogin.status, 200)
    assert.equal((await request(url + '/' + id, 'GET', undefined, otherLogin.data.token)).status, 200)
    const earlier = Date.now() - 216000000
    await db.execute('UPDATE bed_reservations SET created_at_ms = ? WHERE id = ?', [earlier, id])
    const results = await Promise.all([token, otherLogin.data.token, token].map(staffToken => request(url + '/' + id + '/confirm', 'POST', { confirmedAt: '2030-01-01' }, staffToken)))
    const confirmedAt = results[0].data.reservation.confirmedAt
    for (const result of results) {
      assert.equal(result.status, 200)
      assert.equal(result.data.reservation.status, '预约成功')
      assert.equal(result.data.reservation.confirmedAt, confirmedAt)
      assert.ok(result.data.reservation.waitingDays >= 2.5 && result.data.reservation.waitingDays < 2.51)
    }
    await sleep(40)
    assert.equal((await request(url + '/' + id + '/confirm', 'POST', {}, token)).data.reservation.confirmedAt, confirmedAt, 'Repeat confirmation preserves timestamp')
    const [audit] = await db.execute('SELECT confirmed_by_user_id FROM bed_reservations WHERE id = ?', [id])
    assert.ok(audit[0].confirmed_by_user_id)
    testIp = '192.0.2.11'
    for (const [i, name] of ['测试乙', '测试丙'].entries()) {
      const fresh = await request(url + '/captcha')
      assert.equal((await request(url, 'POST', { requestId: crypto.randomUUID(), form: { ...form, name, idCard: testId(i + 2), phone: '13900139000' }, captcha: { id: fresh.data.id, code: 'A2B3' } })).status, 201)
    }
    const page1 = await request(url + '?limit=2', 'GET', undefined, token)
    assert.equal(page1.data.items.length, 2)
    assert.equal(page1.data.total, 3)
    assert.equal(page1.data.hasMore, true)
    assert.equal(page1.data.items[0].diagnosis, undefined)
    assert.equal(page1.data.items[0].idCard, undefined, 'Lists must not disclose identity numbers')
    assert.equal(page1.data.items[0].identity_fingerprint, undefined, 'Lists must not expose identity lookup tokens')
    const page2 = await request(url + '?limit=2&cursor=' + page1.data.nextCursor, 'GET', undefined, token)
    assert.equal(page2.data.items.length, 1)
    assert.equal(page2.data.total, 3, 'Total must not shrink on page two')
    assert.equal(page2.data.items[0].id, id)
    assert.equal(page2.data.hasMore, false)
    assert.equal(new Set([...page1.data.items, ...page2.data.items].map(x => x.id)).size, 3)
    assert.equal((await request(url + '?keyword=' + encodeURIComponent('测试乙'), 'GET', undefined, token)).data.items.length, 1)
    assert.equal((await request(url + '?keyword=13800138000', 'GET', undefined, token)).data.items.length, 1)
    assert.equal((await request(url + '?keyword=' + encodeURIComponent("' OR 1=1 --"), 'GET', undefined, token)).data.items.length, 0)
    for (const query of ['limit=0', 'limit=101', 'limit=bad', 'cursor=abc']) assert.equal((await request(url + '?' + query, 'GET', undefined, token)).status, 400)
    for (const [status, expected] of [['预约中', 2], ['预约成功', 1]]) {
      const filtered = await request(url + '?status=' + encodeURIComponent(status) + '&limit=1', 'GET', undefined, token)
      assert.equal(filtered.data.total, expected)
      assert.equal(filtered.data.items.length, 1)
      assert.equal(filtered.data.items[0].status, status)
      if (filtered.data.hasMore) {
        const next = await request(url + '?status=' + encodeURIComponent(status) + '&limit=1&cursor=' + filtered.data.nextCursor, 'GET', undefined, token)
        assert.equal(next.data.total, expected)
        assert.equal(next.data.items[0].status, status)
      }
    }
    for (const [keyword, status, total] of [['测试', '预约中', 2], ['测试乙', '预约中', 1], ['13800138000', '预约成功', 1], ['13800138000', '预约中', 0], ['没有此人', '预约成功', 0]]) {
      const filtered = await request(url + '?keyword=' + encodeURIComponent(keyword) + '&status=' + encodeURIComponent(status), 'GET', undefined, token)
      assert.equal(filtered.status, 200)
      assert.equal(filtered.data.total, total)
      assert.equal(filtered.data.items.length, total)
    }
    for (const invalid of ['unknown', '预约取消']) assert.equal((await request(url + '?status=' + encodeURIComponent(invalid), 'GET', undefined, token)).status, 400)
    assert.equal((await request(url + '?status=a&status=b', 'GET', undefined, token)).status, 400)
    // Legacy reservations have no ID; preserve them and expose an explicit null in details.
    await db.execute('UPDATE bed_reservations SET id_card_encrypted = NULL WHERE id = ?', [id])
    assert.equal((await request(url + '/' + id, 'GET', undefined, token)).data.reservation.idCard, null)
    await initializeReservationTable(db)
    assert.equal((await db.query('SELECT COUNT(*) AS count FROM bed_reservations'))[0][0].count, 3)
    testIp = '192.0.2.12'
    // Confirmed identities may book again, but their new pending booking blocks the next one.
    assert.equal((await submitFresh(form)).status, 201)
    assert.equal((await submitFresh(form)).status, 409)
    // New request IDs and independent valid captchas do not bypass database uniqueness.
    const concurrentForm = { ...form, idCard: testId(4), name: '并发预约测试' }
    const freshChallenges = await Promise.all(Array.from({ length: 6 }, () => request(url + '/captcha')))
    const concurrent = await Promise.all(freshChallenges.map(challenge => request(url, 'POST', {
      requestId: crypto.randomUUID(), form: concurrentForm, captcha: { id: challenge.data.id, code: 'A2B3' }
    })))
    assert.equal(concurrent.filter(result => result.status === 201).length, 1)
    for (const result of concurrent.filter(result => result.status !== 201)) {
      assert.equal(result.status, 409)
      assert.equal(result.data.code, 'RESERVATION_ALREADY_PENDING')
    }
    // Same name/phone does not merge different verified-format identities.
    assert.equal((await submitFresh({ ...concurrentForm, idCard: testId(5) })).status, 201)
    const [active] = await db.execute('SELECT id, identity_fingerprint FROM bed_reservations WHERE name = ? AND id_card_encrypted IS NOT NULL', ['并发预约测试'])
    assert.equal(active.length, 2)
    const activeId = active[0].id
    await request(url + '/' + activeId + '/confirm', 'POST', {}, token)
    const confirmedRow = (await db.execute('SELECT pending_identity_fingerprint FROM bed_reservations WHERE id = ?', [activeId]))[0][0]
    assert.equal(confirmedRow.pending_identity_fingerprint, null, 'Confirmation atomically releases the unique pending identity')
    // Very old records without an ID use name+phone conservatively; preserve all old rows.
    const oldRequest = crypto.randomUUID(), legacyName = '无身份证历史测试'
    await db.execute('INSERT INTO bed_reservations (request_id, payload_hash, name, gender, age, phone, diagnosis, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [oldRequest, '0'.repeat(64), legacyName, '女', 68, '13800138000', '旧记录', Date.now()])
    const legacyForm = { ...form, name: legacyName, idCard: testId(6) }
    assert.equal((await submitFresh(legacyForm)).status, 409)
    const legacyId = (await db.execute('SELECT id FROM bed_reservations WHERE request_id = ?', [oldRequest]))[0][0].id
    assert.equal((await request(url + '/' + legacyId + '/confirm', 'POST', {}, token)).status, 200)
    assert.equal((await submitFresh(legacyForm)).status, 201)
    // Distinct request IDs with the same identity cannot be inserted even directly in SQL.
    const pendingRecord = (await db.execute('SELECT * FROM bed_reservations WHERE identity_fingerprint IS NOT NULL AND confirmed_at_ms IS NULL LIMIT 1'))[0][0]
    await assert.rejects(db.execute('INSERT INTO bed_reservations (request_id, payload_hash, name, gender, age, phone, diagnosis, created_at_ms, identity_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), '1'.repeat(64), '数据库约束测试', '女', 30, '13800138000', '测试', Date.now(), pendingRecord.identity_fingerprint]), error => error.code === 'ER_DUP_ENTRY')
    testIp = '192.0.2.40'
    const cancelForm = { ...form, idCard: testId(40), name: '取消测试' }
    assert.equal((await submitFresh(cancelForm)).status, 201)
    const cancelId = (await db.execute('SELECT MAX(id) AS id FROM bed_reservations'))[0][0].id
    assert.equal((await request(url + '/999999/cancel', 'POST', {}, token)).status, 404)
    assert.equal((await request(url + '/bad/cancel', 'POST', {}, token)).status, 400)
    const cancelled = await Promise.all([token, otherLogin.data.token].map(t => request(url + '/' + cancelId + '/cancel', 'POST', {}, t)))
    for (const response of cancelled) {
      assert.equal(response.status, 200)
      assert.equal(response.data.reservation.status, '取消预约')
      assert.equal(response.data.reservation.cancelledAt, cancelled[0].data.reservation.cancelledAt)
      assert.equal(response.data.reservation.waitingDays, null)
    }
    assert.equal((await request(url + '/' + cancelId + '/confirm', 'POST', {}, token)).status, 409)
    assert.equal((await request(url + '/' + cancelId + '/cancel', 'POST', {}, token)).data.reservation.cancelledAt, cancelled[0].data.reservation.cancelledAt)
    const cancelledAudit = (await db.execute('SELECT pending_identity_fingerprint, cancelled_by_user_id FROM bed_reservations WHERE id = ?', [cancelId]))[0][0]
    assert.equal(cancelledAudit.pending_identity_fingerprint, null)
    assert.ok(cancelledAudit.cancelled_by_user_id)
    assert.equal((await submitFresh(cancelForm)).status, 201, 'Cancelled identities may rebook')
    const cancelledList = await request(url + '?status=' + encodeURIComponent('取消预约') + '&keyword=' + encodeURIComponent('取消测试'), 'GET', undefined, token)
    assert.equal(cancelledList.status, 200)
    assert.equal(cancelledList.data.total, 1)
    assert.equal(cancelledList.data.items[0].id, cancelId)
    assert.equal(cancelledList.data.items[0].specialNeeds, undefined)
    assert.equal(cancelledList.data.items[0].idCard, undefined)
    for (const status of ['预约中', '预约成功']) {
      const filtered = await request(url + '?status=' + encodeURIComponent(status), 'GET', undefined, token)
      assert.ok(filtered.data.items.every(item => item.status === status))
      assert.ok(filtered.data.items.every(item => item.id !== cancelId))
    }
    // A confirmed appointment can be cancelled without losing its confirmation audit.
    const cancelConfirmed = await request(url + '/' + id + '/cancel', 'POST', {}, token)
    assert.equal(cancelConfirmed.data.reservation.status, '取消预约')
    assert.equal(cancelConfirmed.data.reservation.confirmedAt, confirmedAt)
    assert.equal(cancelConfirmed.data.reservation.waitingDays, null)
    const raceForm = { ...form, idCard: testId(41), name: '状态并发测试' }
    assert.equal((await submitFresh(raceForm)).status, 201)
    const raceId = (await db.execute('SELECT MAX(id) AS id FROM bed_reservations'))[0][0].id
    const raced = await Promise.all([
      request(url + '/' + raceId + '/confirm', 'POST', {}, token),
      request(url + '/' + raceId + '/cancel', 'POST', {}, otherLogin.data.token)
    ])
    assert.ok([200, 409].includes(raced[0].status))
    assert.equal(raced[1].status, 200)
    assert.equal((await request(url + '/' + raceId, 'GET', undefined, token)).data.reservation.status, '取消预约')
    assert.equal((await submitFresh(raceForm)).status, 201)
    // Legacy cancellation is excluded from the name/phone fallback too.
    const oldCancelRequest = crypto.randomUUID()
    await db.execute('INSERT INTO bed_reservations (request_id, payload_hash, name, gender, age, phone, diagnosis, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [oldCancelRequest, '0'.repeat(64), '旧取消测试', '女', 68, '13800138000', '旧记录', Date.now()])
    const oldCancelId = (await db.execute('SELECT id FROM bed_reservations WHERE request_id = ?', [oldCancelRequest]))[0][0].id
    const oldDetail = await request(url + '/' + oldCancelId, 'GET', undefined, token)
    assert.equal(oldDetail.data.reservation.reservationDate, null)
    assert.equal(oldDetail.data.reservation.repeatReservation, null)
    assert.equal(oldDetail.data.reservation.specialNeeds, '')
    await request(url + '/' + oldCancelId + '/cancel', 'POST', {}, token)
    assert.equal((await submitFresh({ ...form, idCard: testId(42), name: '旧取消测试' })).status, 201)
    // Calendar reminders include pending and confirmed, not cancelled/undated/other dates.
    const tomorrow = nextReservationDate()
    const dayAfter = nextReservationDate(new Date(Date.now() + 86400000))
    const reminderIds = []
    for (const [date, confirmed, cancelled] of [[tomorrow, false, false], [tomorrow, true, false], [tomorrow, false, true], [dayAfter, false, false], [null, false, false]]) {
      const [insert] = await db.execute('INSERT INTO bed_reservations (request_id, payload_hash, name, gender, age, phone, diagnosis, reservation_date, created_at_ms, confirmed_at_ms, cancelled_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), '0'.repeat(64), '站内提醒测试', '女', 68, '13800138000', '隔离提醒测试', date, Date.now(), confirmed ? Date.now() : null, cancelled ? Date.now() : null])
      reminderIds.push(insert.insertId)
    }
    const reminderSummary = await request(url + '/reminders', 'GET', undefined, token)
    assert.equal(reminderSummary.status, 200)
    assert.equal(reminderSummary.headers.get('cache-control'), 'no-store')
    assert.deepEqual(reminderSummary.data, { date: tomorrow, total: 2 }, 'Summary is aggregate-only and not page/search dependent')
    assert.equal((await request(url + '?reminder=invalid', 'GET', undefined, token)).status, 400)
    const duePage1 = await request(url + '?reminder=tomorrow&limit=1', 'GET', undefined, token)
    assert.equal(duePage1.status, 200)
    assert.equal(duePage1.data.total, 2)
    assert.equal(duePage1.data.reminderDate, tomorrow)
    assert.equal(duePage1.data.hasMore, true)
    const duePage2 = await request(url + '?reminder=tomorrow&limit=1&cursor=' + duePage1.data.nextCursor, 'GET', undefined, token)
    assert.equal(duePage2.data.total, 2)
    assert.equal(duePage2.data.hasMore, false)
    assert.deepEqual([duePage1.data.items[0].id, duePage2.data.items[0].id].sort((a,b) => a-b), reminderIds.slice(0,2))
    for (const status of ['预约中', '预约成功', '取消预约']) {
      const filtered = await request(url + '?reminder=tomorrow&status=' + encodeURIComponent(status), 'GET', undefined, token)
      assert.equal(filtered.data.total, status === '取消预约' ? 0 : 1)
      assert.ok(filtered.data.items.every(item => item.status === status && item.reservationDate === tomorrow))
    }
    const noneDue = await request(url + '?reminder=tomorrow&keyword=no-reminder-matches', 'GET', undefined, token)
    assert.equal(noneDue.data.total, 0)
    assert.equal((await request(url + '/reminders', 'GET', undefined, otherLogin.data.token)).data.total, 2)
    await request(url + '/' + reminderIds[0] + '/cancel', 'POST', {}, token)
    assert.equal((await request(url + '/reminders', 'GET', undefined, token)).data.total, 1, 'Cancellation removes a reminder immediately')
    await request(url + '/' + reminderIds[1] + '/cancel', 'POST', {}, token)
    assert.equal((await request(url + '/reminders', 'GET', undefined, token)).data.total, 0)
    testIp = '192.0.2.60'
    // New and cached clients can omit the date. Persist SQL NULL, not an empty/fake date.
    const optionalIds = []
    for (const [index, date] of [undefined, null, '', '   '].entries()) {
      const optionalForm = { ...form, idCard: testId(60 + index), reservationDate: date, repeatReservation: index % 2 ? '否' : '是' }
      const optionalRequestId = crypto.randomUUID()
      assert.equal((await submitFresh(optionalForm, optionalRequestId)).status, 201)
      const stored = (await db.execute('SELECT id, reservation_date, repeat_reservation FROM bed_reservations WHERE request_id = ?', [optionalRequestId]))[0][0]
      optionalIds.push(stored.id)
      assert.equal(stored.reservation_date, null)
      assert.equal(stored.repeat_reservation, optionalForm.repeatReservation === '是' ? 1 : 0)
      const optionalDetail = await request(url + '/' + stored.id, 'GET', undefined, token)
      assert.equal(optionalDetail.data.reservation.reservationDate, null)
      assert.equal(optionalDetail.data.reservation.repeatReservation, optionalForm.repeatReservation)
      assert.equal((await request(url, 'POST', { requestId: optionalRequestId, form: optionalForm })).status, 201, 'Same no-date request remains idempotent')
      assert.equal((await request(url, 'POST', { requestId: optionalRequestId, form: { ...optionalForm, repeatReservation: optionalForm.repeatReservation === '是' ? '否' : '是' } })).status, 409, 'Repeat option is included in the request hash')
      const blocked = await submitFresh({ ...optionalForm, repeatReservation: '是' })
      assert.equal(blocked.status, 409, 'Repeat booking declaration never bypasses pending-identity prevention')
      assert.equal(blocked.data.code, 'RESERVATION_ALREADY_PENDING')
    }
    assert.equal((await request(url + '/reminders', 'GET', undefined, token)).data.total, 0, 'Undated bookings do not generate a tomorrow reminder')
    const dueAfterOptional = await request(url + '?reminder=tomorrow', 'GET', undefined, token)
    assert.equal(dueAfterOptional.data.total, 0)
    const optionalList = await request(url + '?limit=100', 'GET', undefined, token)
    for (const id of optionalIds) assert.ok(optionalList.data.items.some(item => item.id === id && ['是', '否'].includes(item.repeatReservation) && item.reservationDate === null))
    // A previously saved default-no request from the old release still has a valid receipt.
    const legacyRequestId = crypto.randomUUID()
    const legacyRetryForm = { ...form, idCard: testId(64) }
    assert.equal((await submitFresh(legacyRetryForm, legacyRequestId)).status, 201)
    const { repeatReservation: ignored, doctor: ignoredDoctor, tubeTypes: ignoredTubes, otherTube: ignoredOther, ...legacyNormalized } = validateReservation({ requestId: legacyRequestId, form: legacyRetryForm }).form
    const oldHash = crypto.createHash('sha256').update(JSON.stringify(legacyNormalized)).digest('hex')
    await db.execute('UPDATE bed_reservations SET payload_hash = ?, repeat_reservation = NULL WHERE request_id = ?', [oldHash, legacyRequestId])
    assert.equal((await request(url, 'POST', { requestId: legacyRequestId, form: legacyRetryForm })).status, 201)
    assert.equal((await request(url, 'POST', { requestId: legacyRequestId, form: { ...legacyRetryForm, repeatReservation: '否' } })).status, 201)
    assert.equal((await request(url, 'POST', { requestId: legacyRequestId, form: { ...legacyRetryForm, repeatReservation: '是' } })).status, 409)
    assert.equal((await request(url, 'POST', { requestId: legacyRequestId, form: { ...legacyRetryForm, reservationDate: '' } })).status, 409)
    const optionalConfirmed = await request(url + '/' + optionalIds[0] + '/confirm', 'POST', {}, token)
    assert.equal(optionalConfirmed.data.reservation.status, '预约成功')
    assert.equal((await submitFresh({ ...form, idCard: testId(60), reservationDate: '', repeatReservation: '是' })).status, 201, 'Confirmed identity may submit an undated repeat reservation')
    const [repeatBeforeMigration] = await db.query('SELECT id, repeat_reservation, reservation_date FROM bed_reservations ORDER BY id')
    const beforeMigration = (await db.query('SELECT COUNT(*) AS count FROM bed_reservations'))[0][0].count
    await initializeReservationTable(db)
    assert.equal((await db.query('SELECT COUNT(*) AS count FROM bed_reservations'))[0][0].count, beforeMigration, 'Re-running migration preserves all records')
    assert.deepEqual((await db.query('SELECT id, repeat_reservation, reservation_date FROM bed_reservations ORDER BY id'))[0], repeatBeforeMigration, 'Repeat/date values survive migration retries')
    // Patient intake accepts optional tube/skin lists while retaining private contact data.
    const patientUrl = '/api/discharge-records'
    const patientForm = { hospitalizationNumber: 'OPTIONAL-PATIENT', gender: '男', age: '60-70岁', phone: '13912345678', diagnosis: '中风', hasDischargeMedication: '无', medicationTypes: [], hasTube: '有', tubeTypes: [], skinTypes: [] }
    assert.equal((await request(patientUrl, 'POST', { requestId: crypto.randomUUID(), form: patientForm })).status, 401)
    const selections = [{ tubeTypes: [], skinTypes: [] }, { tubeTypes: ['PICC管'], skinTypes: [] }, { tubeTypes: [], skinTypes: ['皮肤护理'] }, { tubeTypes: undefined, skinTypes: undefined }, { tubeTypes: null, skinTypes: null }]
    for (const [index, selection] of selections.entries()) {
      const patientRequestId = crypto.randomUUID()
      const input = { ...patientForm, hospitalizationNumber: 'OPTIONAL-PATIENT-' + index, ...selection }
      const saved = await request(patientUrl, 'POST', { requestId: patientRequestId, form: input, reportSnapshot: [{ title: '患者信息', items: ['住院号：' + input.hospitalizationNumber] }] }, token)
      assert.equal(saved.status, 201, 'Empty optional lists must persist without blocking')
      assert.equal(saved.data.record.form.phone, input.phone)
      assert.deepEqual(saved.data.record.form.tubeTypes, selection.tubeTypes || [])
      assert.deepEqual(saved.data.record.form.skinTypes, selection.skinTypes || [])
      const storedPatient = await request(patientUrl + '/' + saved.data.record.id, 'GET', undefined, token)
      assert.equal(storedPatient.status, 200)
      assert.equal(storedPatient.data.record.form.phone, input.phone)
      assert.deepEqual(storedPatient.data.record.form.skinTypes, selection.skinTypes || [])
      assert.ok(!JSON.stringify(storedPatient.data.record.reportSnapshot).includes(input.phone))
      const retried = await request(patientUrl, 'POST', { requestId: patientRequestId, form: input }, token)
      assert.equal(retried.data.record.id, saved.data.record.id)
      const duplicatePatient = await request(patientUrl, 'POST', { requestId: crypto.randomUUID(), form: input }, token)
      assert.equal(duplicatePatient.status, 409, 'Hospitalization-number prevention remains intact')
    }
    for (const patch of [{ phone: '' }, { hasTube: '' }, { hasDischargeMedication: '有', medicationTypes: [] }]) {
      assert.equal((await request(patientUrl, 'POST', { requestId: crypto.randomUUID(), form: { ...patientForm, ...patch } }, token)).status, 400)
    }
    // Nurse-only rebooking creates a new pending record and never mutates source history.
    const previousIp = testIp; testIp = '192.0.2.39'
    const rebookForm = { ...form, name: '护士操作测试', idCard: testId(80), specialNeeds: '保留原特殊需求', doctor: '殷茵', tubeTypes: ['胃管', 'PICC管', '其他'], otherTube: '测试专用管道' }
    assert.equal((await submitFresh(rebookForm)).status, 201)
    const [sourceRows] = await db.execute('SELECT * FROM bed_reservations WHERE name = ?', [rebookForm.name])
    const sourceId = sourceRows[0].id
    assert.equal((await request(url + '/' + sourceId + '/confirm', 'POST', {}, token)).status, 200)
    const originalSource = (await db.execute('SELECT * FROM bed_reservations WHERE id = ?', [sourceId]))[0][0]
    const fullRetry = { requestId: originalSource.request_id, form: rebookForm }
    assert.equal((await request(url, 'POST', fullRetry)).status, 201)
    assert.equal((await request(url, 'POST', { ...fullRetry, form: { ...rebookForm, tubeTypes: rebookForm.tubeTypes.slice().reverse() } })).status, 201, 'Selection order does not change retry identity')
    for (const change of [{ doctor: '杨浩宇' }, { tubeTypes: ['胃管'] }, { otherTube: '不同管道' }]) assert.equal((await request(url, 'POST', { ...fullRetry, form: { ...rebookForm, ...change } })).status, 409, 'Care changes cannot reuse an accepted request ID')
    for (const patch of invalidCare) assert.equal((await request(url, 'POST', { requestId: crypto.randomUUID(), form: { ...form, ...patch } })).status, 400)
    const rebookUrl = url + '/' + sourceId + '/rebook'
    const rebookBody = { requestId: crypto.randomUUID(), reservationDate: tomorrow }
    assert.equal((await request(rebookUrl, 'POST', rebookBody)).status, 401)
    assert.equal((await request(url + '/' + sourceId, 'DELETE')).status, 401)
    assert.equal((await request(rebookUrl, 'POST', {}, token)).status, 400)
    assert.equal((await request(rebookUrl, 'POST', { ...rebookBody, requestId: {} }, token)).status, 400)
    assert.equal((await request(url + '/0/rebook', 'POST', rebookBody, token)).status, 400)
    assert.equal((await request(url + '/999999/rebook', 'POST', rebookBody, token)).status, 404)
    for (const date of ['2000-01-01', '2099-02-30', {}]) assert.equal((await request(rebookUrl, 'POST', { requestId: crypto.randomUUID(), reservationDate: date }, token)).status, 400)
    assert.equal((await request(url + '/' + reminderIds[0] + '/rebook', 'POST', rebookBody, token)).status, 400, 'Do not invent identities for legacy source records')
    const remindersBefore = (await request(url + '/reminders', 'GET', undefined, token)).data.total
    const createdAgain = await request(rebookUrl, 'POST', rebookBody, token)
    assert.equal(createdAgain.status, 201)
    const repeated = createdAgain.data.reservation
    assert.notEqual(repeated.id, sourceId)
    for (const field of ['name', 'gender', 'age', 'phone', 'idCard', 'diagnosis', 'specialNeeds', 'doctor', 'otherTube']) assert.equal(repeated[field], field === 'age' ? Number(rebookForm[field]) : rebookForm[field])
    assert.deepEqual(repeated.tubeTypes, rebookForm.tubeTypes)
    assert.equal(originalSource.doctor, rebookForm.doctor); assert.deepEqual(JSON.parse(originalSource.tube_types), rebookForm.tubeTypes); assert.equal(originalSource.other_tube, rebookForm.otherTube)
    const anonymousReceipt = await request(url, 'POST', { requestId: sourceRows[0].request_id, form: rebookForm })
    assert.equal(anonymousReceipt.status, 201); assert.equal(anonymousReceipt.data.doctor, undefined); assert.equal(anonymousReceipt.data.tubeTypes, undefined)
    const careDetail = await request(url + '/' + sourceId, 'GET', undefined, token)
    assert.deepEqual(careDetail.data.reservation.tubeTypes, rebookForm.tubeTypes)
    assert.equal(careDetail.data.reservation.doctor, rebookForm.doctor); assert.equal(careDetail.data.reservation.otherTube, rebookForm.otherTube)
    const carePage = await request(url + '?limit=100', 'GET', undefined, token)
    const careItem = carePage.data.items.find(row => row.id === sourceId)
    assert.equal(careItem.doctor, undefined); assert.equal(careItem.tubeTypes, undefined); assert.equal(careItem.otherTube, undefined)
    assert.equal(repeated.repeatReservation, '是'); assert.equal(repeated.status, '预约中'); assert.equal(repeated.reservationDate, tomorrow)
    assert.equal(repeated.confirmedAt, null); assert.equal(repeated.waitingDays, null)
    assert.deepEqual((await db.execute('SELECT * FROM bed_reservations WHERE id = ?', [sourceId]))[0][0], originalSource, 'Rebooking leaves the entire source record untouched')
    const storedAgain = (await db.execute('SELECT * FROM bed_reservations WHERE id = ?', [repeated.id]))[0][0]
    assert.equal(storedAgain.rebooked_from_id, sourceId); assert.ok(storedAgain.rebooked_by_user_id)
    assert.notEqual(storedAgain.id_card_encrypted, originalSource.id_card_encrypted, 'Encrypt identity again bound to the new request')
    assert.equal(storedAgain.identity_fingerprint, originalSource.identity_fingerprint)
    assert.equal((await request(url + '/reminders', 'GET', undefined, token)).data.total, remindersBefore + 1)
    assert.equal((await request(rebookUrl, 'POST', rebookBody, token)).data.reservation.id, repeated.id, 'Retries return the same booking')
    assert.equal((await request(rebookUrl, 'POST', { ...rebookBody, reservationDate: '' }, token)).status, 409)
    assert.equal((await request(rebookUrl, 'POST', { requestId: crypto.randomUUID() }, token)).data.code, 'RESERVATION_ALREADY_PENDING')
    assert.equal((await request(url + '/' + repeated.id + '/rebook', 'POST', { requestId: crypto.randomUUID() }, token)).status, 409, 'Pending records cannot be rebooked')
    assert.equal((await submitFresh(rebookForm)).data.code, 'RESERVATION_ALREADY_PENDING', 'Nurse action does not bypass public duplicate protection')
    const patientCounts = async () => Promise.all(['system_users', 'discharge_records', 'discharge_record_shares', 'discharge_record_flows'].map(async table => Number((await db.query('SELECT COUNT(*) AS n FROM ' + table))[0][0].n)))
    const patientCountsBefore = await patientCounts()
    assert.equal((await request(url + '/' + repeated.id, 'DELETE', undefined, token)).status, 200)
    assert.equal((await request(url + '/' + repeated.id, 'GET', undefined, token)).status, 404)
    assert.equal((await request(url + '/' + repeated.id, 'DELETE', undefined, token)).status, 200, 'Deletion retries are idempotent')
    assert.equal((await request(url + '/0', 'DELETE', undefined, token)).status, 400)
    assert.equal((await request(url + '/reminders', 'GET', undefined, token)).data.total, remindersBefore)
    const sameBody = { requestId: crypto.randomUUID(), reservationDate: '' }
    const concurrentSame = await Promise.all(Array.from({ length: 3 }, () => request(rebookUrl, 'POST', sameBody, token)))
    assert.ok(concurrentSame.every(value => value.status === 201), JSON.stringify(concurrentSame.map(value => value.status)))
    assert.equal(new Set(concurrentSame.map(value => value.data.reservation.id)).size, 1, 'Concurrent retries only create one booking')
    const undatedAgain = concurrentSame[0].data.reservation
    assert.equal(undatedAgain.reservationDate, null)
    assert.equal((await request(url + '/reminders', 'GET', undefined, token)).data.total, remindersBefore, 'Undated nurse rebooking creates no tomorrow reminder')
    assert.equal((await request(url + '/' + undatedAgain.id + '/cancel', 'POST', {}, token)).status, 200)
    const differentRequests = await Promise.all([sourceId, undatedAgain.id].map(id => request(url + '/' + id + '/rebook', 'POST', { requestId: crypto.randomUUID() }, token)))
    assert.deepEqual(differentRequests.map(value => value.status).sort(), [201, 409], 'Different historical records/devices still only create one pending identity')
    const winning = differentRequests.find(value => value.status === 201).data.reservation
    // Delete source history explicitly without cascading into a newly created booking.
    assert.equal((await request(url + '/' + sourceId, 'DELETE', undefined, token)).status, 200)
    assert.equal((await request(url + '/' + winning.id, 'GET', undefined, token)).status, 200)
    assert.equal((await request(rebookUrl, 'POST', { requestId: crypto.randomUUID() }, token)).status, 404)
    assert.equal((await request(url + '/' + winning.id, 'DELETE', undefined, token)).status, 200)
    assert.equal((await submitFresh(rebookForm)).status, 201, 'Deleting a pending booking releases duplicate protection')
    assert.deepEqual(await patientCounts(), patientCountsBefore, 'Deletion never touches users or patient discharge records/reports')
    await initializeReservationTable(db)
    assert.equal((await request(url + '/' + undatedAgain.id, 'GET', undefined, token)).data.reservation.status, '取消预约', 'Additive migration retries retain history')
    const blankCareForm = { ...form, idCard: testId(90), name: '旧回执兼容测试' }
    const blankRequest = crypto.randomUUID()
    assert.equal((await submitFresh(blankCareForm, blankRequest)).status, 201)
    const blankSource = (await db.execute('SELECT id FROM bed_reservations WHERE request_id = ?', [blankRequest]))[0][0].id
    const normalizedBlank = validateReservation({ requestId: blankRequest, form: blankCareForm }).form
    const { doctor: unusedDoctor, tubeTypes: unusedTubes, otherTube: unusedOther, ...beforeCare } = normalizedBlank
    const beforeCareHash = crypto.createHash('sha256').update(JSON.stringify(beforeCare)).digest('hex')
    await db.execute('UPDATE bed_reservations SET payload_hash = ?, doctor = NULL, tube_types = NULL, other_tube = NULL WHERE id = ?', [beforeCareHash, blankSource])
    assert.equal((await request(url, 'POST', { requestId: blankRequest, form: blankCareForm })).status, 201, 'November 6 receipt remains valid after new optional fields')
    assert.equal((await request(url, 'POST', { requestId: blankRequest, form: { ...blankCareForm, doctor: '其他' } })).status, 409, 'New care data cannot impersonate an old receipt')
    const blankOldDetail = (await request(url + '/' + blankSource, 'GET', undefined, token)).data.reservation
    assert.equal(blankOldDetail.doctor, ''); assert.deepEqual(blankOldDetail.tubeTypes, []); assert.equal(blankOldDetail.otherTube, '')
    await request(url + '/' + blankSource + '/confirm', 'POST', {}, token)
    const oldRebookBody = { requestId: crypto.randomUUID(), reservationDate: '' }
    const oldRebook = await request(url + '/' + blankSource + '/rebook', 'POST', oldRebookBody, token)
    assert.equal(oldRebook.status, 201)
    const oldRebookStored = (await db.execute('SELECT * FROM bed_reservations WHERE id = ?', [oldRebook.data.reservation.id]))[0][0]
    const oldRebookForm = { ...beforeCare, reservationDate: '', repeatReservation: '是' }
    const oldRebookHash = crypto.createHash('sha256').update(JSON.stringify({ action: 'staff-rebook', sourceId: blankSource, userId: oldRebookStored.rebooked_by_user_id, form: oldRebookForm })).digest('hex')
    await db.execute('UPDATE bed_reservations SET payload_hash = ? WHERE id = ?', [oldRebookHash, oldRebookStored.id])
    assert.equal((await request(url + '/' + blankSource + '/rebook', 'POST', oldRebookBody, token)).data.reservation.id, oldRebookStored.id, 'Old nurse rebooking receipt remains idempotent')
    const beforeCareMigration = (await db.query('SELECT id, doctor, tube_types, other_tube FROM bed_reservations ORDER BY id'))[0]
    await initializeReservationTable(db)
    assert.deepEqual((await db.query('SELECT id, doctor, tube_types, other_tube FROM bed_reservations ORDER BY id'))[0], beforeCareMigration, 'Migration retries preserve care choices and legacy nulls')
    testIp = previousIp
    const rawRequest = (body, contentType = 'application/json') => fetch(base + url, { method: 'POST', headers: { 'content-type': contentType, 'x-forwarded-for': '192.0.2.25' }, body })
    assert.equal((await rawRequest(JSON.stringify({ padding: 'a'.repeat(9000) }))).status, 413)
    const malformed = await rawRequest('{"idCard":"PRIVATE_PARSER_TEST"')
    assert.equal(malformed.status, 400)
    assert.ok(!(await malformed.text()).includes('PRIVATE_PARSER_TEST'), 'Parse errors must not reflect sensitive data')
    assert.equal((await rawRequest('{}', 'text/plain')).status, 415)
    let throttled = false
    for (let i = 0; i < 31; i++) {
      const response = await rawRequest('{}')
      if (response.status === 429) { throttled = true; assert.ok(response.headers.get('retry-after')); break }
    }
    assert.equal(throttled, true)
    let captchaThrottled = false
    for (let i = 0; i < 61; i++) {
      const response = await request(url + '/captcha')
      if (response.status === 429) { captchaThrottled = true; assert.ok(response.headers.get('retry-after')); break }
    }
    assert.equal(captchaThrottled, true, 'Captcha generation is independently rate limited')
    console.log('PASS: doctor/tube choices, conditional other input, persistence/detail/privacy, source care copied on rebooking, care-aware hashes and old receipt compatibility, additive migrations; authenticated nurse rebooking/deletion, source history retention, rebooking date selection/reminders, new identity encryption, retry/concurrency/duplicate protection, scoped deletion; patient optional tube/skin intake and private contact persistence, optional dates and repeat field persistence/defaults, legacy receipts, repeat-option duplicate prevention, staff-only tomorrow reminders, China day boundaries, reminder counts/filters/pagination/cancellations, pending duplicate prevention, concurrent different-request protection, confirmed rebooking, legacy fallback, fingerprint privacy, captcha missing/wrong/replay rejection, concurrent bound submissions, independent generation throttling, encrypted identity storage, legacy migration, parser limits, error privacy, validation, public submission, authenticated shared queue, timestamps, exact days, idempotency, concurrent confirmation, privacy, pagination, search and rate limiting')
  } finally {
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited }
    assert.ok(/^rehab_reservation_test_[a-f0-9]{12}$/.test(database))
    await db.query('DROP DATABASE IF EXISTS `' + database + '`')
    await db.end()
    if (fs.existsSync(path.join(work, 'node_modules'))) fs.unlinkSync(path.join(work, 'node_modules'))
    assert.equal(path.dirname(work), path.join(root, 'tmp'))
    if (fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true })
    console.log('Removed only this run\'s isolated database and files')
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
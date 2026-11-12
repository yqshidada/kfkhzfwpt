// Local-only integration verification; never connects to a remote database.
const fs = require('fs')
const path = require('path')
const net = require('net')
const crypto = require('crypto')
const { spawn } = require('child_process')
const assert = require('assert/strict')
const mysql = require('mysql2/promise')
const root = path.resolve(__dirname, '../..')
const settings = {}
for (const line of fs.readFileSync(path.join(root, 'server/.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
  if (match) settings[match[1]] = match[2]
}
const host = settings.DB_HOST || '127.0.0.1'
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'Only a local DB is allowed')
const database = `rehab_flow_test_${crypto.randomBytes(6).toString('hex')}`
const work = path.join(root, 'tmp', database)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function loadModule(file) {
  return import('data:text/javascript;base64,' + fs.readFileSync(path.join(root, file)).toString('base64'))
}
async function freePort() {
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return port
}
;(async () => {
  fs.mkdirSync(work, { recursive: true })
  const db = await mysql.createConnection({ host, port: Number(settings.DB_PORT || 3306), user: settings.DB_USER || 'root', password: settings.DB_PASSWORD || '' })
  let child
  try {
    await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
    await db.changeUser({ database })
    for (const file of ['index.js', 'discharge-flow.js', 'bed-reservations.js', 'reservation-validation.js', 'reservation-identity.js', 'reservation-captcha.js', 'report-images.js', 'image-reader.js', 'image-reader-client.js']) fs.copyFileSync(path.join(root, 'server', file), path.join(work, file))
    fs.cpSync(path.join(root, 'server/documents'), path.join(work, 'documents'), { recursive: true })
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(work, 'node_modules'), 'junction')
    fs.symlinkSync(path.join(root, 'unpackage/dist/build/web'), path.join(work, 'public'), 'junction')
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    const secret = crypto.randomBytes(32).toString('hex')
    child = spawn(process.execPath, ['index.js'], { cwd: work, env: { ...process.env, ...settings,
      NODE_ENV: 'test', DB_NAME: database, HOST: '127.0.0.1', PORT: String(port), JWT_SECRET: secret,
      SHARE_BASE_URL: base, TEST_LOGIN_PHONE: '13800138000', TEST_LOGIN_PASSWORD: 'FlowTest1234' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stdout.on('data', data => { log += data })
    child.stderr.on('data', data => { log += data })
    let healthy = false
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw Error('Test server exited: ' + log)
      try { healthy = (await (await fetch(base + '/api/health')).json()).ok } catch (_) {}
      if (healthy) break
      await sleep(100)
    }
    assert.ok(healthy, 'Test server health timeout')
    async function request(route, method = 'GET', body, token) {
      const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
      const bytes = Buffer.from(await response.arrayBuffer())
      let data
      try { data = JSON.parse(bytes.toString()) } catch (_) {}
      return { status: response.status, data, bytes, headers: response.headers }
    }
    async function readyImages(route) {
      for (let attempt = 0; attempt < 120; attempt++) {
        const result = await request(route + '/images')
        assert.equal(result.headers.get('cache-control'), 'no-store')
        if (result.status === 200) {
          assert.equal(result.data.state, 'ready')
          const image = await request(route + '/images/1?v=' + result.data.version)
          assert.equal(image.status, 200)
          assert.equal(image.headers.get('content-type'), 'image/jpeg')
          assert.equal(image.headers.get('cache-control'), 'no-store')
          assert.equal(image.bytes.subarray(0, 3).toString('hex'), 'ffd8ff')
          assert.equal((await request(route + '/images/0')).status, 404)
          assert.equal((await request(route + '/images/' + (result.data.pages + 1))).status, 404)
          assert.equal((await request(route + '/images/1?v=old-version')).status, 404)
          assert.deepEqual((await request(route + '/images')).data, result.data)
          return result.data
        }
        assert.equal(result.status, 202, JSON.stringify(result.data))
        await sleep(500)
      }
      throw Error('Image conversion timed out: ' + log)
    }
    const login = await request('/api/auth/login', 'POST', { username: '13800138000', password: 'FlowTest1234' })
    assert.equal(login.status, 200)
    const token = login.data.token
    // Admission guidance and its QR endpoint are public and contain no patient data.
    assert.equal((await request('/api/admission-flow/share')).status, 200)
    const admission = await request('/api/admission-flow/share', 'GET', undefined, token)
    assert.equal(admission.status, 200)
    assert.equal(admission.data.share.url, base + '/documents/admission-flow')
    assert.ok(admission.data.share.qrDataUrl.startsWith('data:image/png;base64,'))
    assert.equal((await request('/documents/admission-flow')).status, 200)
    const admissionPdf = await request('/documents/admission-flow/pdf')
    assert.equal(admissionPdf.status, 200)
    assert.equal(admissionPdf.headers.get('content-type'), 'application/pdf')
    assert.deepEqual(admissionPdf.bytes, fs.readFileSync(path.join(work, 'documents/admission-flow.pdf')))
    assert.ok((await request('/documents/admission-flow/pdf?download=1')).headers.get('content-disposition').startsWith('attachment;'))
    assert.equal((await request('/documents/admission-flow/pdf', 'GET', undefined, 'expired-token')).status, 200)
    assert.equal((await readyImages('/documents/admission-flow')).pages, 1)
    assert.equal((await db.query('SELECT COUNT(*) AS count FROM discharge_records'))[0][0].count, 0)
    fs.renameSync(path.join(work, 'documents/admission-flow.pdf'), path.join(work, 'documents/admission-flow.test-backup'))
    assert.equal((await request('/api/admission-flow/share', 'GET', undefined, token)).status, 503)
    assert.equal((await request('/documents/admission-flow')).status, 404)
    assert.equal((await request('/documents/admission-flow/pdf')).status, 404)
    assert.equal((await request('/documents/admission-flow/images')).status, 404)
    assert.equal((await request('/documents/admission-flow/images/1')).status, 404)
    fs.renameSync(path.join(work, 'documents/admission-flow.test-backup'), path.join(work, 'documents/admission-flow.pdf'))
    const secondHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const secondPayload = Buffer.from(JSON.stringify({ sub: 999, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')
    const secondUnsigned = secondHeader + '.' + secondPayload
    const otherToken = secondUnsigned + '.' + crypto.createHmac('sha256', secret).update(secondUnsigned).digest('base64url')
    const patient = await request('/api/discharge-records', 'POST', { requestId: crypto.randomUUID(), form: {
      hospitalizationNumber: 'FLOW-TEST-001', gender: '男', age: '60-70岁', phone: '13800138000', diagnosis: '脑卒中',
      hasDischargeMedication: '有', medicationTypes: ['降压药'], hasTube: '无', tubeTypes: [], skinTypes: ['皮肤护理']
    }, reportSnapshot: [{ title: '患者信息', items: ['住院号：FLOW-TEST-001'] }] }, token)
    assert.equal(patient.status, 201)
    const id = patient.data.record.id
    const route = `/api/discharge-records/${id}/flow`
    const { generateDischargeReportPdf } = await loadModule('pages/hzjbxx/report-pdf.js')
    const { buildFlowSections, settlementOptions } = await loadModule('pages/cylc/flow-content.js')
    const defaultReport = generateDischargeReportPdf([{ title: '患者信息', items: ['住院号：FLOW-TEST-001', '性别：男', '年龄：60-70岁', '压疮分期：Ⅲ期'] }, { title: '出院带药', items: [{ title: '药物使用注意事项', content: Array.from({length: 100}, (_, i) => `${i + 1}. 按医嘱服药，定时监测血压并记录；如有不适，请及时就医。`).join('\n') }] }])
    const report = await request(`/api/discharge-records/${id}/share`, 'POST', { pdfBase64: defaultReport }, token)
    assert.equal(report.status, 201)
    const reportPath = new URL(report.data.share.url).pathname
    assert.ok((await readyImages(reportPath)).pages > 1)
    assert.ok((await request(reportPath + '/pdf?download=1')).headers.get('content-disposition').startsWith('attachment;'))
    assert.equal((await request('/share/invalid-token/images')).status, 404)
    assert.equal((await request('/share/invalid-token/images/1')).status, 404)
    const titleHex = value => Array.from(value).map(c => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('')
    assert.ok(Buffer.from(defaultReport, 'base64').toString().includes(titleHex('出院报告')))
    assert.ok(!/<FEFF[0-9A-F]*> Tj/.test(Buffer.from(defaultReport, 'base64').toString()), 'Text drawing must not contain BOM glyphs')
    assert.equal((await request(route)).status, 401)
    assert.equal((await request(route, 'GET', undefined, otherToken)).status, 404)
    assert.equal((await request(route, 'DELETE', undefined, otherToken)).status, 404)
    assert.equal((await request(route, 'GET', undefined, token)).data.flow, null)
    let previousPath = ''
    let latest
    for (const settlementMethod of settlementOptions) for (const westernMedicine of ['有', '无']) for (const chineseMedicine of ['有', '无']) {
      const form = { settlementMethod, westernMedicine, chineseMedicine }
      const sections = buildFlowSections('FLOW-TEST-001', form)
      const content = JSON.stringify(sections)
      assert.equal(content.includes('护士站往左走20米的玻璃窗口领取西药'), westernMedicine === '有')
      assert.ok(!content.includes('去护士站'))
      assert.equal(content.includes('请前往护士站领取中药'), chineseMedicine === '有')
      assert.ok(content.includes('护士站领取出院小结及诊断证明书'))
      for (const removed of ['结算方式：', '出院西药带药', '出院中药带药', '祝您生活愉快', '护士站拿出院小结和诊断证明书']) assert.ok(!content.includes(removed))
      const noticeItems = sections.flatMap(section => section.items).filter(item => item && item.content === '注意：必须有结算的清单发票')
      assert.equal(noticeItems.length, Number(westernMedicine === '有') + Number(chineseMedicine === '有'))
      noticeItems.forEach(item => { assert.equal(item.fontSize, 8.5); assert.equal(item.color, '0.82 0.12 0.12') })
      const expectedTitles = {
        '有有': ['步骤一：结算方式', '步骤二：领取西药', '步骤三：领取中药', '步骤四：领取资料'],
        '有无': ['步骤一：结算方式', '步骤二：领取西药', '步骤三：领取资料'],
        '无有': ['步骤一：结算方式', '步骤二：领取中药', '步骤三：领取资料'],
        '无无': ['步骤一：结算方式', '步骤二：领取资料']
      }[westernMedicine + chineseMedicine]
      assert.deepEqual(sections.filter(section => section.title).map(section => section.title), expectedTitles)
      assert.equal(sections[1].items[0], settlementMethod)
      const hasSettlementReminder = settlementMethod === '柜台身份证医保卡' || settlementMethod === '自助机结算'
      assert.equal(sections[1].items.length, hasSettlementReminder ? 2 : 1)
      if (hasSettlementReminder) {
        assert.deepEqual(sections[1].items[1], { body: true, content: '（柜台和自助机结算在护士站往右走20米窗口）', fontSize: 8.5, color: '0.82 0.12 0.12' })
      }
      const pdfBase64 = generateDischargeReportPdf(sections, { title: '出院流程' })
      assert.ok(Buffer.from(pdfBase64, 'base64').toString().includes(titleHex('出院流程')))
      const body = { requestId: crypto.randomUUID(), form, pdfBase64 }
      const result = await request(route, 'POST', body, token)
      if (latest) {
        assert.equal(result.status, 409)
        assert.equal(result.data.message, '已生成出院流程，请前往患者详情页查看')
        assert.deepEqual((await request(route, 'GET', undefined, token)).data.flow.form, latest.body.form)
        assert.deepEqual((await request(previousPath + '/pdf')).bytes, Buffer.from(latest.body.pdfBase64, 'base64'))
        continue
      }
      assert.equal(result.status, 201, JSON.stringify(result.data))
      assert.deepEqual(result.data.flow.form, form)
      assert.ok(result.data.flow.share.qrDataUrl.startsWith('data:image/png;base64,'))
      assert.ok(new Date(result.data.flow.share.expiresAt) > new Date())
      const sharePath = new URL(result.data.flow.share.url).pathname
      const publicPage = await request(sharePath)
      assert.equal(publicPage.status, 200)
      assert.ok(publicPage.bytes.toString().includes('<title>出院流程</title>'))
      assert.ok(!publicPage.bytes.toString().includes('<iframe'))
      assert.equal((await readyImages(sharePath)).pages, 1)
      const download = await request(sharePath + '/pdf')
      assert.equal(download.status, 200)
      assert.equal(download.headers.get('content-type'), 'application/pdf')
      assert.deepEqual(download.bytes, Buffer.from(pdfBase64, 'base64'))
      assert.equal((await request(route, 'POST', body, token)).data.flow.share.url, result.data.flow.share.url)
      previousPath = sharePath
      latest = { body, sharePath }
      if (settlementMethod === settlementOptions[0] && westernMedicine === chineseMedicine) {
        const output = path.join(root, 'tmp/pdfs')
        fs.mkdirSync(output, { recursive: true })
        fs.writeFileSync(path.join(output, `discharge-flow-${westernMedicine === '有' ? 'yes' : 'no'}.pdf`), download.bytes)
      }
    }
    for (const field of ['settlementMethod', 'westernMedicine', 'chineseMedicine']) {
      assert.equal((await request(route, 'POST', { ...latest.body, requestId: crypto.randomUUID(), form: { ...latest.body.form, [field]: 'invalid' } }, token)).status, 400)
    }
    assert.equal((await request(route, 'POST', { ...latest.body, requestId: crypto.randomUUID(), pdfBase64: 'aW52YWxpZA==' }, token)).status, 400)
    assert.equal((await request(route, 'POST', latest.body, otherToken)).status, 404)
    assert.equal((await request(route + '/share', 'DELETE', undefined, otherToken)).status, 404)
    const secondPatient = await request('/api/discharge-records', 'POST', {
      requestId: crypto.randomUUID(),
      form: { ...patient.data.record.form, hospitalizationNumber: 'FLOW-TEST-002' },
      reportSnapshot: []
    }, token)
    assert.equal(secondPatient.status, 201, JSON.stringify(secondPatient.data))
    const concurrentRoute = `/api/discharge-records/${secondPatient.data.record.id}/flow`
    const concurrent = { ...latest.body, requestId: crypto.randomUUID() }
    const parallel = await Promise.all([request(concurrentRoute, 'POST', concurrent, token), request(concurrentRoute, 'POST', concurrent, token)])
    assert.deepEqual(parallel.map(result => result.status).sort(), [200, 201])
    assert.equal(parallel[0].data.flow.share.url, parallel[1].data.flow.share.url)
    const concurrentPath = new URL(parallel[0].data.flow.share.url).pathname
    await readyImages(concurrentPath)
    const duplicates = await Promise.all([request(concurrentRoute, 'POST', { ...concurrent, requestId: crypto.randomUUID() }, token), request(concurrentRoute, 'POST', { ...concurrent, requestId: crypto.randomUUID() }, token)])
    for (const result of duplicates) {
      assert.equal(result.status, 409)
      assert.equal(result.data.message, '已生成出院流程，请前往患者详情页查看')
    }
    assert.equal((await request(concurrentRoute + '/share', 'DELETE', undefined, token)).status, 200)
    assert.equal((await request(concurrentPath)).status, 404)
    assert.equal((await request(concurrentPath + '/pdf')).status, 404)
    assert.equal((await request(concurrentPath + '/images')).status, 404)
    assert.equal((await request(concurrentPath + '/images/1')).status, 404)
    const afterRevoke = await request(concurrentRoute, 'GET', undefined, token)
    assert.deepEqual(afterRevoke.data.flow.form, latest.body.form)
    assert.equal(afterRevoke.data.flow.share, null)
    assert.equal((await request(concurrentRoute, 'POST', concurrent, token)).status, 409)
    assert.equal((await request(concurrentRoute, 'POST', { ...concurrent, requestId: crypto.randomUUID() }, token)).status, 409)
    await db.query('UPDATE discharge_record_flows SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY)')
    assert.equal((await request(route, 'GET', undefined, token)).data.flow.share, null)
    assert.equal((await request(route, 'POST', latest.body, token)).status, 409)
    assert.equal((await request(route, 'POST', { ...latest.body, requestId: crypto.randomUUID() }, token)).status, 409)
    const expiredToken = (await db.query('SELECT token FROM discharge_record_flows'))[0][0].token
    assert.equal((await request('/share/' + expiredToken + '/pdf')).status, 404)
    assert.equal((await request(previousPath + '/images')).status, 404)
    assert.equal((await request(previousPath + '/images/1')).status, 404)
    assert.equal((await request(reportPath)).status, 200)
    assert.deepEqual((await request(reportPath + '/pdf')).bytes, Buffer.from(defaultReport, 'base64'))
    assert.equal(fs.readdirSync(path.join(work, 'storage/reports')).length, 3, 'Two patient flows and the original report should remain; duplicates must not write files')
    // Leave one patient but no flow so browser verification can exercise first-time generation.
    const [flowRows] = await db.query('SELECT file_path FROM discharge_record_flows')
    for (const row of flowRows) fs.unlinkSync(path.join(work, 'storage/reports', row.file_path))
    await db.query('DELETE FROM discharge_record_flows')
    console.log('PASS: image conversion/cache/multiple pages/JPEG/invalid pages/revocation/expiry; admission public PDF/QR/auth/missing-file handling; all 12 choices, validation, ownership, original report regression, idempotency/concurrency, duplicate prevention, PDF/QR')
    if (process.argv.includes('--serve')) {
      fs.writeFileSync(path.join(root, 'tmp/flow-browser-session.json'), JSON.stringify({ base, id, work, database, reportPath }))
      console.log('Browser verification server: ' + base + ' ; isolated patient ID: ' + id)
      while (!fs.existsSync(path.join(work, 'stop'))) await sleep(500)
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill()
      await new Promise(resolve => child.once('exit', resolve))
    }
    await db.query(`DROP DATABASE \`${database}\``)
    await db.end()
    // Remove only this test run's directory; unlink junctions without traversing targets.
    for (const name of ['public', 'node_modules']) if (fs.existsSync(path.join(work, name))) fs.unlinkSync(path.join(work, name))
    fs.rmSync(work, { recursive: true, force: true })
    console.log('Isolated test database and files removed')
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1 })

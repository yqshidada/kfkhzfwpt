// Read-only deployment verification. No patient/appointment writes or historic PDF changes.
const fs = require('fs')
const https = require('https')
const vm = require('vm')
const assert = require('assert/strict')
const app = '/opt/rehab-app/server'
const directory = app + '/public/static/js'
const decode = text => text.replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
function request(route) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: 'gzitwmkfk.cn', path: route,
      lookup: (name, options, cb) => options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)
    }, response => {
      const parts = []
      response.on('data', value => parts.push(value))
      response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(parts) }))
    })
    req.setTimeout(15000, () => req.destroy(Error('Request timeout')))
    req.on('error', reject)
  })
}
async function bundle(prefix) {
  const matches = fs.readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith('.js'))
  assert.equal(matches.length, 1, 'Expected exactly one deployed page bundle: ' + prefix)
  const bytes = fs.readFileSync(directory + '/' + matches[0])
  const remote = await request('/static/js/' + matches[0])
  assert.equal(remote.status, 200)
  assert.equal(remote.bytes.compare(bytes), 0, 'HTTPS bundle mismatch')
  return decode(bytes.toString('utf8'))
}
;(async () => {
  const patient = await bundle('pages-hzjbxx-index.')
  for (const text of ['管道类型（选填）', '皮肤情况（选填）', '请输入联系电话', '13802725336', '020-36991823']) assert.ok(patient.includes(text), 'Missing patient field or public contact')
  const start = patient.search(/buildReportSections(?::function)?\(\)\{/)
  const end = patient.indexOf('buildRecordSnapshot', start)
  assert.ok(start > 0 && end > start, 'Compiled report method missing')
  const sectionCode = patient.slice(start, end).replace(/,$/, '').replace(/image:[$\w.]+(?=,imageKey:)/g, 'image:""')
  // Evaluate the actual deployed compiled report method, not an independently recreated report.
  const method = vm.runInNewContext('({' + sectionCode + '}).buildReportSections')
  const form = { hospitalizationNumber: 'DEPLOY-READONLY-CHECK', gender: '男', age: '60-70岁', phone: '13912345678', diagnosis: '测试', hasDischargeMedication: '无', medicationTypes: [], hasTube: '有', tubeTypes: [], skinTypes: [] }
  const sections = method.call({ form, selectedTubeGuides: [], followUpNotice: '科室电话：13802725336', medicalRecordCopyNoticeBeforeQr: '', medicalRecordCopyNoticeAfterQr: '病历复印业务咨询电话：020-36991823', documentDisclaimer: '' })
  const report = JSON.stringify(sections)
  assert.ok(!report.includes(form.phone) && !report.includes('联系电话'), 'Patient phone must not enter report')
  assert.ok(!sectionCode.includes('.phone'), 'Report method must not read patient phone')
  for (const label of ['管道类型：未填写', '皮肤情况：未填写', '13802725336', '020-36991823']) assert.ok(report.includes(label))
  const backend = fs.readFileSync(app + '/index.js', 'utf8')
  const begin = backend.indexOf('function normalizeString('), finish = backend.indexOf('function normalizeSnapshot(')
  assert.ok(begin > 0 && finish > begin)
  const validate = vm.runInNewContext(backend.slice(begin, finish) + '; validateRecord')
  for (const empty of [[], null, undefined]) {
    const result = validate({ form: { ...form, tubeTypes: empty, skinTypes: empty } })
    assert.equal(result.tubeTypes.length, 0)
    assert.equal(result.skinTypes.length, 0)
    assert.equal(result.phone, form.phone)
  }
  assert.throws(() => validate({ form: { ...form, phone: '' } }))
  assert.throws(() => validate({ form: { ...form, hasTube: '' } }))
  assert.throws(() => validate({ form: { ...form, hasDischargeMedication: '有' } }))
  const reservation = await bundle('pages-bed-reservation-index.')
  for (const text of ['预约日期（选填）', '清除日期', '预约医生（选填）', '管道（选填，可多选）', '请填写其他管道名称']) assert.ok(reservation.includes(text), 'Missing reservation form change')
  assert.ok(!reservation.includes('是否再次预约') && !reservation.includes('repeatReservationOptions'), 'Public repeat option must be removed')
  const list = await bundle('pages-nurse-list.')
  const detail = await bundle('pages-nurse-reservation-detail.')
  assert.ok(list.includes('再次预约') && detail.includes('再次预约'))
  for (const text of ['删除预约', '删除后无法恢复', '确认再次预约']) assert.ok(list.includes(text), 'Missing protected nurse action')
  const { validateReservation, mapReservation } = require(app + '/bed-reservations')
  const options = require(app + '/reservation-validation')
  assert.deepEqual(options.RESERVATION_DOCTORS, ['殷茵', '杨浩宇', '朱广浩', '饶志远', '其他'])
  assert.deepEqual(options.RESERVATION_TUBES, ['胃管', '尿管', 'PICC管', '气切管', 'CVC管', '胃造瘘管', '输液港', '其他'])
  assert.ok(detail.includes('预约医生') && detail.includes('tubeSummary'), 'Nurse care detail missing')
  const value = { name: '发布只读校验', gender: '女', age: '60', phone: '13800138000', idCard: '11010519491231002X', diagnosis: '仅内存校验，不写入数据库' }
  for (const reservationDate of [undefined, null, '', '   ']) {
    const result = validateReservation({ requestId: '123e4567-e89b-42d3-a456-426614174000', form: { ...value, reservationDate } })
    assert.equal(result.form.reservationDate, '')
    assert.equal(result.form.repeatReservation, '否')
  }
  assert.equal(validateReservation({ requestId: '123e4567-e89b-42d3-a456-426614174000', form: { ...value, repeatReservation: '是' } }).form.repeatReservation, '是')
  assert.equal(mapReservation({ id: 1, created_at_ms: 1, repeat_reservation: null }).repeatReservation, null)
  console.log('PASS: exact HTTPS bundles; deployed report omits only patient phone and preserves public contacts; optional tube/skin and retained patient phone validation; optional booking date, no public repeat option, nurse rebook/delete actions, compatibility defaults; no business writes')
})().catch(error => { console.error('Patient/reservation verification failed:', error.code || error.message); process.exitCode = 1 })

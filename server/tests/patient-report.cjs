// Patient-form/report regression. Uses synthetic data and in-memory PDFs only by default.
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const load = file => import('data:text/javascript;base64,' + Buffer.from(read(file)).toString('base64'))
function drawnText(pdf) {
  return [...pdf.toString('latin1').matchAll(/<([0-9A-F]+)>\s*Tj/g)].map(match => {
    let text = ''
    for (let i = 0; i < match[1].length; i += 4) text += String.fromCharCode(parseInt(match[1].slice(i, i + 4), 16))
    return text
  }).join('')
}
;(async () => {
  const bindings = {}
  for (const file of ['medication-care.js', 'tube-care.js', 'skin-care.js', 'discharge-notices.js', 'case-copy-qr.js', 'medical-copy-application-qr.js', 'report-pdf.js']) Object.assign(bindings, await load('pages/hzjbxx/' + file))
  const source = read('pages/hzjbxx/index.vue')
  assert.ok(source.includes('<view class="field-label">管道类型（选填）</view>'))
  assert.ok(source.includes('<view class="field-label">皮肤情况（选填）</view>'))
  assert.ok(source.includes('<text class="required">*</text>联系电话'), 'Patient contact stays required in the private form')
  const errors = [], requests = [], shares = [], pdfs = [], navigation = []
  let confirmed = true
  const uni = { showToast: value => errors.push(value.title), showModal: value => value.success({ confirm: confirmed }), redirectTo: value => navigation.push(value) }
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*$/gm, '').replace('export default', 'module.exports =')
  const context = { ...bindings, module: { exports: {} }, uni,
    generateDischargeReportPdf: sections => { const pdf = bindings.generateDischargeReportPdf(sections); pdfs.push(Buffer.from(pdf, 'base64')); return pdf },
    createDischargeRecord: async payload => { requests.push(payload); return { record: { id: requests.length } } },
    shareDischargeRecord: async (id, payload) => { shares.push(payload); return { share: { id, url: '/synthetic-share' } } },
    savePdfToDevice: async () => {}
  }
  vm.runInNewContext(script, context, { filename: 'pages/hzjbxx/index.vue' })
  const options = context.module.exports
  function instance() {
    const value = options.data()
    for (const [name, fn] of Object.entries(options.methods)) value[name] = fn.bind(value)
    for (const [name, fn] of Object.entries(options.computed)) Object.defineProperty(value, name, { get: () => fn.call(value) })
    value.form = { hospitalizationNumber: 'OPTIONAL-REPORT-TEST', gender: '男', age: '60-70岁', phone: '13912345678', diagnosis: '中风', hasDischargeMedication: '无', medicationTypes: [], hasTube: '有', tubeTypes: [], skinTypes: [] }
    return value
  }
  const patient = instance()
  const sections = patient.buildReportSections()
  const tube = sections.find(section => section.title === '管道信息')
  const skin = sections.find(section => section.title === '皮肤情况')
  assert.ok(tube.items.includes('有无管道：有'))
  assert.ok(tube.items.includes('管道类型：未填写'))
  assert.ok(skin.items.includes('皮肤情况：未填写'))
  assert.equal(tube.items.length, 2, 'An unselected tube type must not create empty care headings')
  const snapshot = patient.buildRecordSnapshot(sections)
  assert.ok(!JSON.stringify(snapshot).includes(patient.form.phone))
  assert.ok(!JSON.stringify(snapshot).includes('联系电话'))
  assert.ok(JSON.stringify(snapshot).includes('13802725336'), 'Keep department contact')
  assert.ok(JSON.stringify(snapshot).includes('020-36991823'), 'Keep medical-copy contact')
  await patient.handleSubmit()
  assert.equal(requests.length, 1, 'Both optional lists can be empty, including hasTube=有')
  assert.equal(requests[0].form.phone, '13912345678', 'Private record must retain patient contact')
  assert.equal(requests[0].form.tubeTypes.length, 0)
  assert.equal(requests[0].form.skinTypes.length, 0)
  assert.equal(shares.length, 1)
  assert.equal(navigation[0].url, '/pages/nurse/detail?id=1')
  assert.ok(pdfs[0].subarray(0, 5).equals(Buffer.from('%PDF-')))
  const text = drawnText(pdfs[0])
  assert.ok(!text.includes('13912345678'), 'Actual PDF drawing commands contain no patient phone')
  assert.ok(!text.includes('联系电话'))
  assert.ok(text.includes('13802725336'))
  assert.ok(text.includes('020-36991823'))
  assert.ok(text.includes('管道类型：未填写'))
  assert.ok(text.includes('皮肤情况：未填写'))
  // Optional lists remain independent; selecting either retains its original guidance.
  const tubeOnly = instance(); tubeOnly.form.tubeTypes = ['PICC管']; await tubeOnly.handleSubmit()
  assert.equal(requests.length, 2)
  assert.ok(drawnText(pdfs[1]).includes('PICC管'))
  assert.ok(drawnText(pdfs[1]).includes(bindings.tubeReferenceNotice))
  const skinOnly = instance(); skinOnly.form.hasTube = '无'; skinOnly.form.skinTypes = ['皮肤护理']; await skinOnly.handleSubmit()
  assert.equal(requests.length, 3)
  assert.ok(drawnText(pdfs[2]).includes('管道类型：无'))
  assert.ok(drawnText(pdfs[2]).includes(bindings.skinCareReferenceNotice))
  const both = instance(); both.form.tubeTypes = ['PICC管']; both.form.skinTypes = ['皮肤护理']; await both.handleSubmit()
  assert.equal(requests.length, 4)
  assert.ok(drawnText(pdfs[3]).includes('PICC管'))
  assert.ok(drawnText(pdfs[3]).includes('皮肤情况：皮肤护理'))
  for (const pdf of pdfs) {
    assert.ok(!drawnText(pdf).includes('13912345678'))
    assert.ok(drawnText(pdf).includes('13802725336'))
    assert.ok(drawnText(pdf).includes('020-36991823'))
  }
  const required = [
    { patch: { hospitalizationNumber: '' }, error: '请输入住院号' }, { patch: { gender: '' }, error: '请选择性别' },
    { patch: { age: '' }, error: '请选择年龄' }, { patch: { phone: '123' }, error: '请输入正确的联系电话' },
    { patch: { diagnosis: '' }, error: '请选择诊断' }, { patch: { hasTube: '' }, error: '请选择有无管道' },
    { patch: { hasDischargeMedication: '' }, error: '请选择是否出院带药' },
    { patch: { hasDischargeMedication: '有', medicationTypes: [] }, error: '请选择药物类型' }
  ]
  for (const { patch, error } of required) {
    const value = instance(); Object.assign(value.form, patch); await value.handleSubmit()
    assert.equal(errors.at(-1), error); assert.equal(requests.length, 4)
  }
  confirmed = false
  await instance().handleSubmit()
  assert.equal(requests.length, 4, 'Confirmation cancellation does not save or generate')
  // Execute the actual backend validator in isolation; the integration suite also checks SQL saving.
  const backend = read('server/index.js')
  const functions = backend.slice(backend.indexOf('function normalizeString('), backend.indexOf('function normalizeSnapshot('))
  const validate = vm.runInNewContext(functions + '; validateRecord')
  assert.equal(validate({ form: patient.form }).tubeTypes.length, 0)
  assert.equal(validate({ form: patient.form }).skinTypes.length, 0)
  const { tubeTypes: ignoreTube, skinTypes: ignoreSkin, ...omitted } = patient.form
  assert.equal(validate({ form: omitted }).tubeTypes.length, 0)
  assert.equal(validate({ form: omitted }).skinTypes.length, 0)
  assert.equal(validate({ form: { ...patient.form, tubeTypes: null, skinTypes: null } }).tubeTypes.length, 0)
  for (const patch of [{ phone: '' }, { hasTube: '' }, { hasDischargeMedication: '有', medicationTypes: [] }]) assert.throws(() => validate({ form: { ...patient.form, ...patch } }))
  if (process.env.PATIENT_REPORT_FIXTURE_DIR) {
    const destination = path.resolve(process.env.PATIENT_REPORT_FIXTURE_DIR)
    assert.ok(destination.startsWith(path.join(root, 'tmp') + path.sep), 'Synthetic fixtures stay inside this workspace tmp folder')
    fs.mkdirSync(destination, { recursive: true })
    for (const [index, name] of ['optional-empty', 'optional-tube-only', 'optional-skin-only', 'optional-both'].entries()) fs.writeFileSync(path.join(destination, name + '.pdf'), pdfs[index])
  }
  console.log('PASS: optional tube/skin fields, backend validation, independent care sections, phone-free patient report/snapshot/PDF, preserved department and medical-copy contacts, private patient phone retained, other required fields and confirmation preserved')
})().catch(error => { console.error(error); process.exitCode = 1 })

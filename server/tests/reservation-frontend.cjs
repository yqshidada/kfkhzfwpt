const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const validation = require('../reservation-validation')
const navigation = []
const toasts = []
let modalConfirm = true
const uni = {
  navigateTo: value => navigation.push(value), navigateBack: () => navigation.push({ back: true }),
  reLaunch: value => navigation.push(value), showToast: value => toasts.push(value),
  showModal: value => value.success({ confirm: modalConfirm }),
  hideToast() {}, setNavigationBarTitle() {}, pageScrollTo() {}, stopPullDownRefresh() {}
}
function component(file, bindings = {}) {
  const script = read(file).slice(read(file).indexOf('<script>') + 8, read(file).indexOf('</script>'))
    .replace(/^\s*import .*$/gm, '').replace('export default', 'module.exports =')
  const context = { module: { exports: {} }, uni, ...validation, setInterval: () => 1, clearInterval() {}, getBedReservationReminders: async () => ({ date: '2099-01-01', total: 0 }), getCurrentPages: () => [], ...bindings }
  vm.runInNewContext(script, context, { filename: file })
  const options = context.module.exports
  const instance = options.data()
  for (const [key, fn] of Object.entries(options.methods || {})) instance[key] = fn.bind(instance)
  for (const [key, fn] of Object.entries(options.computed || {})) Object.defineProperty(instance, key, { get: () => fn.call(instance) })
  return { options, instance }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const result = (id, hasMore = false, total = 45) => ({ total, items: [{ id }], nextCursor: hasMore ? id : null, hasMore })
;(async () => {
  const helpers = await import('data:text/javascript;base64,' + Buffer.from(read('utils/reservation.js')).toString('base64'))
  assert.equal(helpers.formatReservationTime('2026-10-29T00:00:00.000Z'), '2026-10-29 08:00:00')
  assert.equal(helpers.formatWaitingDays(2.5), '2.50')
  assert.equal(helpers.formatWaitingDays(0), '0.00')
  assert.equal(helpers.formatWaitingDays(null), '')
  const requests = []
  const lists = component('pages/nurse/list.vue', { ...helpers,
    getDischargeRecords: params => { const job = deferred(); requests.push({ tab: 'patients', params, ...job }); return job.promise },
    getBedReservations: params => { const job = deferred(); requests.push({ tab: 'reservations', params, ...job }); return job.promise }
  })
  const list = lists.instance
  lists.options.onLoad.call(list, {})
  assert.equal(requests[0].tab, 'patients')
  list.switchTab('reservations')
  assert.equal(requests[1].tab, 'reservations')
  requests[1].resolve(result(20, true)); await tick()
  requests[0].resolve(result(10)); await tick()
  assert.equal(list.currentList.records[0].id, 20, 'Late patient response cannot replace reservations')
  assert.equal(list.lists.patients.records[0].id, 10)
  const page2 = list.loadMore()
  assert.equal(requests[2].params.cursor, 20)
  requests[2].resolve(result(19)); await page2
  assert.equal(list.currentList.records.length, 2)
  assert.equal(list.currentList.total, 45, 'Display full-match count, not loaded cards')
  list.currentList.keyword = '旧搜索'
  const oldSearch = list.search()
  list.currentList.keyword = '新搜索'
  const newSearch = list.search()
  requests[4].resolve(result(30)); await newSearch
  requests[3].resolve(result(1)); await oldSearch
  assert.equal(list.currentList.records[0].id, 30, 'Stale same-tab search response ignored')
  list.openReservation(30)
  assert.equal(navigation.at(-1).url, '/pages/nurse/reservation-detail?id=30')
  lists.options.onShow.call(list)
  assert.equal(requests[5].tab, 'reservations', 'Returning from detail refreshes reservation tab')
  requests[5].resolve(result(30)); await tick()
  const filtering = list.handleStatusChange({ detail: { value: '1' } })
  assert.equal(list.reservationStatusIndex, 1)
  assert.equal(requests[6].params.status, '预约中')
  assert.equal(requests[6].params.cursor, null)
  assert.equal(requests[6].params.keyword, '新搜索')
  assert.equal(list.currentList.total, null, 'Hide obsolete total while fetching new filters')
  requests[6].resolve(result(21, true, 2)); await filtering
  assert.equal(list.currentList.total, 2)
  const nextFiltered = list.loadMore()
  assert.equal(requests[7].params.status, '预约中')
  requests[7].resolve(result(20, false, 2)); await nextFiltered
  assert.equal(list.currentList.total, 2)
  const oldFilter = list.handleStatusChange({ detail: { value: '2' } })
  const clearFilter = list.handleStatusChange({ detail: { value: '0' } })
  assert.equal(requests[8].params.status, '预约成功')
  assert.equal(requests[9].params.status, '')
  requests[9].resolve(result(99, false, 10)); await clearFilter
  requests[8].resolve(result(1, false, 1)); await oldFilter
  assert.equal(list.currentList.total, 10, 'Stale filter response cannot overwrite total')
  assert.equal(list.currentList.records[0].id, 99)
  const noMatches = list.search()
  requests[10].resolve({ items: [], total: 0, hasMore: false, nextCursor: null }); await noMatches
  assert.equal(list.currentList.total, 0)
  const cancelledFilter = list.handleStatusChange({ detail: { value: '3' } })
  assert.equal(requests[11].params.status, '取消预约')
  requests[11].resolve(result(100, false, 1)); await cancelledFilter
  assert.equal(list.currentList.total, 1)
  const tomorrowOnly = list.showTomorrowReservations()
  assert.equal(requests[12].params.reminder, 'tomorrow')
  assert.equal(requests[12].params.status, '')
  assert.equal(requests[12].params.keyword, '', 'View reminder starts with all tomorrow bookings')
  requests[12].resolve(result(101, true, 3)); await tomorrowOnly
  const tomorrowPage = list.loadMore()
  assert.equal(requests[13].params.reminder, 'tomorrow')
  assert.equal(requests[13].params.cursor, 101)
  requests[13].resolve(result(100, false, 3)); await tomorrowPage
  const allDates = list.clearReminderFilter()
  assert.equal(requests[14].params.reminder, '')
  requests[14].resolve(result(105)); await allDates
  assert.equal(list.currentList.reminderOnly, false)
  list.selectFlow = true
  list.activeTab = 'patients'
  list.switchTab('reservations')
  assert.equal(list.activeTab, 'patients', 'Discharge flow picker remains patients-only')
  list.openDetail(7)
  assert.equal(navigation.at(-1).url, '/pages/cylc/index?id=7')

  // Reminder polling is limited to visible staff reservations; no hidden-page timers.
  const reminderJobs = [], reminderTimers = new Map(), stoppedTimers = []
  let timerId = 0, midnightReloads = 0
  const reminderPage = component('pages/nurse/list.vue', { ...helpers,
    getBedReservationReminders: () => { const job = deferred(); reminderJobs.push(job); return job.promise },
    getDischargeRecords: async () => result(1), getBedReservations: async () => result(2),
    setInterval: (fn, ms) => { assert.equal(ms, 60000); reminderTimers.set(++timerId, fn); return timerId },
    clearInterval: id => { stoppedTimers.push(id); reminderTimers.delete(id) }
  })
  const reminderList = reminderPage.instance
  reminderList.activeTab = 'reservations'
  reminderPage.options.onShow.call(reminderList)
  assert.equal(reminderJobs.length, 1)
  await reminderList.refreshReminders()
  assert.equal(reminderJobs.length, 1, 'No overlapping reminder requests')
  reminderJobs[0].resolve({ date: '2026-11-03', total: 2 }); await tick()
  assert.equal(reminderList.reminders.total, 2)
  reminderList.currentList.reminderOnly = true
  reminderList.reload = async () => { midnightReloads++ }
  const timer = reminderTimers.get(timerId)
  timer()
  reminderJobs[1].resolve({ date: '2026-11-04', total: 1 }); await tick()
  assert.equal(reminderList.reminders.date, '2026-11-04')
  assert.equal(midnightReloads, 1, 'A tomorrow-only list refreshes across midnight')
  timer()
  reminderJobs[2].resolve({ date: '2026-11-04', total: 0 }); await tick()
  assert.equal(reminderList.reminders.total, 0, 'No reminder when all tomorrow bookings are cancelled')
  reminderList.activeTab = 'patients'; timer()
  assert.equal(reminderJobs.length, 3, 'Patient tab never polls reminder counts')
  reminderList.activeTab = 'reservations'; timer()
  reminderPage.options.onHide.call(reminderList)
  assert.equal(reminderTimers.size, 0)
  reminderJobs[3].resolve({ date: '2026-11-05', total: 99 }); await tick()
  assert.equal(reminderList.reminders.total, 0, 'A late hidden-page response is ignored')
  reminderPage.options.onShow.call(reminderList)
  reminderJobs[4].reject(Error('Offline')); await tick()
  assert.equal(reminderList.reminders.error, '预约提醒暂时加载失败')
  assert.equal(reminderList.reminders.loading, false)
  reminderPage.options.onUnload.call(reminderList)
  reminderList.selectFlow = true
  reminderPage.options.onShow.call(reminderList)
  assert.equal(reminderTimers.size, 0, 'Flow picker has no reminder polling')

  let confirmationCalls = 0
  const confirmation = deferred()
  const pending = { id: 1, status: '预约中', name: '测试', diagnosis: '测试诊断' }
  const details = component('pages/nurse/reservation-detail.vue', { ...helpers,
    getBedReservation: async () => ({ reservation: pending }),
    confirmBedReservation: () => { confirmationCalls++; return confirmation.promise }
  })
  const detail = details.instance
  detail.id = '1'
  await detail.loadReservation()
  modalConfirm = false
  await detail.handleConfirm()
  assert.equal(confirmationCalls, 0)
  assert.equal(detail.confirming, false)
  modalConfirm = true
  const first = detail.handleConfirm()
  const second = detail.handleConfirm()
  await tick()
  assert.equal(confirmationCalls, 1, 'Rapid duplicate clicks produce one confirmation request')
  confirmation.resolve({ reservation: { ...pending, status: '预约成功', waitingDays: 2.5 } })
  await Promise.all([first, second])
  assert.equal(detail.reservation.status, '预约成功')
  await detail.handleConfirm()
  assert.equal(confirmationCalls, 1, 'Confirmed records cannot be re-confirmed in UI')
  assert.ok(read('pages/nurse/reservation-detail.vue').includes('v-if="reservation.status === \'预约中\'"'))
  assert.ok(!read('pages/nurse/reservation-detail.vue').includes('返回预约列表'))
  assert.ok(!read('pages/bed-reservation/index.vue').includes('返回首页'))
  assert.ok(read('pages/nurse/reservation-detail.vue').includes('reservation.idCard'))

  const cancellation = deferred()
  let cancelCalls = 0
  const cancellable = component('pages/nurse/reservation-detail.vue', { ...helpers,
    getBedReservation: async () => ({ reservation: pending }),
    cancelBedReservation: () => { cancelCalls++; return cancellation.promise },
    confirmBedReservation: () => { throw Error('Must not confirm while cancelling') }
  }).instance
  cancellable.id = '1'; await cancellable.loadReservation()
  modalConfirm = false
  await cancellable.handleCancel()
  assert.equal(cancelCalls, 0, 'Dismissing cancellation keeps the booking')
  modalConfirm = true
  const cancelling = cancellable.handleCancel()
  await cancellable.handleCancel(); await cancellable.handleConfirm(); await tick()
  assert.equal(cancelCalls, 1, 'Cancellation locks both actions, including the modal')
  cancellation.resolve({ reservation: { ...pending, status: '取消预约' } })
  await cancelling
  assert.equal(cancellable.cancelling, false)
  await cancellable.handleCancel(); await cancellable.handleConfirm()
  assert.equal(cancelCalls, 1)
  assert.equal(cancellable.reservation.status, '取消预约')

  const submitted = []
  let failSubmission = true
  const booking = component('pages/bed-reservation/index.vue', { ...helpers, ...validation, HOME_ROUTE: '/pages/index/index', ReservationCaptcha: {},
    createBedReservation: async payload => { submitted.push(payload); if (failSubmission) throw Error('网络错误'); return { accepted: true } }
  }).instance
  await booking.handleSubmit()
  assert.equal(submitted.length, 0, 'Incomplete form stays local')
  assert.equal(Object.keys(booking.fieldErrors).length, 7, 'Six business fields and captcha are required')
  assert.equal((read('pages/bed-reservation/index.vue').match(/class="required"/g) || []).length, 8)
  assert.equal((read('pages/bed-reservation/index.vue').match(/class="field-error"/g) || []).length, 12)
  assert.equal(booking.form.repeatReservation, undefined)
  assert.ok(!read('pages/bed-reservation/index.vue').includes('是否再次预约'))
  booking.handleDateChange({ detail: { value: '2099-12-31' } })
  assert.equal(booking.form.reservationDate, '2099-12-31')
  const validForm = { name: '测试', gender: '女', age: '30', phone: '13800138000', idCard: '11010519491231002X', diagnosis: '测试内容', reservationDate: '2099-12-31' }
  for (const field of ['name', 'gender', 'age', 'phone', 'idCard', 'diagnosis']) {
    booking.form = { ...validForm, [field]: '   ' }
    await booking.handleSubmit()
    assert.ok(booking.fieldErrors[field], field + ' whitespace-only value rejected')
    assert.equal(submitted.length, 0)
    booking.clearFieldError(field)
    assert.equal(booking.fieldErrors[field], '')
  }
  booking.form = { ...validForm, age: '0' }
  assert.deepEqual(validation.getReservationFieldErrors(booking.form), {}, 'Zero is a valid age')
  booking.form = { name: '测试', gender: '女', age: '30', phone: '13800138000', idCard: '11010519491231002X', diagnosis: '测试内容', reservationDate: '2099-12-31' }
  booking.form.phone = '020-12345678'
  await booking.handleSubmit()
  assert.equal(submitted.length, 0, 'Landline is not accepted as a mobile number')
  booking.form.phone = '13800138000'
  booking.form.idCard = '110105194912310020'
  await booking.handleSubmit()
  assert.equal(submitted.length, 0, 'Invalid ID checksum is rejected locally')
  booking.handleIdCardInput({ detail: { value: '11010519491231002x' } })
  assert.equal(booking.form.idCard, '11010519491231002X')
  for (const code of ['A2B', 'A2B34', 'A2B3C4']) {
    booking.captcha = { id: 'length-check', code }
    await booking.handleSubmit()
    assert.ok(booking.fieldErrors.captcha, 'Reject non-four-character captcha locally')
    assert.equal(submitted.length, 0)
  }
  let refreshCalls = 0
  booking.$nextTick = async () => { assert.equal(booking.submitting, false) }
  booking.$refs = { captchaControl: { refresh: async () => { refreshCalls++ } } }
  booking.captcha = { id: 'challenge-1', code: 'A2B3' }
  await booking.handleSubmit()
  assert.equal(booking.captcha.code, '', 'Failed submission clears the consumed challenge')
  assert.equal(refreshCalls, 1, 'Failure refreshes captcha without discarding form')
  assert.equal(booking.submitted, false)
  assert.equal(booking.form.name, '测试', 'Failure retains user input')
  failSubmission = false
  booking.captcha = { id: 'challenge-2', code: 'D5E6' }
  await booking.handleSubmit()
  assert.equal(submitted[1].captcha.code, 'D5E6')
  assert.equal(submitted[0].requestId, submitted[1].requestId, 'Network retry reuses idempotency key')
  assert.equal(booking.submitted, true)
  assert.equal(booking.form.phone, '')
  assert.equal(booking.form.idCard, '')
  await booking.handleSubmit()
  assert.equal(submitted.length, 2)
  const duplicateBooking = component('pages/bed-reservation/index.vue', { ...helpers, ...validation, ReservationCaptcha: {},
    createBedReservation: async () => { throw Object.assign(Error('您已有预约中的记录，请勿重复预约'), { code: 'RESERVATION_ALREADY_PENDING', statusCode: 409 }) }
  }).instance
  duplicateBooking.form = { ...validForm }
  duplicateBooking.captcha = { id: 'duplicate-challenge', code: 'A2B3' }
  duplicateBooking.$nextTick = async () => {}
  let duplicateRefreshes = 0
  duplicateBooking.$refs = { captchaControl: { refresh: async () => { duplicateRefreshes++; duplicateBooking.clearFieldError('captcha') } } }
  await duplicateBooking.handleSubmit()
  assert.equal(duplicateBooking.submitted, false)
  assert.equal(duplicateBooking.form.idCard, validForm.idCard, 'Duplicate rejection retains all entered data')
  assert.equal(duplicateBooking.submissionError, '您已有预约中的记录，请勿重复预约')
  assert.equal(duplicateBooking.submitting, false)
  assert.equal(duplicateRefreshes, 1)
  duplicateBooking.clearFieldError('idCard')
  assert.equal(duplicateBooking.submissionError, '', 'Editing clears outdated submission errors')
  assert.ok(read('pages/bed-reservation/index.vue').includes('v-if="submissionError"'))
  const dateNow = new Date('2026-11-02T15:59:59Z')
  const sample = { ...validForm, reservationDate: '2026-11-02' }
  assert.deepEqual(validation.getReservationFieldErrors(sample, dateNow), {})
  assert.equal(validation.getReservationFieldErrors(sample, new Date('2026-11-02T16:00:00Z')).reservationDate, '预约日期不能早于今天', 'China day boundary')
  for (const date of ['2027-02-29', '2026-13-01', '2026-11-31', '2026-1-03', 'invalid']) {
    assert.ok(validation.getReservationFieldErrors({ ...validForm, reservationDate: date }, dateNow).reservationDate)
  }
  assert.equal(validation.isValidReservationDate('2028-02-29'), true)
  assert.deepEqual(validation.getReservationFieldErrors({ ...validForm, specialNeeds: '' }), {})
  assert.ok(validation.getReservationFieldErrors({ ...validForm, specialNeeds: 'a'.repeat(501) }).specialNeeds)
  assert.ok(validation.getReservationFieldErrors({ ...validForm, specialNeeds: {} }).specialNeeds)
  for (const date of [undefined, null, '', '   ']) {
    assert.deepEqual(validation.getReservationFieldErrors({ ...validForm, reservationDate: date }), {}, 'Empty date is optional')
  }
  for (const date of [123, false, {}, []]) assert.ok(validation.getReservationFieldErrors({ ...validForm, reservationDate: date }).reservationDate)
  for (const repeatReservation of ['是', '否', undefined]) assert.deepEqual(validation.getReservationFieldErrors({ ...validForm, repeatReservation }), {})
  for (const repeatReservation of ['', 'yes', true, 1, null, {}, []]) assert.ok(validation.getReservationFieldErrors({ ...validForm, repeatReservation }).repeatReservation)
  const optionalPayloads = []
  let optionalFailure = true
  const optionalBooking = component('pages/bed-reservation/index.vue', { ...helpers, ...validation, ReservationCaptcha: {},
    createBedReservation: async payload => { optionalPayloads.push(payload); if (optionalFailure) throw Error('网络错误'); return { accepted: true } }
  }).instance
  optionalBooking.form = { ...validForm }
  optionalBooking.clearReservationDate()
  assert.equal(optionalBooking.form.reservationDate, '')
  optionalBooking.handleDateChange({ detail: { value: '2099-12-31' } })
  optionalBooking.submitting = true
  optionalBooking.clearReservationDate()
  assert.equal(optionalBooking.form.reservationDate, '2099-12-31', 'Submitting locks date clearing')
  optionalBooking.submitting = false
  optionalBooking.clearReservationDate()
  optionalBooking.$nextTick = async () => {}
  optionalBooking.captcha = { id: 'optional-1', code: 'A2B3' }
  await optionalBooking.handleSubmit()
  assert.equal(optionalPayloads.length, 1, 'Blank date can reach the submission API')
  assert.equal(optionalPayloads[0].form.repeatReservation, undefined)
  assert.equal(optionalPayloads[0].form.reservationDate, '')
  assert.equal(optionalBooking.form.diagnosis, validForm.diagnosis, 'Failure retains patient contents')
  optionalBooking.captcha = { id: 'optional-2', code: 'D5E6' }
  await optionalBooking.handleSubmit()
  assert.equal(optionalPayloads[1].requestId, optionalPayloads[0].requestId)
  optionalBooking.form.diagnosis = '更新病情介绍'
  optionalBooking.captcha = { id: 'optional-3', code: 'F7G8' }
  optionalFailure = false
  await optionalBooking.handleSubmit()
  assert.notEqual(optionalPayloads[2].requestId, optionalPayloads[1].requestId, 'Changing patient contents makes a new submission identity')
  assert.equal(optionalPayloads[2].form.diagnosis, '更新病情介绍')
  assert.equal(optionalBooking.submitted, true)
  assert.equal(optionalBooking.form.repeatReservation, undefined)
  assert.equal(optionalBooking.form.reservationDate, '')
  assert.ok(read('pages/nurse/list.vue').includes('record.repeatReservation'))
  assert.ok(read('pages/nurse/reservation-detail.vue').includes('reservation.repeatReservation'))
  // Admission notice: visible before filling; submission requires an explicit fresh confirmation.
  const noticeDialogs = [], noticeRequests = [], noticeApi = deferred()
  let modalThrows = false
  const noticeBooking = component('pages/bed-reservation/index.vue', { ...helpers, ReservationCaptcha: {},
    uni: { ...uni, showModal: value => { if (modalThrows) throw Error('Modal unavailable'); noticeDialogs.push(value) } },
    createBedReservation: async body => { noticeRequests.push(body); await noticeApi.promise; return { accepted: true } }
  }).instance
  const warning = '⚠️预约仅排队登记，须等康复科电话通知入院，未通知请勿自行来院。'
  assert.equal(noticeBooking.bookingNotice, warning)
  const noticeTemplate = read('pages/bed-reservation/index.vue')
  assert.ok(noticeTemplate.indexOf('class="booking-notice"') < noticeTemplate.indexOf('<block v-if="!submitted">'), 'Top warning remains visible before and after submission')
  await noticeBooking.handleSubmit()
  assert.equal(noticeDialogs.length, 0, 'Invalid form must show field errors before a modal')
  noticeBooking.form = { ...validForm, doctor: '殷茵', tubeTypes: ['胃管'], otherTube: '' }
  noticeBooking.captcha = { id: 'notice-challenge', code: 'A2B3' }
  const originalForm = JSON.stringify(noticeBooking.form)
  const cancelledNotice = noticeBooking.handleSubmit()
  assert.equal(noticeBooking.confirming, true); assert.equal(noticeBooking.submissionBusy, true)
  assert.equal(noticeDialogs.length, 1); assert.equal(noticeRequests.length, 0)
  assert.equal(noticeDialogs[0].content, warning)
  assert.equal(noticeDialogs[0].confirmText, '已知晓，提交'); assert.equal(noticeDialogs[0].cancelText, '返回检查')
  await noticeBooking.handleSubmit()
  assert.equal(noticeDialogs.length, 1, 'Double click must not open a second confirmation')
  noticeBooking.handleDoctorChange({ detail: { value: '1' } }); noticeBooking.clearDoctor()
  noticeBooking.handleTubeChange({ detail: { value: [] } }); noticeBooking.clearReservationDate()
  noticeBooking.handleGenderChange({ detail: { value: '0' } }); noticeBooking.handleAgeInput({ detail: { value: '99' } })
  noticeBooking.handleIdCardInput({ detail: { value: 'invalid' } }); noticeBooking.handleDateChange({ detail: { value: '2000-01-01' } })
  assert.equal(JSON.stringify(noticeBooking.form), originalForm, 'Form handlers locked during confirmation')
  noticeDialogs[0].success({ confirm: false }); await cancelledNotice
  assert.equal(noticeBooking.submissionBusy, false); assert.equal(noticeBooking.requestId, '')
  assert.equal(noticeBooking.captcha.code, 'A2B3'); assert.equal(noticeRequests.length, 0)
  assert.equal(JSON.stringify(noticeBooking.form), originalForm, 'Returning to check preserves all input and captcha')
  const failedNotice = noticeBooking.handleSubmit(); noticeDialogs[1].fail(); await failedNotice
  assert.equal(noticeBooking.submissionBusy, false); assert.equal(noticeRequests.length, 0)
  modalThrows = true; await noticeBooking.handleSubmit(); modalThrows = false
  assert.equal(noticeBooking.submissionBusy, false); assert.equal(noticeRequests.length, 0, 'Modal errors never silently submit')
  const expiredNotice = noticeBooking.handleSubmit()
  noticeBooking.captcha = { id: '', code: '' }; noticeDialogs[2].success({ confirm: true }); await expiredNotice
  assert.ok(noticeBooking.fieldErrors.captcha); assert.equal(noticeRequests.length, 0, 'Captcha expires safely while reminder is open')
  noticeBooking.captcha = { id: 'notice-challenge-2', code: 'D5E6' }
  const confirmedNotice = noticeBooking.handleSubmit(); noticeDialogs[3].success({ confirm: true }); await tick()
  assert.equal(noticeRequests.length, 1); assert.equal(noticeBooking.submitting, true)
  await noticeBooking.handleSubmit(); assert.equal(noticeRequests.length, 1, 'Submission is locked while the API is pending')
  assert.equal(noticeRequests[0].captcha.code, 'D5E6')
  noticeApi.resolve(); await confirmedNotice
  assert.equal(noticeBooking.submitted, true); assert.equal(noticeBooking.submissionBusy, false)
  await noticeBooking.handleSubmit(); assert.equal(noticeDialogs.length, 4, 'Success cannot resubmit')

  // The new optional selectors submit arrays and conditionally require other tube text.
  const careSubmissions = []
  let careFailure = true
  const careBooking = component('pages/bed-reservation/index.vue', { ...helpers, ...validation, ReservationCaptcha: {},
    createBedReservation: async data => { careSubmissions.push(data); if (careFailure) throw Error('保存失败'); return { accepted: true } }
  }).instance
  assert.deepEqual(Array.from(careBooking.doctorOptions), ['殷茵', '杨浩宇', '朱广浩', '饶志远', '其他'])
  careBooking.handleDoctorChange({ detail: { value: '3' } })
  assert.equal(careBooking.form.doctor, '饶志远')
  assert.equal(careBooking.doctorIndex, 3)
  assert.deepEqual(Array.from(careBooking.tubeOptions), ['胃管', '尿管', 'PICC管', '气切管', 'CVC管', '胃造瘘管', '输液港', '其他'])
  careBooking.handleDoctorChange({ detail: { value: '1' } })
  assert.equal(careBooking.form.doctor, '杨浩宇'); assert.equal(careBooking.doctorIndex, 1)
  careBooking.handleDoctorChange({ detail: { value: '99' } })
  assert.equal(careBooking.form.doctor, '杨浩宇')
  careBooking.clearDoctor(); assert.equal(careBooking.form.doctor, '')
  careBooking.form = { ...validForm, doctor: '殷茵', tubeTypes: [], otherTube: '' }
  careBooking.handleTubeChange({ detail: { value: ['其他', 'PICC管', '胃管'] } })
  assert.deepEqual(Array.from(careBooking.form.tubeTypes), ['胃管', 'PICC管', '其他'])
  careBooking.captcha = { id: 'care1', code: 'A2B3' }
  await careBooking.handleSubmit()
  assert.equal(careSubmissions.length, 0); assert.equal(careBooking.fieldErrors.otherTube, '请填写其他管道名称')
  careBooking.form.otherTube = '  测试管道  '
  careBooking.$nextTick = async () => {}; careBooking.$refs = {}
  await careBooking.handleSubmit()
  assert.equal(careSubmissions.length, 1)
  assert.deepEqual(Array.from(careSubmissions[0].form.tubeTypes), ['胃管', 'PICC管', '其他'], 'Checkbox values must remain an array')
  assert.equal(careSubmissions[0].form.otherTube, '测试管道')
  assert.equal(careSubmissions[0].form.doctor, '殷茵')
  assert.equal(careBooking.form.otherTube, '  测试管道  ', 'Failure preserves input')
  careBooking.captcha = { id: 'care2', code: 'A2B3' }
  await careBooking.handleSubmit()
  assert.equal(careSubmissions[1].requestId, careSubmissions[0].requestId)
  careBooking.submitting = true
  careBooking.handleDoctorChange({ detail: { value: '2' } }); careBooking.clearDoctor()
  careBooking.handleTubeChange({ detail: { value: [] } })
  assert.equal(careBooking.form.doctor, '殷茵'); assert.equal(careBooking.form.tubeTypes.length, 3)
  careBooking.submitting = false
  careBooking.handleTubeChange({ detail: { value: ['胃管'] } })
  assert.equal(careBooking.form.otherTube, '', 'Deselecting other clears the hidden input')
  careBooking.captcha = { id: 'care3', code: 'A2B3' }; careFailure = false
  await careBooking.handleSubmit()
  assert.notEqual(careSubmissions[2].requestId, careSubmissions[1].requestId)
  assert.equal(careBooking.form.doctor, ''); assert.equal(careBooking.form.tubeTypes.length, 0); assert.equal(careBooking.form.otherTube, '')
  const careDetail = component('pages/nurse/reservation-detail.vue', helpers).instance
  careDetail.reservation = { tubeTypes: ['胃管', '其他'], otherTube: '测试管道' }
  assert.equal(careDetail.tubeSummary, '胃管、其他：测试管道')
  careDetail.reservation = { tubeTypes: [] }; assert.equal(careDetail.tubeSummary, '未填写')
  // Nurse list actions: pending guard, optional new date, retry lock, delete confirmation and refresh.
  const actions = [], deletionCalls = []
  let queueTotal = 7, dueTotal = 2, rebookFailure = true, deletionFailure = false
  let rebookJob = null, deleteJob = null
  const nurseActions = component('pages/nurse/list.vue', { ...helpers, ...validation,
    getBedReservations: async () => ({ items: [{ id: 901, status: '预约中' }], total: queueTotal, hasMore: false, nextCursor: null }),
    getBedReservationReminders: async () => ({ date: '2099-01-01', total: dueTotal }),
    rebookBedReservation: async (id, body) => { actions.push({ id, body }); if (rebookJob) await rebookJob.promise; if (rebookFailure) throw Error('网络中断'); queueTotal++; return { reservation: { id: 901 } } },
    deleteBedReservation: async id => { deletionCalls.push(id); if (deleteJob) await deleteJob.promise; if (deletionFailure) throw Error('删除失败'); queueTotal--; dueTotal--; return { deleted: true } }
  }).instance
  nurseActions.activeTab = 'reservations'
  nurseActions.openRebook({ id: 30, name: '测试', status: '预约中' })
  assert.equal(nurseActions.rebookTarget, null, 'No repeat action for pending source')
  nurseActions.openRebook({ id: 30, name: '测试', status: '预约成功', reservationDate: '2000-01-01' })
  assert.equal(nurseActions.rebookDate, '', 'Never copy a stale source appointment date')
  const initialActionId = nurseActions.rebookRequestId
  nurseActions.handleRebookDateChange({ detail: { value: '2099-12-31' } })
  assert.notEqual(nurseActions.rebookRequestId, initialActionId)
  nurseActions.clearRebookDate()
  assert.equal(nurseActions.rebookDate, '')
  const retryActionId = nurseActions.rebookRequestId
  await nurseActions.handleRebook()
  assert.equal(actions.length, 1)
  assert.equal(actions[0].body.reservationDate, '')
  assert.equal(nurseActions.rebookRequestId, retryActionId, 'Failed request retains its idempotency identity')
  assert.equal(nurseActions.rebookError, '网络中断')
  rebookJob = deferred(); rebookFailure = false
  const rebookPending = nurseActions.handleRebook()
  await nurseActions.handleRebook()
  nurseActions.closeRebook()
  nurseActions.handleRebookDateChange({ detail: { value: '2099-12-30' } })
  assert.equal(nurseActions.rebookDate, '', 'Cannot edit or close while saving')
  assert.equal(actions.length, 2, 'Double clicks issue one new request')
  assert.equal(actions[1].body.requestId, retryActionId)
  rebookJob.resolve(); await rebookPending; rebookJob = null
  assert.equal(nurseActions.rebookTarget, null)
  assert.equal(nurseActions.currentList.total, 8, 'Mutation refreshes full matching count')
  assert.equal(nurseActions.reminders.total, 2)
  assert.equal(nurseActions.actionBusy, false)
  nurseActions.openRebook({ id: 31, name: '测试', status: '取消预约' })
  nurseActions.rebookDate = '2000-01-01'
  await nurseActions.handleRebook()
  assert.equal(actions.length, 2, 'Invalid dates never reach the API')
  nurseActions.closeRebook()
  modalConfirm = false
  await nurseActions.handleDeleteReservation({ id: 901, name: '测试' })
  assert.equal(deletionCalls.length, 0, 'Cancel deletion leaves the record intact')
  modalConfirm = true; deletionFailure = true
  await nurseActions.handleDeleteReservation({ id: 901, name: '测试' })
  assert.equal(nurseActions.currentList.total, 8)
  assert.equal(toasts.at(-1).title, '删除失败')
  deletionFailure = false; deleteJob = deferred()
  const deleting = nurseActions.handleDeleteReservation({ id: 901, name: '测试' })
  await tick()
  await nurseActions.handleDeleteReservation({ id: 901, name: '测试' })
  assert.equal(deletionCalls.length, 2, 'One failed attempt plus one active deletion; double click ignored')
  deleteJob.resolve(); await deleting
  assert.equal(nurseActions.currentList.total, 7)
  assert.equal(nurseActions.reminders.total, 1, 'Deletion refreshes in-site reminder counts')
  assert.equal(nurseActions.actionBusy, false)
  const nurseSource = read('pages/nurse/list.vue')
  for (const handler of ['openRebook(record)', 'handleDeleteReservation(record)']) assert.ok(nurseSource.includes('@tap.stop="' + handler + '"'), 'Action button must not trigger opening card details')
  assert.ok(nurseSource.includes('删除后无法恢复'))
  // Staff drafts survive errors and protect concurrent edits with the server version.
  let noteCalls = 0, noteMode = 'conflict', noteJob
  const notePage = component('pages/nurse/list.vue', { ...helpers,
    updateBedReservationNote: async (id, data) => {
      noteCalls++
      if (noteMode === 'conflict') throw Object.assign(Error('其他护士已修改'), { code: 'NOTE_VERSION_CONFLICT' })
      if (noteJob) await noteJob.promise
      return { reservation: { id, staffNote: data.note.trim(), staffNoteVersion: data.version + 1, staffNoteUpdatedAt: '2026-11-14T01:00:00Z' } }
    },
    getBedReservation: async id => ({ reservation: { id, staffNote: '其他护士的备注', staffNoteVersion: 2 } })
  }).instance
  const noteRecord = { id: 902, staffNote: '原备注', staffNoteVersion: 1 }
  notePage.changeNote(noteRecord, { detail: { value: '我的修改' } })
  await notePage.saveNote(noteRecord)
  assert.equal(notePage.noteEditors[902].text, '我的修改', 'Conflict preserves unsaved text')
  assert.equal(notePage.noteEditors[902].conflict, true)
  await notePage.refreshNote(noteRecord)
  assert.equal(notePage.noteEditors[902].text, '其他护士的备注'); assert.equal(notePage.noteEditors[902].version, 2)
  notePage.changeNote(noteRecord, { detail: { value: '已核对的备注' } })
  noteMode = 'success'; noteJob = deferred()
  const noteSaving = notePage.saveNote(noteRecord); await tick()
  await notePage.saveNote(noteRecord)
  assert.equal(noteCalls, 2, 'Repeated save click is ignored while a note is saving')
  noteJob.resolve(); await noteSaving
  assert.equal(noteRecord.staffNote, '已核对的备注'); assert.equal(notePage.noteEditors[902].dirty, false)
  assert.equal(noteRecord.staffNoteVersion, 3)
  const lookupForm = { ...validForm, doctor: '饶志远', tubeTypes: ['胃管'], otherTube: '', specialNeeds: '需要协助' }
  let lookupCalls = 0, lookupJob = deferred(), lookupCaptchaRefresh = 0, submissionCaptchaRefresh = 0
  const patientLookup = component('pages/bed-reservation/index.vue', { ...helpers, ReservationCaptcha: {}, lookupBedReservations: async () => { lookupCalls++; return lookupJob.promise } }).instance
  patientLookup.$nextTick = async () => {}
  patientLookup.$refs = { lookupCaptchaControl: { refresh: async () => { lookupCaptchaRefresh++ } }, captchaControl: { refresh: async () => { submissionCaptchaRefresh++ } } }
  patientLookup.lookupPhone = validForm.phone; patientLookup.lookupIdCard = validForm.idCard; patientLookup.lookupCaptcha = { id: 'proof', code: 'a2b3' }
  const finding = patientLookup.searchPreviousReservations(); await tick()
  await patientLookup.searchPreviousReservations(); assert.equal(lookupCalls, 1)
  const previousBooking = { id: 903, name: validForm.name, status: '预约成功', canRebook: true, form: lookupForm }
  lookupJob.resolve({ pending: false, items: [previousBooking] }); await finding
  assert.equal(patientLookup.lookupResults.length, 1); assert.equal(lookupCaptchaRefresh, 1)
  await patientLookup.usePreviousReservation(patientLookup.lookupResults[0])
  assert.equal(patientLookup.rebooking, true); assert.equal(patientLookup.form.name, validForm.name)
  assert.equal(patientLookup.form.reservationDate, '', 'A new date is optional and never copied from an old booking')
  assert.equal(patientLookup.form.doctor, '饶志远'); assert.equal(submissionCaptchaRefresh, 1)
  assert.notEqual(patientLookup.form.tubeTypes, lookupForm.tubeTypes, 'Copied care arrays do not mutate history')
  patientLookup.lookupPending = true; patientLookup.rebooking = false
  await patientLookup.usePreviousReservation(patientLookup.lookupResults[0]); assert.equal(patientLookup.rebooking, false)
  patientLookup.lookupPending = false
  patientLookup.changeLookup('phone', { detail: { value: '13900139000' } })
  assert.equal(patientLookup.lookupResults.length, 0, 'Changing identity clears previous search results')
  assert.equal(patientLookup.lookupSearched, false)
  await patientLookup.cancelPublicRebook()
  assert.equal(patientLookup.form.name, ''); assert.equal(patientLookup.rebooking, false)
  console.log('PASS: per-record note drafts/save locks/conflict recovery; identity lookup locks, captcha refresh, pending guards and patient rebooking prefills')
  const emitted = []
  let imageFailure = false
  const widget = component('components/reservation-captcha/index.vue', {
    setTimeout: () => 1, clearTimeout() {},
    getReservationCaptcha: async () => { if (imageFailure) throw Error('加载失败'); return { id: 'c1', image: 'data:image/svg+xml;base64,PHN2Zz4=', expiresIn: 300 } }
  }).instance
  widget.$emit = (name, value) => emitted.push(value)
  widget.value = { id: '', code: '' }; widget.disabled = false
  await widget.refresh()
  assert.equal(widget.challengeId, 'c1')
  assert.equal(emitted.at(-1).code, '')
  widget.handleInput({ detail: { value: 'a2-B3 c4' } })
  assert.equal(emitted.at(-1).code, 'a2B3')
  widget.disabled = true
  await widget.refresh()
  assert.equal(widget.challengeId, 'c1', 'Submitting prevents changing challenge')
  widget.disabled = false
  widget.handleImageError()
  assert.equal(widget.challengeId, '')
  assert.equal(emitted.at(-1).id, '')
  imageFailure = true
  await widget.refresh()
  assert.equal(widget.loading, false)
  assert.equal(widget.error, '加载失败')
  console.log('PASS: admission queue warning, explicit submission confirmation, cancel/fail/expiry safety and modal/API double-click locks; doctor dropdown, multi-tube array payload, conditional other text, input preservation/clearing/locks, nurse care detail; nurse-only repeat/delete UI, optional rebooking date, safe retries/double clicks, deletion confirmation and count/reminder refresh, no public repeat option, optional/clearable dates, payload retries, nurse tomorrow reminder polling, midnight rollover, reminder filters/pagination, hidden-response protection, tabs, independent pagination/search, stale responses, detail refresh, flow picker, modal cancellation, duplicate clicks, status visibility, pending duplicate error display/input retention, public submission/retry, time formatting')
})().catch(error => { console.error(error); process.exitCode = 1 })
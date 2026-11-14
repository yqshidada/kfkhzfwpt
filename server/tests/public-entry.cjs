// Unit regression tests: no database writes or patient data required.
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const storage = new Map()
let currentPages = [{ route: 'pages/index/index', options: {} }]
const calls = []
global.getCurrentPages = () => currentPages
global.uni = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  reLaunch: options => calls.push({ type: 'reLaunch', ...options }),
  navigateTo: options => calls.push({ type: 'navigateTo', ...options }),
  showToast: options => calls.push({ type: 'toast', ...options })
}
function loadPage(file, bindings) {
  const script = read(file).match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^\s*import .*$/gm, '').replace('export default', 'module.exports =')
  const context = { module: { exports: {} }, uni, process, ...bindings }
  vm.runInNewContext(script, context, { filename: file })
  return context.module.exports
}
function instance(page) {
  const value = page.data()
  for (const [key, method] of Object.entries(page.methods || {})) value[key] = method.bind(value)
  return value
}
;(async () => {
  const auth = await import('data:text/javascript;base64,' + Buffer.from(read('utils/auth.js')).toString('base64'))
  const publicRoutes = ['/pages/index/index', '/pages/rylc/index', '/pages/bed-reservation/index', '/pages/login/index']
  const protectedRoutes = ['/pages/hzjbxx/index', '/pages/nurse/list', '/pages/nurse/list?mode=flow', '/pages/nurse/detail?id=3', '/pages/nurse/reservation-detail?id=3', '/pages/cylc/index?id=3']
  for (const route of publicRoutes) assert.equal(auth.requiresAuthentication(route), false, route)
  for (const route of protectedRoutes) {
    assert.equal(auth.requiresAuthentication(route), true, route)
    assert.equal(auth.ensureAuthenticated(route), false)
    assert.equal(calls.at(-1).url, auth.LOGIN_ROUTE + '?next=' + encodeURIComponent(route))
  }
  for (const route of ['https://example.com', '//example.com', '/pages/login/index', '/pages/unknown/index', null, '/pages/nurse/list#bad']) {
    assert.equal(auth.getLoginDestination(route), auth.HOME_ROUTE)
  }
  const guardCode = read('main.js').match(/function guardPage\(\) \{[\s\S]*?\n\}/)[0]
  const guard = vm.runInNewContext(guardCode + '; guardPage', { ...auth })
  calls.length = 0
  for (const route of publicRoutes) guard.call({ $page: { fullPath: route } })
  assert.equal(calls.length, 0, 'Public pages must not redirect')
  currentPages = [{ route: 'pages/nurse/list', options: { mode: 'flow' } }]
  guard.call({ route: 'pages/nurse/list' })
  assert.equal(calls.at(-1).url, auth.LOGIN_ROUTE + '?next=' + encodeURIComponent('/pages/nurse/list?mode=flow'))
  assert.equal(auth.getCurrentPageUrl(), '/pages/nurse/list?mode=flow')
  currentPages = [{ route: 'pages/login/index' }]
  const count = calls.length
  auth.redirectToLogin()
  assert.equal(calls.length, count, 'No login redirect loop')
  currentPages = [{ route: 'pages/index/index' }]
  const homeSource = read('pages/index/index.vue')
  assert.ok(homeSource.includes('<text class="page-header__title">康复科患者服务平台</text>'), 'Public homepage shows the platform name at the top')
  assert.equal(JSON.parse(read('pages.json')).pages[0].style.navigationBarTitleText, '康复科患者服务平台')
  assert.ok(homeSource.includes('flex-wrap: wrap'), 'Long platform name can wrap separately from logout on narrow screens')
  const homePage = loadPage('pages/index/index.vue', auth)
  const home = instance(homePage)
  homePage.onShow.call(home)
  assert.equal(home.loggedIn, false)
  assert.equal(home.menuItems.length, 5)
  for (const item of home.menuItems) {
    home.handleMenuTap(item)
    assert.equal(calls.at(-1).type, auth.requiresAuthentication(item.path) ? 'reLaunch' : 'navigateTo')
    if (!auth.requiresAuthentication(item.path)) assert.equal(calls.at(-1).url, item.path)
  }
  const session = { token: 'unit-test-only', expiresAt: Math.floor(Date.now() / 1000) + 3600, user: {} }
  const loginSource = read('pages/login/index.vue')
  assert.ok(loginSource.includes('<text class="brand-title">登录</text>'), 'Shared login page uses the concise login heading')
  assert.ok(!loginSource.includes('康复科出院指导'), 'Old login heading must not return')
  const loginPage = loadPage('pages/login/index.vue', { ...auth, login: async () => session })
  const login = instance(loginPage)
  loginPage.onLoad.call(login, { next: '/pages/nurse/list?mode=flow' })
  login.username = '13800138000'
  login.password = 'UnitTest1234'
  await login.handleLogin()
  assert.equal(calls.at(-1).url, '/pages/nurse/list?mode=flow', 'Login preserves selected flow mode')
  for (const route of protectedRoutes) assert.equal(auth.ensureAuthenticated(route), true)
  homePage.onShow.call(home)
  assert.equal(home.loggedIn, true)
  home.handleLogout()
  assert.equal(home.loggedIn, false)
  assert.equal(auth.isLoggedIn(), false)
  assert.equal(calls.at(-1).type, 'toast', 'Logout keeps the public homepage')
  auth.saveSession({ ...session, expiresAt: 1 })
  assert.equal(auth.isLoggedIn(), false)
  assert.equal(storage.size, 0)
  login.goHome()
  assert.equal(calls.at(-1).url, auth.HOME_ROUTE)
  const reservationPage = loadPage('pages/bed-reservation/index.vue', { ...auth, ...require('../reservation-validation'), formatReservationTime: value => value, ReservationCaptcha: {} })
  const reservation = instance(reservationPage)
  assert.deepEqual(JSON.parse(JSON.stringify(reservation.form)), { name: '', gender: '', age: '', phone: '', idCard: '', diagnosis: '', reservationDate: '', specialNeeds: '', doctor: '', tubeTypes: [], otherTube: '' })
  assert.deepEqual(Array.from(reservation.genderOptions), ['男', '女'])
  assert.equal(reservation.form.repeatReservation, undefined, 'Public form has no repeat option')
  assert.ok(!fs.readFileSync(path.join(root, 'pages/bed-reservation/index.vue'), 'utf8').includes('是否再次预约'))
  reservation.handleGenderChange({ detail: { value: '1' } })
  assert.equal(reservation.form.gender, '女')
  assert.equal(reservationPage.computed.genderIndex.call(reservation), 1)
  reservation.handleAgeInput({ detail: { value: '2a8' } })
  assert.equal(reservation.form.age, '28')
  assert.equal(JSON.parse(read('pages.json')).pages[0].path, 'pages/index/index')
  // Exercise the real request wrapper after selecting its H5 conditional branch.
  let apiCode = read('utils/api.js').replace(/^import .*$/gm, '')
    .replace(/\/\/ #ifndef H5[\s\S]*?\/\/ #endif/, '')
    .replace(/export /g, '')
  const requests = []
  const api = vm.runInNewContext(apiCode + '; ({ getAdmissionFlowShare, getDischargeRecords, rebookBedReservation, deleteBedReservation })', {
    ...auth, uni: { ...uni, request: options => { requests.push(options); options.success({ statusCode: 200, data: { ok: true } }) } }
  })
  await api.getAdmissionFlowShare()
  assert.equal(requests[0].url, '/api/admission-flow/share')
  assert.equal(requests[0].header.Authorization, undefined)
  await assert.rejects(api.getDischargeRecords({}), /登录/)
  await assert.rejects(api.rebookBedReservation(7, { requestId: 'test' }), /登录/)
  await assert.rejects(api.deleteBedReservation(7), /登录/)
  assert.equal(requests.length, 1, 'Private API must not send anonymous requests')
  auth.saveSession(session)
  await api.rebookBedReservation(7, { requestId: 'test', reservationDate: '' })
  assert.equal(requests.at(-1).url, '/api/bed-reservations/7/rebook')
  assert.equal(requests.at(-1).method, 'POST')
  assert.ok(requests.at(-1).header.Authorization)
  await api.deleteBedReservation(7)
  assert.equal(requests.at(-1).url, '/api/bed-reservations/7')
  assert.equal(requests.at(-1).method, 'DELETE')
  assert.ok(requests.at(-1).header.Authorization)
  console.log('PASS: public routes, all protected entries, direct-link guards, login return destination, logout, expired sessions, reservation fields and API auth boundaries')
})().catch(error => { console.error(error); process.exitCode = 1 })

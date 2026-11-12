// Shared, dependency-free validation; safe to bundle into the public form.
// Mainland 18-character ID structural validation, not real-name verification.
const PROVINCES = new Set(['11','12','13','14','15','21','22','23','31','32','33','34','35','36','37','41','42','43','44','45','46','50','51','52','53','54','61','62','63','64','65'])
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_DIGITS = '10X98765432'
const RESERVATION_DOCTORS = ['殷茵', '杨浩宇', '朱广浩', '姚志远', '其他']
const RESERVATION_TUBES = ['胃管', '尿管', 'PICC管', '气切管', 'CVC管', '胃造瘘管', '输液港', '其他']
function normalizeReservationCare(source = {}) {
  const selected = Array.isArray(source.tubeTypes) ? source.tubeTypes : []
  const tubeTypes = RESERVATION_TUBES.filter(value => selected.includes(value))
  return {
    doctor: typeof source.doctor === 'string' ? source.doctor.trim() : '',
    tubeTypes,
    otherTube: tubeTypes.includes('其他') && typeof source.otherTube === 'string' ? source.otherTube.trim() : ''
  }
}
function normalizeIdCard(value) { return typeof value === 'string' ? value.trim().toUpperCase() : '' }
function isValidMobile(value) { return typeof value === 'string' && /^1[3-9]\d{9}$/.test(value) }
function isValidIdCard(value, now = new Date()) {
  const id = normalizeIdCard(value)
  if (!/^[1-9]\d{16}[0-9X]$/.test(id) || !PROVINCES.has(id.slice(0, 2))) return false
  const year = Number(id.slice(6, 10)), month = Number(id.slice(10, 12)), day = Number(id.slice(12, 14))
  if (year < 1800 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const birthday = new Date(Date.UTC(year, month - 1, day))
  if (birthday.getUTCFullYear() !== year || birthday.getUTCMonth() !== month - 1 || birthday.getUTCDate() !== day) return false
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '')
  if (id.slice(6, 14) > today) return false
  const sum = WEIGHTS.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
  return id[17] === CHECK_DIGITS[sum % 11]
}
function beijingDate(now = new Date()) { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) }
function isValidReservationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function getReservationFieldErrors(source = {}, now = new Date()) {
  const text = key => typeof source[key] === 'string' ? source[key].trim() : ''
  const errors = {}
  const name = text('name'), gender = text('gender'), age = text('age')
  const phone = text('phone'), idCard = normalizeIdCard(source.idCard), diagnosis = text('diagnosis')
  if (!name) errors.name = '请输入姓名'
  else if (name.length > 50) errors.name = '姓名不能超过50字'
  if (!gender) errors.gender = '请选择性别'
  else if (!['男', '女'].includes(gender)) errors.gender = '请选择男或女'
  if (!age) errors.age = '请输入年龄'
  else if (!/^\d{1,3}$/.test(age) || Number(age) > 120) errors.age = '请输入0至120之间的整数年龄'
  if (!phone) errors.phone = '请输入手机号'
  else if (!isValidMobile(phone)) errors.phone = '请输入正确的11位手机号'
  if (!idCard) errors.idCard = '请输入身份证号'
  else if (!isValidIdCard(idCard)) errors.idCard = '请输入有效的18位身份证号（日期及校验码须正确）'
  const reservationDate = text('reservationDate'), specialNeeds = text('specialNeeds')
  if (source.reservationDate != null && typeof source.reservationDate !== 'string') errors.reservationDate = '请选择有效的预约日期'
  else if (reservationDate && !isValidReservationDate(reservationDate)) errors.reservationDate = '请选择有效的预约日期'
  else if (reservationDate && reservationDate < beijingDate(now)) errors.reservationDate = '预约日期不能早于今天'
  if (source.repeatReservation !== undefined && !['是', '否'].includes(source.repeatReservation)) errors.repeatReservation = '请选择是否再次预约（是或否）'
  if (!diagnosis) errors.diagnosis = '请输入诊断及病情介绍'
  else if (diagnosis.length > 500) errors.diagnosis = '诊断及病情介绍不能超过500字'
  if (source.specialNeeds != null && typeof source.specialNeeds !== 'string') errors.specialNeeds = '特殊需求格式无效'
  else if (specialNeeds.length > 500) errors.specialNeeds = '特殊需求不能超过500字'
  const care = normalizeReservationCare(source)
  if (source.doctor != null && typeof source.doctor !== 'string') errors.doctor = '请选择有效的预约医生'
  else if (care.doctor && !RESERVATION_DOCTORS.includes(care.doctor)) errors.doctor = '请选择列表中的预约医生'
  if (source.tubeTypes != null && (!Array.isArray(source.tubeTypes) || source.tubeTypes.length > RESERVATION_TUBES.length || source.tubeTypes.some(value => typeof value !== 'string' || !RESERVATION_TUBES.includes(value)))) errors.tubeTypes = '请选择有效的管道类型'
  if (source.otherTube != null && typeof source.otherTube !== 'string') errors.otherTube = '其他管道内容格式无效'
  else if (care.tubeTypes.includes('其他') && !care.otherTube) errors.otherTube = '请填写其他管道名称'
  else if (care.otherTube.length > 100) errors.otherTube = '其他管道名称不能超过100字'
  return errors
}
module.exports = { RESERVATION_DOCTORS, RESERVATION_TUBES, normalizeReservationCare, normalizeIdCard, isValidMobile, isValidIdCard, beijingDate, isValidReservationDate, getReservationFieldErrors }

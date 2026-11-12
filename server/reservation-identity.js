const crypto = require('crypto')
const { normalizeIdCard } = require('./reservation-validation')
function getKey() {
  const key = process.env.RESERVATION_ID_KEY || ''
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw Object.assign(new Error('预约服务安全配置未就绪，请联系管理员'), { statusCode: 503, code: 'RESERVATION_KEY_MISSING' })
  }
  return Buffer.from(key, 'hex')
}
function encryptIdCard(idCard, requestId) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  // Binding the ciphertext to the request prevents swapping identities between records.
  cipher.setAAD(Buffer.from('bed-reservation:' + requestId))
  const encrypted = Buffer.concat([cipher.update(idCard, 'utf8'), cipher.final()])
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.')
}
function decryptIdCard(value, requestId) {
  if (!value) return null // Historic records were created without this field.
  const key = getKey()
  try {
    const parts = value.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1' || !/^[a-f0-9]{24}$/.test(parts[1]) || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{36}$/.test(parts[3])) throw Error('Invalid encrypted identity')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'hex'))
    decipher.setAAD(Buffer.from('bed-reservation:' + requestId))
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8')
  } catch (_) { throw Object.assign(new Error('预约身份信息暂不可读取，请联系管理员'), { statusCode: 503, code: 'RESERVATION_ID_UNREADABLE' }) }
}
function fingerprintIdCard(idCard) {
  // Keyed/domain-separated lookup token; never store an unkeyed hash of identity numbers.
  return crypto.createHmac('sha256', getKey())
    .update('bed-reservation:identity:v1:' + normalizeIdCard(idCard)).digest('hex')
}
module.exports = { encryptIdCard, decryptIdCard, fingerprintIdCard }

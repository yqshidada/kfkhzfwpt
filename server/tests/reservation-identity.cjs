const assert = require('assert/strict')
const crypto = require('crypto')
const { isValidIdCard, normalizeIdCard, isValidMobile } = require('../reservation-validation')
const { encryptIdCard, decryptIdCard, fingerprintIdCard } = require('../reservation-identity')
// Public GB 11643-style example used only as a test fixture, not a patient identity.
const id = '11010519491231002X'
const now = new Date('2026-10-29T00:00:00Z')
function withChecksum(prefix) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  return prefix + '10X98765432'[weights.reduce((sum, weight, i) => sum + Number(prefix[i]) * weight, 0) % 11]
}
assert.equal(isValidIdCard(id, now), true)
assert.equal(isValidIdCard(id.toLowerCase(), now), true)
assert.equal(normalizeIdCard(' ' + id.toLowerCase() + ' '), id)
for (const value of ['', '110105491231002', '110105194912310020', id + '0', id.slice(0, 17) + 'A', withChecksum('99010519491231002'), withChecksum('11010520010229002'), withChecksum('11010520000431002'), withChecksum('11010520271029002'), withChecksum('11010519490031002')]) {
  assert.equal(isValidIdCard(value, now), false)
}
assert.equal(isValidIdCard(withChecksum('11010520000229002'), now), true)
for (const phone of ['13800138000', '19900139000']) assert.equal(isValidMobile(phone), true)
for (const phone of ['020-12345678', '12800138000', '1380013800', '138001380000', '+8613800138000', '1380013800X', '']) assert.equal(isValidMobile(phone), false)
const original = process.env.RESERVATION_ID_KEY
try {
  process.env.RESERVATION_ID_KEY = crypto.randomBytes(32).toString('hex')
  const requestId = crypto.randomUUID()
  const fingerprint = fingerprintIdCard(id)
  assert.match(fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(fingerprintIdCard(' ' + id.toLowerCase() + ' '), fingerprint, 'Identity lookup normalizes whitespace and lowercase X')
  assert.notEqual(fingerprintIdCard(withChecksum('11010519491231003')), fingerprint)
  assert.notEqual(fingerprint, crypto.createHash('sha256').update(id).digest('hex'), 'No unkeyed identity hash')
  const encrypted = encryptIdCard(id, requestId)
  assert.ok(!encrypted.includes(id))
  assert.equal(decryptIdCard(encrypted, requestId), id)
  assert.notEqual(encryptIdCard(id, requestId), encrypted, 'Random nonce for every encryption')
  assert.throws(() => decryptIdCard(encrypted, crypto.randomUUID()), error => error.statusCode === 503)
  const parts = encrypted.split('.')
  parts[3] = (parts[3][0] === '0' ? '1' : '0') + parts[3].slice(1)
  assert.throws(() => decryptIdCard(parts.join('.'), requestId), error => error.statusCode === 503)
  process.env.RESERVATION_ID_KEY = crypto.randomBytes(32).toString('hex')
  assert.notEqual(fingerprintIdCard(id), fingerprint, 'Lookup is protected by the secret key')
  assert.throws(() => decryptIdCard(encrypted, requestId), error => error.statusCode === 503)
  delete process.env.RESERVATION_ID_KEY
  assert.throws(() => fingerprintIdCard(id), error => error.statusCode === 503)
  assert.equal(decryptIdCard(null, requestId), null)
  assert.throws(() => encryptIdCard(id, requestId), error => error.statusCode === 503)
  assert.throws(() => decryptIdCard(encrypted, requestId), error => error.statusCode === 503)
} finally {
  if (original === undefined) delete process.env.RESERVATION_ID_KEY
  else process.env.RESERVATION_ID_KEY = original
}
console.log('PASS: mobile numbers, ID length/region/date/leap-year/checksum/lowercase-X, normalized key-protected identity fingerprints, AES-GCM encryption, tamper detection, row binding and missing/wrong keys fail closed')
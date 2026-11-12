const assert = require('assert/strict')
const { createReservationCaptcha, generateText, TTL_MS } = require('../reservation-captcha')
for (let i = 0; i < 500; i++) {
  const text = generateText()
  assert.match(text, /^[A-HJ-NP-Z2-9]{4}$/)
  assert.match(text, /[A-Z]/); assert.match(text, /[2-9]/)
}
let time = 1000
const service = createReservationCaptcha({ now: () => time, textFactory: () => 'A2B3' })
const issue = () => service.issue('127.0.0.1')
const answer = item => ({ id: item.id, code: 'a2b3' })
const first = issue()
assert.equal(first.expiresIn, 300)
assert.match(first.id, /^[a-f0-9]{48}$/)
const svg = Buffer.from(first.image.split(',')[1], 'base64').toString()
assert.ok(svg.includes('<path')); assert.ok(!svg.includes('A2B3')); assert.ok(!svg.includes('<text'))
assert.equal(first.text, undefined)
assert.throws(() => service.verify(null, '127.0.0.1', 'r1'), e => e.code === 'CAPTCHA_INVALID')
for (const code of ['A2B', 'A2B34', 'A2B3C4', 'A2-3', '']) {
  assert.throws(() => service.verify({ id: first.id, code }, '127.0.0.1', 'r1'), e => e.code === 'CAPTCHA_INVALID', 'Only exactly four alphanumeric characters are accepted')
}
assert.throws(() => service.verify(answer(first), 'other-ip', 'r1'), e => e.code === 'CAPTCHA_EXPIRED')
service.verify(answer(first), '127.0.0.1', 'r1')
service.verify(answer(first), '127.0.0.1', 'r1')
assert.throws(() => service.verify(answer(first), '127.0.0.1', 'r2'), e => e.code === 'CAPTCHA_USED')
const wrong = issue()
assert.throws(() => service.verify({ id: wrong.id, code: 'ZZ99' }, '127.0.0.1', 'r3'), e => e.code === 'CAPTCHA_INVALID')
assert.throws(() => service.verify(answer(wrong), '127.0.0.1', 'r3'), e => e.code === 'CAPTCHA_EXPIRED')
const expired = issue(); time += TTL_MS
assert.throws(() => service.verify(answer(expired), '127.0.0.1', 'r4'), e => e.code === 'CAPTCHA_EXPIRED')
const limited = createReservationCaptcha({ now: () => time, textFactory: () => 'A2B3' })
for (let i = 0; i < 60; i++) limited.issue('ip')
assert.throws(() => limited.issue('ip'), e => e.statusCode === 429 && e.retryAfter > 0)
time += 15 * 60 * 1000
assert.ok(limited.issue('ip').id)
const bounded = createReservationCaptcha({ now: () => time, maxEntries: 1 })
bounded.issue('ip')
assert.throws(() => bounded.issue('ip'), e => e.code === 'CAPTCHA_BUSY')
time += TTL_MS
assert.ok(bounded.issue('ip').id)
console.log('PASS: mixed secure random codes, path-only SVG, no answer disclosure, case-insensitive verification, IP binding, one-attempt invalidation, expiry, bound retries, replay protection, issuance rate limit and bounded memory')

const crypto = require('crypto')
const svgCaptcha = require('svg-captcha')
const TTL_MS = 5 * 60 * 1000
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
function generateText() {
  const chars = [LETTERS[crypto.randomInt(LETTERS.length)], DIGITS[crypto.randomInt(DIGITS.length)]]
  const all = LETTERS + DIGITS
  while (chars.length < 4) chars.push(all[crypto.randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
function captchaError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}
// Single-process, bounded, expiring store. Never return/log the answer or put it in SVG text.
function createReservationCaptcha({ now = Date.now, textFactory = generateText, maxEntries = 10000 } = {}) {
  const challenges = new Map(), sources = new Map()
  const digest = text => crypto.createHash('sha256').update(text).digest()
  function prune() {
    const time = now()
    for (const [id, item] of challenges) if (item.expiresAt <= time) challenges.delete(id)
    for (const [ip, item] of sources) if (item.until <= time) sources.delete(ip)
  }
  return {
    issue(ip) {
      prune()
      let source = sources.get(ip)
      if (!source) {
        if (sources.size >= maxEntries) throw captchaError('验证码服务繁忙，请稍后重试', 'CAPTCHA_BUSY', 429)
        source = { count: 0, until: now() + 15 * 60 * 1000 }; sources.set(ip, source)
      }
      if (++source.count > 60) {
        const error = captchaError('获取验证码过于频繁，请稍后重试', 'CAPTCHA_RATE_LIMIT', 429)
        error.retryAfter = Math.max(1, Math.ceil((source.until - now()) / 1000)); throw error
      }
      if (challenges.size >= maxEntries) throw captchaError('验证码服务繁忙，请稍后重试', 'CAPTCHA_BUSY', 429)
      const text = textFactory(), id = crypto.randomBytes(24).toString('hex'), expiresAt = now() + TTL_MS
      const svg = svgCaptcha(text, { width: 160, height: 56, fontSize: 46, noise: 3, color: true, background: '#f2f6fc' })
      challenges.set(id, { answer: digest(text.toUpperCase()), ip, expiresAt, binding: null })
      return { id, image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), expiresAt, expiresIn: TTL_MS / 1000 }
    },
    verify(value, ip, binding) {
      prune()
      if (!value || typeof value.id !== 'string' || !/^[a-f0-9]{48}$/.test(value.id) || typeof value.code !== 'string' || !/^[a-z0-9]{4}$/i.test(value.code.trim())) {
        throw captchaError('请输入4位数字字母验证码', 'CAPTCHA_INVALID')
      }
      const item = challenges.get(value.id)
      if (!item || item.ip !== ip) throw captchaError('验证码已失效，请重新获取', 'CAPTCHA_EXPIRED')
      if (item.binding && item.binding !== binding) throw captchaError('验证码已使用，请重新获取', 'CAPTCHA_USED')
      if (!crypto.timingSafeEqual(item.answer, digest(value.code.trim().toUpperCase()))) {
        challenges.delete(value.id)
        throw captchaError('验证码错误，请输入新验证码', 'CAPTCHA_INVALID')
      }
      // Reserve synchronously before awaiting SQL: concurrent submissions cannot use this
      // challenge for another request. Only an identical idempotent retry may reuse it.
      item.binding = binding
    }
  }
}
module.exports = { createReservationCaptcha, generateText, TTL_MS }

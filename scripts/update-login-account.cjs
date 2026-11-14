// Receives credentials on stdin; never pass passwords in command arguments or commit them.
// Keeps the existing user ID so report ownership and audit records remain valid.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { promisify } = require('util')
async function updateAccount(server, input, socketPath) {
  const username = typeof input.username === 'string' ? input.username.trim() : ''
  const password = input.password
  if (!/^1[3-9]\d{9}$/.test(username) || typeof password !== 'string' || !/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password) || /[\r\n]/.test(password)) throw Error('Invalid login credential format')
  const envPath = path.join(server, '.env'), original = fs.readFileSync(envPath, 'utf8'), settings = {}
  for (const line of original.split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) settings[m[1]] = m[2] }
  const previous = settings.TEST_LOGIN_PHONE || '13800138000'
  const mysql = require(path.join(server, 'node_modules/mysql2/promise'))
  const db = await mysql.createConnection(socketPath ? { user: 'root', socketPath, database: settings.DB_NAME } : { host: settings.DB_HOST || '127.0.0.1', port: Number(settings.DB_PORT || 3306), user: settings.DB_USER, password: settings.DB_PASSWORD, database: settings.DB_NAME })
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = 'scrypt$' + salt + '$' + (await promisify(crypto.scrypt)(password, salt, 64)).toString('hex')
  const replace = (text, key, value) => { const re = new RegExp('^' + key + '\\s*=.*$', 'm'); return re.test(text) ? text.replace(re, () => key + '=' + value) : text.trimEnd() + '\n' + key + '=' + value + '\n' }
  const updated = replace(replace(original, 'TEST_LOGIN_PHONE', username), 'TEST_LOGIN_PASSWORD', password)
  const backup = envPath + '.login-backup-' + Date.now()
  let configChanged = false
  try {
    await db.beginTransaction()
    const [rows] = await db.execute('SELECT id, username FROM system_users WHERE username IN (?, ?) FOR UPDATE', [previous, username])
    const account = rows.find(row => row.username === previous) || rows.find(row => row.username === username)
    if (!account) throw Error('Existing login account not found; no account was changed')
    if (rows.some(row => row.username === username && row.id !== account.id)) throw Error('Target phone belongs to another account; refusing to overwrite ownership')
    await db.execute('UPDATE system_users SET username = ?, password_hash = ? WHERE id = ?', [username, hash, account.id])
    fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' })
    fs.writeFileSync(envPath, updated); configChanged = true
    await db.commit()
    console.log('Login account updated; original user ID and ownership preserved; private configuration backup saved')
  } catch (error) {
    await db.rollback()
    if (configChanged) fs.writeFileSync(envPath, original)
    throw error
  } finally { await db.end() }
}
if (require.main === module) {
  const server = path.resolve(process.argv[2] || path.join(__dirname, '../server'))
  updateAccount(server, JSON.parse(fs.readFileSync(0, 'utf8')), process.argv[3]).catch(error => { console.error('Account update failed:', error.code || error.message); process.exitCode = 1 })
}
module.exports = { updateAccount }
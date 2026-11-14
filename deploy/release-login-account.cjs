// Root-only account release audit. Never prints credentials or patient contents.
const fs = require('fs'), crypto = require('crypto'), assert = require('assert/strict'), path = require('path')
const { promisify } = require('util')
const app = '/opt/rehab-app/server', envFile = app + '/.env'
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
function config(text) { return Object.fromEntries(text.split(/\r?\n/).map(line => line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])) }
function privateFile(file) {
  assert.match(file, /^\/root\/rehab-code-release-[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+$/)
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o077, 0)
  return file
}
async function connection() { const mysql = require(app + '/node_modules/mysql2/promise'); return mysql.createConnection({ user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: config(fs.readFileSync(envFile, 'utf8')).DB_NAME }) }
function desired(file) {
  const value = JSON.parse(fs.readFileSync(privateFile(file), 'utf8'))
  assert.match(value.username, /^1[3-9]\d{9}$/)
  assert.ok(typeof value.password === 'string' && /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(value.password) && !/[\r\n]/.test(value.password))
  return value
}
const replace = (text, key, value) => { const re = new RegExp('^' + key + '\\s*=.*$', 'm'); return re.test(text) ? text.replace(re, () => key + '=' + value) : text.trimEnd() + '\n' + key + '=' + value + '\n' }
;(async () => {
  const [mode, backup] = process.argv.slice(2)
  const audit = privateFile(backup + '/login-before.json'), input = desired(backup + '/login-change.json')
  const db = await connection()
  try {
    const [users] = await db.query('SELECT * FROM system_users ORDER BY id')
    if (mode === 'snapshot') {
      const env = fs.readFileSync(envFile, 'utf8'), oldPhone = config(env).TEST_LOGIN_PHONE || '13800138000'
      const account = users.find(row => row.username === oldPhone)
      assert.ok(account, 'Configured account must exist before release')
      assert.ok(!users.some(row => row.username === input.username && row.id !== account.id), 'Requested phone belongs to another account; refusing to overwrite it')
      fs.writeFileSync(audit, JSON.stringify({ env, users, id: account.id }), { flag: 'wx', mode: 0o600 })
      console.log('PASS: shared login account identified, target collision excluded, original ID/config privately backed up')
    } else if (mode === 'verify') {
      const saved = JSON.parse(fs.readFileSync(audit, 'utf8'))
      assert.equal(users.length, saved.users.length, 'Account count changed')
      const normalized = JSON.parse(JSON.stringify(users)), original = saved.users.find(row => row.id === saved.id)
      const changed = normalized.find(row => row.id === saved.id)
      assert.ok(changed, 'Original user ID must be retained'); assert.equal(changed.username, input.username)
      const [algorithm, salt, digest] = changed.password_hash.split('$')
      assert.equal(algorithm, 'scrypt')
      assert.equal((await promisify(crypto.scrypt)(input.password, salt, 64)).toString('hex'), digest, 'Configured password mismatch')
      changed.username = original.username; changed.password_hash = original.password_hash
      assert.deepEqual(normalized, saved.users, 'Only the selected username/password may change')
      const expected = replace(replace(saved.env, 'TEST_LOGIN_PHONE', input.username), 'TEST_LOGIN_PASSWORD', input.password)
      assert.equal(fs.readFileSync(envFile, 'utf8'), expected, 'Only the two login settings may change')
      const baseline = JSON.parse(fs.readFileSync(privateFile(backup + '/preserved-data.json'), 'utf8'))
      baseline.env = hash(Buffer.from(expected)); baseline.tables.system_users.hash = hash(JSON.stringify(users))
      fs.writeFileSync(privateFile(backup + '/preserved-data-after-login.json'), JSON.stringify(baseline), { flag: 'wx', mode: 0o600 })
      console.log('PASS: only requested shared login changed; user IDs, other accounts and every unrelated environment setting preserved')
    } else if (mode === 'rollback') {
      const saved = JSON.parse(fs.readFileSync(audit, 'utf8')), original = saved.users.find(row => row.id === saved.id)
      await db.execute('UPDATE system_users SET username = ?, password_hash = ? WHERE id = ?', [original.username, original.password_hash, saved.id])
      fs.writeFileSync(envFile, saved.env)
      console.log('Original shared login and environment restored; other accounts and business data retained')
    } else throw Error('Unknown account release mode')
  } finally { await db.end() }
})().catch(error => { console.error('Account release audit failed:', error.code || error.message); process.exitCode = 1 })
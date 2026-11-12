// Narrow production repair: only DELETE on the reservation table. Never delete real data.
const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const assert = require('assert/strict')
const app = '/opt/rehab-app/server'
const mysql = require(app + '/node_modules/mysql2/promise')
const config = {}
for (const line of fs.readFileSync(app + '/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
  if (m) config[m[1]] = m[2]
}
async function connectApp() {
  return mysql.createConnection({host: config.DB_HOST || '127.0.0.1', port: Number(config.DB_PORT || 3306), user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME})
}
function request(id, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: Number(config.PORT || 3000), method: 'DELETE', path: '/api/bed-reservations/' + id, headers: token ? {authorization: 'Bearer ' + token} : {}}, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({status: res.statusCode, body}))
    })
    req.setTimeout(10000, () => req.destroy(Error('Timeout'))); req.on('error', reject); req.end()
  })
}
;(async () => {
  assert.ok(['inspect', 'apply'].includes(process.argv[2]), 'Use inspect or apply')
  const db = await mysql.createConnection({user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: config.DB_NAME})
  let connection
  try {
    connection = await connectApp()
    const [[account]] = await connection.query('SELECT CURRENT_USER() AS account')
    const split = account.account.lastIndexOf('@')
    assert.ok(split > 0 && config.DB_USER !== 'root', 'Refuse root or invalid application account')
    const user = account.account.slice(0, split), host = account.account.slice(split + 1)
    let denied = false
    try { const [result] = await connection.execute('DELETE FROM bed_reservations WHERE 1 = 0'); assert.equal(result.affectedRows, 0) }
    catch (error) { if (error.code !== 'ER_TABLEACCESS_DENIED_ERROR') throw error; denied = true }
    console.log('Application reservation DELETE permission: ' + (denied ? 'MISSING' : 'OK'))
    if (process.argv[2] === 'inspect') return
    if (denied) {
      const dir = '/root/rehab-permission-fix-' + new Date().toISOString().replace(/[:.]/g, '-')
      fs.mkdirSync(dir, {mode: 0o700})
      const [grants] = await db.query('SHOW GRANTS FOR ' + mysql.escape(user) + '@' + mysql.escape(host))
      fs.writeFileSync(dir + '/previous-grants.json', JSON.stringify(grants), {mode: 0o600})
      const target = mysql.escapeId(config.DB_NAME) + '.bed_reservations TO ' + mysql.escape(user) + '@' + mysql.escape(host)
      fs.writeFileSync(dir + '/rollback.sql', 'REVOKE DELETE ON ' + target.replace(' TO ', ' FROM ') + ';\n', {mode: 0o600})
      await db.query('GRANT DELETE ON ' + target)
      console.log('Granted DELETE on reservation table only; private grant backup: ' + dir)
    }
    await connection.end(); connection = await connectApp()
    const [probe] = await connection.execute('DELETE FROM bed_reservations WHERE 1 = 0')
    assert.equal(probe.affectedRows, 0)
    // Exercise the real HTTP handler with a verified absent, non-allocatable ID.
    const sentinel = Number.MAX_SAFE_INTEGER
    const [[state]] = await db.query('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS maxId FROM bed_reservations')
    const [[table]] = await db.query('SELECT AUTO_INCREMENT AS nextId FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [config.DB_NAME, 'bed_reservations'])
    assert.ok(Number(state.maxId) < sentinel - 1000000 && Number(table.nextId || 0) < sentinel - 1000000, 'Sentinel must be outside allocated business range')
    const [[existing]] = await db.query('SELECT COUNT(*) AS n FROM bed_reservations WHERE id = ?', [sentinel]); assert.equal(Number(existing.n), 0)
    const [[userRow]] = await db.query('SELECT id FROM system_users ORDER BY id LIMIT 1'); assert.ok(userRow)
    const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url')
    const payload = Buffer.from(JSON.stringify({sub: userRow.id, exp: Math.floor(Date.now()/1000) + 60})).toString('base64url')
    const token = header + '.' + payload + '.' + crypto.createHmac('sha256', config.JWT_SECRET).update(header + '.' + payload).digest('base64url')
    assert.equal((await request(sentinel)).status, 401)
    for (let i = 0; i < 2; i++) { const result = await request(sentinel, token); assert.equal(result.status, 200, 'Real DELETE handler must succeed'); assert.equal(JSON.parse(result.body).deleted, true) }
    console.log('PASS: live application account DELETE permission, HTTP deletion of absent ID and idempotent retry, anonymous access rejected; no real appointment deleted')
  } finally { if (connection) await connection.end(); await db.end() }
})().catch(error => { console.error('Permission check failed:', error.code || error.message); process.exitCode = 1 })

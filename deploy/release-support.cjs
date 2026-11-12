// Root-only release helper. Outputs metadata only, never patient contents or secrets.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert/strict')
const app = '/opt/rehab-app/server'
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const envFile = app + '/.env'
const contents = () => fs.readFileSync(envFile, 'utf8')
function config() {
  const result = {}
  for (const line of contents().split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (match) result[match[1]] = match[2]
  }
  return result
}
async function database() {
  const mysql = require(app + '/node_modules/mysql2/promise')
  return mysql.createConnection({ user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: config().DB_NAME })
}
function privateTarget(target) {
  assert.match(target, /^\/root\/rehab-code-release-[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+$/)
  assert.equal(fs.statSync(path.dirname(target)).mode & 0o077, 0, 'Private backup directory required')
  return target
}
function fileInventory(directory) {
  const result = {}
  function visit(current) {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) visit(file)
      else { assert.ok(entry.isFile(), 'No symlink allowed in preserved files'); result[path.relative(directory, file)] = hash(fs.readFileSync(file)) }
    }
  }
  visit(directory)
  return result
}
const tables = ['system_users', 'discharge_records', 'discharge_record_shares', 'discharge_record_flows', 'hospitalization_number_registry', 'bed_reservations']
async function ensureKey(backup) {
  privateTarget(backup + '/environment-after-key.env')
  const before = contents(), env = config()
  const accountDb = await database()
  try {
    const [existing] = await accountDb.execute('SELECT id FROM system_users WHERE username = ?', [env.TEST_LOGIN_PHONE || '13800138000'])
    assert.equal(existing.length, 1, 'Configured login account must already exist; do not create users during release')
  } finally { await accountDb.end() }
  if (env.RESERVATION_ID_KEY) {
    assert.match(env.RESERVATION_ID_KEY, /^[a-f0-9]{64}$/i, 'Existing reservation key is invalid; do not overwrite')
  } else {
    assert.ok((before.match(/^\s*RESERVATION_ID_KEY\s*=/gm) || []).length <= 1, 'Ambiguous reservation key configuration')
    const db = await database()
    try {
      const [found] = await db.query("SHOW TABLES LIKE 'bed_reservations'")
      if (found.length) {
        const [columns] = await db.query("SHOW COLUMNS FROM bed_reservations LIKE 'id_card_encrypted'")
        if (columns.length) assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM bed_reservations WHERE id_card_encrypted IS NOT NULL'))[0][0].n), 0, 'Encrypted identities exist: recover their key instead of generating a new one')
      }
    } finally { await db.end() }
    const line = 'RESERVATION_ID_KEY=' + crypto.randomBytes(32).toString('hex')
    const after = /^\s*RESERVATION_ID_KEY\s*=/m.test(before)
      ? before.replace(/^[ \t]*RESERVATION_ID_KEY[ \t]*=.*$/m, line)
      : before + (before.endsWith('\n') ? '' : '\n') + line + '\n'
    const withoutKey = value => value.split(/\r?\n/).filter(item => !/^[ \t]*RESERVATION_ID_KEY[ \t]*=/.test(item)).join('\n').trimEnd()
    assert.equal(withoutKey(before), withoutKey(after), 'Only reservation key may be added')
    fs.writeFileSync(envFile, after) // Keeps existing owner and access mode.
    console.log('Generated an independent reservation key on this server; value not displayed')
  }
  fs.copyFileSync(envFile, backup + '/environment-after-key.env', fs.constants.COPYFILE_EXCL)
  fs.chmodSync(backup + '/environment-after-key.env', 0o600)
  console.log('Reservation key validated and privately backed up')
}
async function snapshot(target) {
  privateTarget(target)
  const db = await database()
  const result = { tables: {}, reports: fileInventory(app + '/storage/reports'), documents: fileInventory(app + '/documents'), env: hash(fs.readFileSync(envFile)), proxy: hash(fs.readFileSync('/etc/caddy/Caddyfile')) }
  try {
    for (const table of tables) {
      const [found] = await db.query('SHOW TABLES LIKE ?', [table])
      if (!found.length) { result.tables[table] = null; continue }
      const [columns] = await db.query('SHOW COLUMNS FROM ' + table)
      const fields = columns.map(column => column.Field)
      for (const field of fields) assert.match(field, /^[a-zA-Z0-9_]+$/)
      const order = table === 'hospitalization_number_registry' ? 'hospitalization_number' : table === 'discharge_record_flows' ? 'record_id' : 'id'
      const [rows] = await db.query('SELECT ' + fields.map(field => '`' + field + '`').join(',') + ' FROM ' + table + ' ORDER BY ' + order)
      result.tables[table] = { fields, order, count: rows.length, hash: hash(JSON.stringify(rows)) }
    }
    fs.writeFileSync(target, JSON.stringify(result), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ snapshot: true, counts: Object.fromEntries(Object.entries(result.tables).map(([table, value]) => [table, value && value.count])) }))
  } finally { await db.end() }
}
async function verify(target) {
  privateTarget(target)
  const saved = JSON.parse(fs.readFileSync(target, 'utf8')), db = await database()
  try {
    for (const [table, before] of Object.entries(saved.tables)) {
      if (!before) {
        const [found] = await db.query('SHOW TABLES LIKE ?', [table])
        if (found.length) assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM ' + table))[0][0].n), 0, 'New table must start empty')
        continue
      }
      const [rows] = await db.query('SELECT ' + before.fields.map(field => '`' + field + '`').join(',') + ' FROM ' + table + ' ORDER BY ' + before.order)
      assert.equal(rows.length, before.count, table + ': count changed')
      assert.equal(hash(JSON.stringify(rows)), before.hash, table + ': business data changed')
    }
    assert.deepEqual(fileInventory(app + '/storage/reports'), saved.reports, 'Reports changed')
    assert.deepEqual(fileInventory(app + '/documents'), saved.documents, 'Fixed documents changed')
    assert.equal(hash(fs.readFileSync(envFile)), saved.env, 'Environment changed unexpectedly')
    assert.equal(hash(fs.readFileSync('/etc/caddy/Caddyfile')), saved.proxy, 'Proxy configuration changed')
    console.log('PRESERVED: all existing users, business rows, reports, fixed documents, environment and proxy configuration')
  } finally { await db.end() }
}
async function migrate() {
  const db = await database()
  try {
    await require(app + '/bed-reservations').initializeReservationTable(db)
    console.log('Reservation schema created/upgraded without clearing existing records')
  } finally { await db.end() }
}
;(async () => {
  const [mode, target] = process.argv.slice(2)
  if (mode === 'ensure-key') await ensureKey(target)
  else if (mode === 'snapshot') await snapshot(target)
  else if (mode === 'verify') await verify(target)
  else if (mode === 'migrate') await migrate()
  else throw Error('Unknown release helper mode')
})().catch(error => { console.error('Release helper failed:', error.code || error.name); process.exitCode = 1 })

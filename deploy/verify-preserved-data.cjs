// Snapshot or compare business data without logging patient contents or secrets.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const assert = require('assert/strict')
const mysql = require('/opt/rehab-app/server/node_modules/mysql2/promise')
const root = '/opt/rehab-app/server'
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const env = {}
for (const line of fs.readFileSync(root + '/.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match) env[match[1]] = match[2]
}
;(async () => {
  const [mode, file] = process.argv.slice(2)
  assert.ok(['snapshot', 'verify'].includes(mode) && file)
  const db = await mysql.createConnection({ user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: env.DB_NAME })
  const result = { tables: {}, files: {}, env: hash(fs.readFileSync(root + '/.env')), proxy: hash(fs.readFileSync('/etc/caddy/Caddyfile')) }
  try {
    const tables = ['system_users', 'discharge_records', 'discharge_record_shares', 'discharge_record_flows', 'hospitalization_number_registry']
    const [reservationTable] = await db.query("SHOW TABLES LIKE 'bed_reservations'")
    if (reservationTable.length) tables.push('bed_reservations')
    for (const table of tables) {
      const order = table === 'hospitalization_number_registry' ? 'hospitalization_number' : table === 'discharge_record_flows' ? 'record_id' : 'id'
      const [rows] = await db.query(`SELECT * FROM ${table} ORDER BY ${order}`)
      result.tables[table] = { count: rows.length, hash: hash(JSON.stringify(rows)) }
    }
    const storage = root + '/storage/reports'
    for (const name of fs.readdirSync(storage).sort()) {
      const target = path.join(storage, name)
      assert.ok(fs.lstatSync(target).isFile(), 'Unexpected entry in report storage')
      result.files[name] = hash(fs.readFileSync(target))
    }
    if (mode === 'snapshot') fs.writeFileSync(file, JSON.stringify(result), { mode: 0o600, flag: 'wx' })
    else assert.deepEqual(result, JSON.parse(fs.readFileSync(file, 'utf8')), 'Business data/config changed during release')
    console.log(JSON.stringify({ mode, counts: Object.fromEntries(Object.entries(result.tables).map(([key, value]) => [key, value.count])), reportFiles: Object.keys(result.files).length, preserved: mode === 'verify' }))
  } finally { await db.end() }
})().catch(error => { console.error(error.message); process.exitCode = 1 })

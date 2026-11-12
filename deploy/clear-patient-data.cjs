// Run on the deployment host with explicit --clear-all, while rehab-web is stopped.
const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const mysql = require('/opt/rehab-app/server/node_modules/mysql2/promise')
const root = '/opt/rehab-app/server'
const env = {}
for (const line of fs.readFileSync(root + '/.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match) env[match[1]] = match[2]
}
;(async () => {
  assert.ok(process.argv.includes('--clear-all'), 'Explicit --clear-all required')
  assert.equal(spawnSync('systemctl', ['is-active', 'rehab-web'], { encoding: 'utf8' }).stdout.trim(), 'inactive', 'Stop rehab-web before clearing records')
  const db = await mysql.createConnection({ user: 'root', socketPath: '/run/mysqld/mysqld.sock', database: env.DB_NAME })
  const tables = ['discharge_record_flows', 'discharge_record_shares', 'discharge_records', 'hospitalization_number_registry']
  const before = {}, after = {}
  const usersBefore = (await db.query('SELECT * FROM system_users ORDER BY id'))[0]
  const userFingerprint = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  try {
    const existing = (await db.query('SHOW TABLES'))[0].map(row => Object.values(row)[0])
    assert.deepEqual(existing.filter(name => name !== 'system_users').sort(), tables.slice().sort(), 'Unexpected business tables; inspect before clearing')
    const storage = path.join(root, 'storage/reports')
    assert.equal(fs.realpathSync(storage), storage)
    const reportFiles = fs.readdirSync(storage, { withFileTypes: true })
    assert.ok(reportFiles.every(entry => entry.isFile()), 'Unexpected directory or symlink in report storage')
    const cache = path.join(root, 'storage/image-cache')
    function verifyCache(directory) {
      assert.equal(fs.realpathSync(directory), directory)
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        assert.ok(entry.isFile() || entry.isDirectory(), 'Unexpected symlink in image cache')
        if (entry.isDirectory()) verifyCache(path.join(directory, entry.name))
      }
    }
    if (fs.existsSync(cache)) verifyCache(cache)
    await db.beginTransaction()
    for (const table of tables.filter(name => existing.includes(name))) {
      before[table] = Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n)
      await db.query(`DELETE FROM ${table}`)
    }
    assert.equal(userFingerprint((await db.query('SELECT * FROM system_users ORDER BY id'))[0]), userFingerprint(usersBefore))
    await db.commit()
    let deletedFiles = 0
    for (const entry of fs.readdirSync(storage, { withFileTypes: true })) {
      assert.ok(entry.isFile(), 'Unexpected directory or symlink in report storage')
      fs.unlinkSync(path.join(storage, entry.name))
      deletedFiles++
    }
    const deletedImageCaches = fs.existsSync(cache) ? fs.readdirSync(cache).length : 0
    if (fs.existsSync(cache)) fs.rmSync(cache, { recursive: true })
    for (const table of tables.filter(name => existing.includes(name))) {
      after[table] = Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n)
      assert.equal(after[table], 0)
    }
    assert.equal(userFingerprint((await db.query('SELECT * FROM system_users ORDER BY id'))[0]), userFingerprint(usersBefore))
    console.log(JSON.stringify({ before, after, deletedFiles, deletedImageCaches, retainedUsers: usersBefore.length, usersUnchanged: true }))
  } catch (error) { await db.rollback(); throw error }
  finally { await db.end() }
})().catch(error => { console.error(error.message); process.exitCode = 1 })

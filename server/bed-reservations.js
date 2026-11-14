const crypto = require('crypto')
const { getReservationFieldErrors, normalizeIdCard, beijingDate, normalizeReservationCare, isValidMobile, isValidIdCard } = require('./reservation-validation')
const { encryptIdCard, decryptIdCard, fingerprintIdCard } = require('./reservation-identity')

const { createReservationCaptcha } = require('./reservation-captcha')

const DAY_MS = 86400000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function nextReservationDate(now = new Date()) {
  return beijingDate(new Date(now.getTime() + DAY_MS))
}
function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}
function validateReservation(body) {
  const source = body && body.form || {}
  const errors = getReservationFieldErrors(source)
  if (Object.keys(errors).length) throw fail(Object.values(errors)[0])
  const text = key => source[key].trim()
  const form = { name: text('name'), gender: text('gender'), age: Number(text('age')), phone: text('phone'), idCard: normalizeIdCard(source.idCard), diagnosis: text('diagnosis'), reservationDate: typeof source.reservationDate === 'string' ? text('reservationDate') : '', specialNeeds: typeof source.specialNeeds === 'string' ? text('specialNeeds') : '', repeatReservation: source.repeatReservation === undefined ? '否' : source.repeatReservation, ...normalizeReservationCare(source) }
  if (!body || !UUID.test(body.requestId || '')) throw fail('预约请求标识无效，请刷新页面后重试')
  return { form, requestId: body.requestId.toLowerCase() }
}
function reservationFormVariants(form) {
  const { doctor, tubeTypes, otherTube, ...oldForm } = form
  const versions = [form]
  // Empty new optional fields remain compatible with previously submitted receipts.
  if (!doctor && !tubeTypes.length && !otherTube) versions.push(oldForm)
  if (form.repeatReservation === '否') {
    for (const version of versions.slice()) { const { repeatReservation, ...legacy } = version; versions.push(legacy) }
  }
  return versions
}
async function initializeReservationTable(pool) {
  await pool.query(    'CREATE TABLE IF NOT EXISTS bed_reservations (' +
    'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,' +
    'request_id CHAR(36) NOT NULL, payload_hash CHAR(64) NOT NULL,' +
    'name VARCHAR(50) NOT NULL, gender VARCHAR(1) NOT NULL, age TINYINT UNSIGNED NOT NULL,' +
    'reservation_date CHAR(10) NULL, special_needs VARCHAR(500) NULL, repeat_reservation TINYINT UNSIGNED NULL,' +
    'rebooked_from_id BIGINT UNSIGNED NULL, rebooked_by_user_id BIGINT UNSIGNED NULL,' +
    'doctor VARCHAR(20) NULL, tube_types TEXT NULL, other_tube VARCHAR(100) NULL,' +
    'staff_note TEXT NULL, staff_note_version INT UNSIGNED NOT NULL DEFAULT 0, staff_note_updated_at_ms BIGINT UNSIGNED NULL, staff_note_updated_by_user_id BIGINT UNSIGNED NULL,' +
    'cancelled_at_ms BIGINT UNSIGNED NULL, cancelled_by_user_id BIGINT UNSIGNED NULL,' +
    'id_card_encrypted VARCHAR(160) NULL,' +
    'identity_fingerprint VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,' +
    'pending_identity_fingerprint VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL THEN RTRIM(identity_fingerprint) ELSE NULL END) STORED,' +
    'phone VARCHAR(30) NOT NULL, diagnosis VARCHAR(500) NOT NULL,' +
    'created_at_ms BIGINT UNSIGNED NOT NULL, confirmed_at_ms BIGINT UNSIGNED NULL,' +
    'confirmed_by_user_id BIGINT UNSIGNED NULL,' +
    'UNIQUE KEY uq_bed_reservations_request (request_id),' +
    'UNIQUE KEY uq_bed_reservations_pending_identity (pending_identity_fingerprint),' +
    'KEY idx_bed_reservations_phone (phone),' +
    'KEY idx_bed_reservations_reminder (reservation_date, cancelled_at_ms)' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4')
  const [columns] = await pool.query("SHOW COLUMNS FROM bed_reservations LIKE 'id_card_encrypted'")
  if (!columns.length) {
    try { await pool.query('ALTER TABLE bed_reservations ADD COLUMN id_card_encrypted VARCHAR(160) NULL AFTER phone') }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  }
  // Old rows remain nullable: do not delete/merge old appointments or fabricate identities.
  for (const [name, definition] of [
    ['staff_note', 'TEXT NULL'], ['staff_note_version', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['staff_note_updated_at_ms', 'BIGINT UNSIGNED NULL'], ['staff_note_updated_by_user_id', 'BIGINT UNSIGNED NULL'],
    ['reservation_date', 'CHAR(10) NULL'],
    ['repeat_reservation', 'TINYINT UNSIGNED NULL'],
    ['doctor', 'VARCHAR(20) NULL'], ['tube_types', 'TEXT NULL'], ['other_tube', 'VARCHAR(100) NULL'],
    ['rebooked_from_id', 'BIGINT UNSIGNED NULL'],
    ['rebooked_by_user_id', 'BIGINT UNSIGNED NULL'],
    ['special_needs', 'VARCHAR(500) NULL'],
    ['cancelled_at_ms', 'BIGINT UNSIGNED NULL'],
    ['cancelled_by_user_id', 'BIGINT UNSIGNED NULL'],
    ['identity_fingerprint', 'VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL'],
    ['pending_identity_fingerprint', 'VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL THEN RTRIM(identity_fingerprint) ELSE NULL END) STORED']
  ]) {
    const [found] = await pool.query('SHOW COLUMNS FROM bed_reservations LIKE ?', [name])
    if (!found.length) {
      try { await pool.query('ALTER TABLE bed_reservations ADD COLUMN ' + name + ' ' + definition) }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
    }
  }
  // Rebuild the old generated expression in one ALTER; retain the unique index.
  const [generated] = await pool.query("SELECT GENERATION_EXPRESSION AS expression FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bed_reservations' AND COLUMN_NAME = 'pending_identity_fingerprint'")
  if (!String(generated[0].expression).toLowerCase().includes('cancelled_at_ms')) {
    await pool.query('ALTER TABLE bed_reservations MODIFY COLUMN pending_identity_fingerprint VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL THEN RTRIM(identity_fingerprint) ELSE NULL END) STORED')
  }
  const [reminderIndex] = await pool.query("SHOW INDEX FROM bed_reservations WHERE Key_name = 'idx_bed_reservations_reminder'")
  if (!reminderIndex.length) {
    try { await pool.query('ALTER TABLE bed_reservations ADD KEY idx_bed_reservations_reminder (reservation_date, cancelled_at_ms)') }
    catch (error) { if (error.code !== 'ER_DUP_KEYNAME') throw error }
  }
  const [indexes] = await pool.query("SHOW INDEX FROM bed_reservations WHERE Key_name = 'uq_bed_reservations_pending_identity'")
  if (!indexes.length) {
    try { await pool.query('ALTER TABLE bed_reservations ADD UNIQUE KEY uq_bed_reservations_pending_identity (pending_identity_fingerprint)') }
    catch (error) { if (error.code !== 'ER_DUP_KEYNAME') throw error }
  }
}
function pendingConflict() {
  return Object.assign(fail('您已有预约中的记录，请勿重复预约', 409), { code: 'RESERVATION_ALREADY_PENDING' })
}
async function hasPendingReservation(pool, form, fingerprint) {
  const [matches] = await pool.execute('SELECT id FROM bed_reservations WHERE pending_identity_fingerprint = ? LIMIT 1', [fingerprint])
  if (matches.length) return true
  // Before this upgrade identity ciphertext used random IVs, so equality cannot be
  // checked against ciphertext. Only still-pending legacy rows need this fallback.
  const [legacy] = await pool.execute('SELECT request_id, id_card_encrypted, name, phone FROM bed_reservations WHERE confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL AND identity_fingerprint IS NULL')
  return legacy.some(row => row.id_card_encrypted
    ? normalizeIdCard(decryptIdCard(row.id_card_encrypted, row.request_id)) === form.idCard
    : row.name.trim() === form.name && row.phone.trim() === form.phone)
}
function savedTubeTypes(value) {
  try { const list = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [] } catch (_) { return [] }
}
function mapReservation(row, detail = false) {
  const createdMs = Number(row.created_at_ms)
  const confirmedMs = row.confirmed_at_ms == null ? null : Number(row.confirmed_at_ms)
  return {
    id: row.id, name: row.name, gender: row.gender, age: row.age, phone: row.phone,
    staffNote: row.staff_note || '', staffNoteVersion: Number(row.staff_note_version || 0),
    staffNoteUpdatedAt: row.staff_note_updated_at_ms == null ? null : new Date(Number(row.staff_note_updated_at_ms)).toISOString(),
    createdAt: new Date(createdMs).toISOString(),
    reservationDate: row.reservation_date || null,
    repeatReservation: row.repeat_reservation == null ? null : Number(row.repeat_reservation) === 1 ? '是' : '否',
    status: row.cancelled_at_ms != null ? '取消预约' : confirmedMs == null ? '预约中' : '预约成功',
    cancelledAt: row.cancelled_at_ms == null ? null : new Date(Number(row.cancelled_at_ms)).toISOString(),
    confirmedAt: confirmedMs == null ? null : new Date(confirmedMs).toISOString(),
    waitingDays: confirmedMs == null || row.cancelled_at_ms != null ? null : Math.max(0, confirmedMs - createdMs) / DAY_MS,
    ...(detail ? { doctor: row.doctor || '', tubeTypes: savedTubeTypes(row.tube_types), otherTube: row.other_tube || '', diagnosis: row.diagnosis, specialNeeds: row.special_needs || '', idCard: decryptIdCard(row.id_card_encrypted, row.request_id) } : {})
  }
}
function validId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw fail('预约编号无效')
  return Number(value)
}
function createSubmissionLimiter() {
  const windows = new Map()
  return (req, res, next) => {
    const now = Date.now()
    for (const [key, entry] of windows) if (entry.until <= now) windows.delete(key)
    const key = req.ip
    let entry = windows.get(key)
    if (!entry) {
      if (windows.size >= 10000) return res.status(429).json({ message: '预约繁忙，请稍后重试' })
      entry = { count: 0, until: now + 15 * 60 * 1000 }
      windows.set(key, entry)
    }
    if (++entry.count > 30) {
      res.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000)))
      return res.status(429).json({ message: '提交过于频繁，请稍后重试' })
    }
    next()
  }
}
function registerReservationRoutes(app, { getPool, requireAuth, captcha = createReservationCaptcha() }) {
  const handle = fn => async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    try { await fn(req, res) } catch (error) {
      if (error.statusCode) {
        if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter))
        return res.status(error.statusCode).json({ message: error.message, ...(error.code ? { code: error.code } : {}) })
      }
      // Do not include SQL, patient data or credentials in public error responses/logs.
      console.error('Reservation operation failed:', error.code || 'INTERNAL_ERROR')
      res.status(500).json({ message: '预约服务暂不可用，请稍后重试' })
    }
  }
  app.get('/api/bed-reservations/captcha', handle(async (req, res) => {
    res.json(captcha.issue(req.ip))
  }))
  // Patient lookup requires an exact phone/identity match plus a fresh captcha.
  // Never include staff notes or encrypted identifiers in this public response.
  app.post('/api/bed-reservations/lookup', handle(async (req, res) => {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
    const idCard = normalizeIdCard(req.body?.idCard)
    if (!isValidMobile(phone) || !isValidIdCard(idCard)) throw fail('请输入正确的预约手机号和身份证号')
    captcha.verify(req.body.captcha, req.ip, 'lookup:' + crypto.randomBytes(24).toString('hex'))
    const pool = getPool(), fingerprint = fingerprintIdCard(idCard)
    const [rows] = await pool.execute('SELECT * FROM bed_reservations WHERE phone = ? AND (identity_fingerprint = ? OR identity_fingerprint IS NULL) ORDER BY id DESC LIMIT 20', [phone, fingerprint])
    const matches = rows.filter(row => row.id_card_encrypted && normalizeIdCard(decryptIdCard(row.id_card_encrypted, row.request_id)) === idCard).slice(0, 10)
    const pending = matches.length ? await hasPendingReservation(pool, { idCard, phone, name: matches[0].name }, fingerprint) : false
    res.json({ pending, items: matches.map(row => {
      const record = mapReservation(row, true)
      return { id: record.id, name: record.name, createdAt: record.createdAt, status: record.status, reservationDate: record.reservationDate, canRebook: !pending,
        form: { name: record.name, gender: record.gender, age: String(record.age), phone, idCard, diagnosis: record.diagnosis,
          doctor: record.doctor === '姚志远' ? '饶志远' : record.doctor, tubeTypes: record.tubeTypes, otherTube: record.otherTube, specialNeeds: record.specialNeeds } }
    }) })
  }))
  // Public creation returns a receipt only; never expose patient data anonymously.
  app.post('/api/bed-reservations', handle(async (req, res) => {
    const { form, requestId } = validateReservation(req.body)
    const hashForm = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
    const hash = hashForm(form)
    const hashes = reservationFormVariants(form).map(hashForm)
    const matchesHash = value => hashes.includes(value)
    const pool = getPool()
    const [existing] = await pool.execute('SELECT payload_hash FROM bed_reservations WHERE request_id = ?', [requestId])
    if (existing.length) {
      if (!matchesHash(existing[0].payload_hash)) throw fail('该请求已提交，请勿修改后重复提交', 409)
      return res.status(201).json({ accepted: true, message: '预约申请已提交，请等待确认' })
    }
    const encryptedId = encryptIdCard(form.idCard, requestId)
    captcha.verify(req.body.captcha, req.ip, requestId + ':' + hash)
    const fingerprint = fingerprintIdCard(form.idCard)
    if (await hasPendingReservation(pool, form, fingerprint)) {
      const [saved] = await pool.execute('SELECT payload_hash FROM bed_reservations WHERE request_id = ?', [requestId])
      if (!saved.length) throw pendingConflict()
      if (!matchesHash(saved[0].payload_hash)) throw fail('该请求已提交，请勿修改后重复提交', 409)
      return res.status(201).json({ accepted: true, message: '预约申请已提交，请等待确认' })
    }
    try {
      await pool.execute('INSERT INTO bed_reservations (request_id, payload_hash, name, gender, age, phone, id_card_encrypted, identity_fingerprint, diagnosis, reservation_date, special_needs, repeat_reservation, doctor, tube_types, other_tube, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [requestId, hash, form.name, form.gender, form.age, form.phone, encryptedId, fingerprint, form.diagnosis, form.reservationDate || null, form.specialNeeds, form.repeatReservation === '是' ? 1 : 0, form.doctor || null, JSON.stringify(form.tubeTypes), form.otherTube || null, Date.now()])
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error
      const [rows] = await pool.execute('SELECT payload_hash FROM bed_reservations WHERE request_id = ?', [requestId])
      if (rows.length) {
        if (!matchesHash(rows[0].payload_hash)) throw fail('该请求已提交，请勿修改后重复提交', 409)
      } else {
        // The database unique key closes races between different request IDs/devices.
        const [pending] = await pool.execute('SELECT id FROM bed_reservations WHERE pending_identity_fingerprint = ? LIMIT 1', [fingerprint])
        if (pending.length) throw pendingConflict()
        throw error
      }
    }
    res.status(201).json({ accepted: true, message: '预约申请已提交，请等待确认' })
  }))
  // The project has no separate staff roles: all existing authenticated accounts share this queue.
  app.get('/api/bed-reservations', requireAuth, handle(async (req, res) => {
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : ''
    if (keyword.length > 100) throw fail('搜索内容过长')
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('分页数量无效')
    const status = req.query.status === undefined ? '' : req.query.status
    if (!['', '预约中', '预约成功', '取消预约'].includes(status)) throw fail('预约状态筛选无效')
    const reminder = req.query.reminder === undefined ? '' : req.query.reminder
    if (!['', 'tomorrow'].includes(reminder)) throw fail('预约提醒筛选无效')
    const reminderDate = nextReservationDate()
    const cursor = req.query.cursor !== undefined && req.query.cursor !== '' ? validId(req.query.cursor) : null
    const clauses = [], values = []
    if (keyword) {
      clauses.push('(LOCATE(?, name) > 0 OR LOCATE(?, phone) > 0)'); values.push(keyword, keyword)
    }
    if (status) clauses.push(status === '取消预约' ? 'cancelled_at_ms IS NOT NULL' : status === '预约中' ? '(confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL)' : '(confirmed_at_ms IS NOT NULL AND cancelled_at_ms IS NULL)')
    if (reminder === 'tomorrow') {
      clauses.push('(reservation_date = ? AND cancelled_at_ms IS NULL)')
      values.push(reminderDate)
    }
    const filterWhere = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
    // Count all matches, not only the current page or the remaining rows after the cursor.
    // Use one read snapshot so confirmation/submission cannot disagree with this page's total.
    const connection = await getPool().getConnection()
    let rows, total
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await connection.beginTransaction()
      const [counts] = await connection.execute('SELECT COUNT(*) AS total FROM bed_reservations' + filterWhere, values)
      total = Number(counts[0].total)
      const pageClauses = cursor === null ? clauses : clauses.concat('id < ?')
      const pageValues = cursor === null ? values : values.concat(cursor)
      const pageWhere = pageClauses.length ? ' WHERE ' + pageClauses.join(' AND ') : ''
      ;[rows] = await connection.execute('SELECT id, name, gender, age, phone, reservation_date, repeat_reservation, created_at_ms, confirmed_at_ms, cancelled_at_ms, staff_note, staff_note_version, staff_note_updated_at_ms FROM bed_reservations' + pageWhere + ' ORDER BY id DESC LIMIT ' + (limit + 1), pageValues)
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map(row => mapReservation(row))
    res.json({ items, total, reminderDate, hasMore, nextCursor: hasMore ? items[items.length - 1].id : null })
  }))
  // Staff-only, aggregate-only in-site reminders. No SMS or external notifications.
  app.get('/api/bed-reservations/reminders', requireAuth, handle(async (req, res) => {
    const date = nextReservationDate()
    const [counts] = await getPool().execute('SELECT COUNT(*) AS total FROM bed_reservations WHERE reservation_date = ? AND cancelled_at_ms IS NULL', [date])
    res.json({ date, total: Number(counts[0].total) })
  }))
  const find = async id => {
    const [rows] = await getPool().execute('SELECT * FROM bed_reservations WHERE id = ?', [id])
    if (!rows.length) throw fail('预约记录不存在', 404)
    return rows[0]
  }
  app.get('/api/bed-reservations/:id', requireAuth, handle(async (req, res) => {
    res.json({ reservation: mapReservation(await find(validId(req.params.id)), true) })
  }))

  app.post('/api/bed-reservations/:id/note', requireAuth, handle(async (req, res) => {
    const id = validId(req.params.id), note = req.body && req.body.note, version = req.body && req.body.version
    if (typeof note !== 'string' || note.length > 1000) throw fail('备注最多1000字')
    if (!Number.isSafeInteger(version) || version < 0 || version >= 4294967295) throw fail('备注版本无效，请刷新后重试')
    const [result] = await getPool().execute('UPDATE bed_reservations SET staff_note = ?, staff_note_version = staff_note_version + 1, staff_note_updated_at_ms = ?, staff_note_updated_by_user_id = ? WHERE id = ? AND staff_note_version = ?', [note.trim(), Date.now(), req.auth.sub, id, version])
    if (!result.affectedRows) {
      await find(id)
      throw Object.assign(fail('备注已被其他护士修改，请先加载最新备注后重新编辑', 409), { code: 'NOTE_VERSION_CONFLICT' })
    }
    res.json({ reservation: mapReservation(await find(id)) })
  }))

  // Authenticated queue actions only. Preserve source history when creating a new booking.
  app.post('/api/bed-reservations/:id/rebook', requireAuth, handle(async (req, res) => {
    const id = validId(req.params.id)
    if (!req.body || typeof req.body.requestId !== 'string' || !UUID.test(req.body.requestId)) throw fail('预约请求标识无效，请重试')
    const requestId = req.body.requestId.toLowerCase()
    const connection = await getPool().getConnection()
    let reservation
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await connection.beginTransaction()
      // Serializes rebooking against confirmation, cancellation and deleting this source.
      const [sources] = await connection.execute('SELECT * FROM bed_reservations WHERE id = ? FOR UPDATE', [id])
      if (!sources.length) throw fail('预约记录不存在', 404)
      const source = mapReservation(sources[0], true)
      if (!source.idCard) throw fail('原预约缺少身份证号，请让患者重新填写完整预约信息')
      const { form } = validateReservation({ requestId, form: {
        name: source.name, gender: source.gender, age: String(source.age), phone: source.phone,
        idCard: source.idCard, diagnosis: source.diagnosis, specialNeeds: source.specialNeeds,
        doctor: source.doctor, tubeTypes: source.tubeTypes, otherTube: source.otherTube,
        reservationDate: req.body.reservationDate, repeatReservation: '是'
      } })
      const hashes = reservationFormVariants(form).map(value => crypto.createHash('sha256').update(JSON.stringify({ action: 'staff-rebook', sourceId: id, userId: req.auth.sub, form: value })).digest('hex'))
      const hash = hashes[0]
      const [existing] = await connection.execute('SELECT * FROM bed_reservations WHERE request_id = ?', [requestId])
      if (existing.length) {
        if (!hashes.includes(existing[0].payload_hash)) throw fail('该请求已提交，请勿修改后重复提交', 409)
        reservation = mapReservation(existing[0], true)
      } else {
        if (source.status === '预约中') throw pendingConflict()
        const fingerprint = fingerprintIdCard(form.idCard)
        if (await hasPendingReservation(connection, form, fingerprint)) throw pendingConflict()
        try {
          const [result] = await connection.execute('INSERT INTO bed_reservations (request_id, payload_hash, name, gender, age, phone, id_card_encrypted, identity_fingerprint, diagnosis, reservation_date, special_needs, repeat_reservation, rebooked_from_id, rebooked_by_user_id, doctor, tube_types, other_tube, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
            [requestId, hash, form.name, form.gender, form.age, form.phone, encryptIdCard(form.idCard, requestId), fingerprint, form.diagnosis, form.reservationDate || null, form.specialNeeds, id, req.auth.sub, form.doctor || null, JSON.stringify(form.tubeTypes), form.otherTube || null, Date.now()])
          const [rows] = await connection.execute('SELECT * FROM bed_reservations WHERE id = ?', [result.insertId])
          reservation = mapReservation(rows[0], true)
        } catch (error) {
          if (error.code !== 'ER_DUP_ENTRY') throw error
          const [saved] = await connection.execute('SELECT * FROM bed_reservations WHERE request_id = ?', [requestId])
          if (saved.length) {
            if (!hashes.includes(saved[0].payload_hash)) throw fail('该请求已提交，请勿修改后重复提交', 409)
            reservation = mapReservation(saved[0], true)
          } else throw pendingConflict()
        }
      }
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
    res.status(201).json({ reservation })
  }))
  app.delete('/api/bed-reservations/:id', requireAuth, handle(async (req, res) => {
    const id = validId(req.params.id)
    // Only this appointment is removed, never patient discharge records or other bookings.
    // Idempotent on retries; the generated pending-identity index is released automatically.
    await getPool().execute('DELETE FROM bed_reservations WHERE id = ?', [id])
    res.json({ deleted: true })
  }))
  app.post('/api/bed-reservations/:id/confirm', requireAuth, handle(async (req, res) => {
    const id = validId(req.params.id)
    // Fail before changing status if the stored identity cannot be decrypted.
    const before = mapReservation(await find(id), true)
    if (before.status === '取消预约') throw fail('该预约已取消，不能确认', 409)
    // Atomic compare-and-set: retries/concurrent clicks must never overwrite the first confirmation.
    await getPool().execute('UPDATE bed_reservations SET confirmed_at_ms = GREATEST(created_at_ms, ?), confirmed_by_user_id = ? WHERE id = ? AND confirmed_at_ms IS NULL AND cancelled_at_ms IS NULL', [Date.now(), req.auth.sub, id])
    const reservation = mapReservation(await find(id), true)
    if (reservation.status === '取消预约') throw fail('该预约已取消，不能确认', 409)
    res.json({ reservation })
  }))
  app.post('/api/bed-reservations/:id/cancel', requireAuth, handle(async (req, res) => {
    const id = validId(req.params.id)
    mapReservation(await find(id), true)
    // Cancel either active state; retries preserve the first cancellation and audit.
    await getPool().execute('UPDATE bed_reservations SET cancelled_at_ms = GREATEST(created_at_ms, ?), cancelled_by_user_id = ? WHERE id = ? AND cancelled_at_ms IS NULL', [Date.now(), req.auth.sub, id])
    res.json({ reservation: mapReservation(await find(id), true) })
  }))
}
module.exports = { initializeReservationTable, registerReservationRoutes, validateReservation, mapReservation, createSubmissionLimiter, nextReservationDate }

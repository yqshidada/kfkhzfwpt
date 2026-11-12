const express = require('express')
const mysql = require('mysql2/promise')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const QRCode = require('qrcode')
const { initializeFlowTable, registerFlowRoutes } = require('./discharge-flow')
const { createImageStore, registerImageRoutes } = require('./report-images')
const { imageReader } = require('./image-reader')
const { initializeReservationTable, registerReservationRoutes, createSubmissionLimiter } = require('./bed-reservations')

function loadEnvFile() {
	try {
		require('fs').readFileSync(`${__dirname}/.env`, 'utf8').split(/\r?\n/).forEach(line => {
			const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
			if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
		})
	} catch (error) {
		if (error.code !== 'ENOENT') throw error
	}
}

loadEnvFile()

const config = {
	host: process.env.DB_HOST || '127.0.0.1',
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || '',
	database: process.env.DB_NAME || 'rehab_discharge',
	portHttp: Number(process.env.PORT || 3000),
	testLoginPhone: process.env.TEST_LOGIN_PHONE || '13800138000',
	testLoginPassword: process.env.TEST_LOGIN_PASSWORD || 'Test1234',
	tokenSecret: process.env.JWT_SECRET || 'rehab-discharge-local-secret-change-me',
  tokenExpiresInSeconds: Number(process.env.TOKEN_EXPIRES_IN_SECONDS || 43200),
  shareBaseUrl: (process.env.SHARE_BASE_URL || '').replace(/\/+$/, ''),
  shareExpiresInDays: Math.min(Math.max(Number(process.env.SHARE_EXPIRES_IN_DAYS || 30), 1), 365)
}

const reportStorageDir = path.join(__dirname, 'storage', 'reports')

if (!/^[A-Za-z0-9_]+$/.test(config.database)) throw new Error('DB_NAME 只能包含字母、数字和下划线')
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || !process.env.TEST_LOGIN_PASSWORD)) {
	throw new Error('生产环境必须设置独立的 JWT_SECRET（至少32位）及 TEST_LOGIN_PASSWORD')
}

let pool
const PHONE_PATTERN = /^1[3-9]\d{9}$/
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

function base64UrlEncode(value) {
	return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlDecode(value) {
	const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
	return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64').toString('utf8')
}

function signToken(payload) {
	const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
	const body = base64UrlEncode(JSON.stringify(payload))
	const signature = crypto.createHmac('sha256', config.tokenSecret).update(`${header}.${body}`).digest('base64url')
	return `${header}.${body}.${signature}`
}

function verifyToken(token) {
	const parts = String(token || '').split('.')
	if (parts.length !== 3) throw new Error('登录令牌无效')
	const [header, body, signature] = parts
	if (!header || !body || !signature) throw new Error('登录已失效，请重新登录')
	const expected = crypto.createHmac('sha256', config.tokenSecret).update(`${header}.${body}`).digest()
	const actual = Buffer.from(signature, 'base64url')
	if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error('登录令牌无效')
	const payload = JSON.parse(base64UrlDecode(body))
	if (!Number.isFinite(payload.exp) || !payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('登录已过期，请重新登录')
	return payload
}

function hashPassword(password) {
	const salt = crypto.randomBytes(16).toString('hex')
	return new Promise((resolve, reject) => {
		crypto.scrypt(password, salt, 64, (error, derivedKey) => {
			if (error) return reject(error)
			resolve(`scrypt$${salt}$${derivedKey.toString('hex')}`)
		})
	})
}

function verifyPassword(password, storedHash) {
	const [algorithm, salt, hash] = String(storedHash || '').split('$')
	if (algorithm !== 'scrypt' || !salt || !hash) return Promise.resolve(false)
	return new Promise((resolve, reject) => {
		crypto.scrypt(password, salt, 64, (error, derivedKey) => {
			if (error) return reject(error)
			const expected = Buffer.from(hash, 'hex')
			resolve(expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey))
		})
	})
}

function toJson(value) {
	return JSON.stringify(value || [])
}

function fromJson(value, fallback) {
	try {
		return JSON.parse(value)
	} catch (_) {
		return fallback
	}
}

function normalizeString(value, maxLength) {
	return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function validateLoginCredentials(phone, password) {
	if (!PHONE_PATTERN.test(phone)) throw new Error('请输入正确的 11 位手机号')
	if (!PASSWORD_PATTERN.test(password)) throw new Error('密码至少 8 位，且必须包含字母和数字')
}

function normalizeList(value) {
	return Array.isArray(value)
		? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 20)
		: []
}

function validateRecord(body) {
	const source = body && body.form ? body.form : {}
	const form = {
		hospitalizationNumber: normalizeString(source.hospitalizationNumber, 64),
		gender: normalizeString(source.gender, 10),
		age: normalizeString(source.age, 20),
		phone: normalizeString(source.phone, 20),
		diagnosis: normalizeString(source.diagnosis, 100),
		hasDischargeMedication: normalizeString(source.hasDischargeMedication, 2),
		medicationTypes: normalizeList(source.medicationTypes),
		hasTube: normalizeString(source.hasTube, 2),
		tubeTypes: normalizeList(source.tubeTypes),
		skinTypes: normalizeList(source.skinTypes)
	}

	if (!form.hospitalizationNumber || !form.gender || !form.age || !form.diagnosis) throw new Error('患者基本信息不完整')
	if (!/^1[3-9]\d{9}$/.test(form.phone)) throw new Error('联系电话格式不正确')
	if (!['有', '无'].includes(form.hasDischargeMedication)) throw new Error('请选择是否出院带药')
	if (!['有', '无'].includes(form.hasTube)) throw new Error('请选择有无管道')
	if (form.hasDischargeMedication === '有' && !form.medicationTypes.length) throw new Error('请选择药物类型')
	return form
}

function normalizeSnapshot(value) {
	if (!Array.isArray(value)) return []
	return value.slice(0, 30).map(section => ({
		title: normalizeString(section && section.title, 100),
		items: Array.isArray(section && section.items)
			? section.items.slice(0, 100).map(item => typeof item === 'string'
				? item.slice(0, 10000)
				: {
					title: normalizeString(item && item.title, 100),
					content: normalizeString(item && item.content, 30000),
					body: Boolean(item && item.body),
					group: Boolean(item && item.group),
					color: item && item.color === 'red' ? 'red' : '',
					bold: Boolean(item && item.bold)
				})
			: []
	}))
}

function ensureReportStorage() {
	fs.mkdirSync(reportStorageDir, { recursive: true })
}

function createShareToken() {
	return crypto.randomBytes(32).toString('base64url')
}

function hashShareToken(token) {
	return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function getShareBaseUrl(req) {
	return config.shareBaseUrl || `${req.protocol}://${req.get('host')}`
}

function buildShareUrl(req, token) {
	return `${getShareBaseUrl(req)}/share/${encodeURIComponent(token)}`
}

function decodePdfBase64(value) {
	if (typeof value !== 'string') throw new Error('PDF 内容无效')
	const raw = value.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '')
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length < 16) throw new Error('PDF 内容无效')
	const buffer = Buffer.from(raw, 'base64')
	if (buffer.length < 5 || buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('上传内容不是有效 PDF')
	if (buffer.length > 8 * 1024 * 1024) throw new Error('PDF 文件不能超过 8MB')
	return buffer
}

function shareExpiryDate() {
	return new Date(Date.now() + config.shareExpiresInDays * 24 * 60 * 60 * 1000)
}

function formatCreatedAt(value) {
	if (!value) return ''
	const date = value instanceof Date ? value : new Date(value)
	if (Number.isNaN(date.getTime())) return String(value)
	const parts = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date).reduce((result, part) => {
		result[part.type] = part.value
		return result
	}, {})
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

async function initializeDatabase() {
	ensureReportStorage()
	const bootstrap = await mysql.createConnection({
		host: config.host,
		port: config.port,
		user: config.user,
		password: config.password
	})
	await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
	await bootstrap.end()

	pool = mysql.createPool({
		host: config.host,
		port: config.port,
		user: config.user,
		password: config.password,
		database: config.database,
		waitForConnections: true,
		connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
		charset: 'utf8mb4'
	})

	await pool.query(`
		CREATE TABLE IF NOT EXISTS system_users (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			username VARCHAR(64) NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_system_users_username (username)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`)

	await pool.query(`
		CREATE TABLE IF NOT EXISTS discharge_records (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			request_id CHAR(36) NOT NULL,
			created_by_user_id BIGINT UNSIGNED NOT NULL,
			hospitalization_number VARCHAR(64) NOT NULL,
			gender VARCHAR(10) NOT NULL,
			age VARCHAR(20) NOT NULL,
			phone VARCHAR(20) NOT NULL,
			diagnosis VARCHAR(100) NOT NULL,
			has_discharge_medication VARCHAR(2) NOT NULL,
			medication_types LONGTEXT NOT NULL,
			has_tube VARCHAR(2) NOT NULL,
			tube_types LONGTEXT NOT NULL,
			skin_types LONGTEXT NOT NULL,
			report_snapshot LONGTEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_discharge_records_request_id (request_id),
			KEY idx_discharge_records_created_by_user_id (created_by_user_id),
			KEY idx_discharge_records_hospitalization_number (hospitalization_number),
			KEY idx_discharge_records_phone (phone),
			KEY idx_discharge_records_created_at (created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`)

	// CREATE TABLE IF NOT EXISTS 不会升级旧表，启动时补齐账号归属字段和索引。
	const [ownerColumns] = await pool.execute(`
		SELECT COLUMN_NAME FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'discharge_records'
		AND COLUMN_NAME = 'created_by_user_id'
	`, [config.database])
	if (!ownerColumns.length) {
		// 历史记录的创建账号未知，保留为 NULL，不分配给任意账号。
		await pool.query('ALTER TABLE discharge_records ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER request_id')
	}
	const [ownerIndexes] = await pool.execute(`
		SELECT INDEX_NAME FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'discharge_records'
		AND INDEX_NAME = 'idx_discharge_records_created_by_user_id'
	`, [config.database])
	if (!ownerIndexes.length) {
		await pool.query('ALTER TABLE discharge_records ADD KEY idx_discharge_records_created_by_user_id (created_by_user_id)')
	}

	// 独立登记住院号，历史表中的重复数据不需要删除也能阻止今后重复生成报告。
	await pool.query(`
		CREATE TABLE IF NOT EXISTS hospitalization_number_registry (
			hospitalization_number VARCHAR(64) NOT NULL,
			first_record_id BIGINT UNSIGNED DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (hospitalization_number)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`)
	await pool.query(`
		CREATE TABLE IF NOT EXISTS discharge_record_shares (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			record_id BIGINT UNSIGNED NOT NULL,
			token VARCHAR(128) NOT NULL,
			token_hash CHAR(64) NOT NULL,
			file_name VARCHAR(180) NOT NULL,
			file_path VARCHAR(255) NOT NULL,
			expires_at DATETIME NOT NULL,
			revoked_at DATETIME DEFAULT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_discharge_record_shares_record_id (record_id),
			UNIQUE KEY uq_discharge_record_shares_token (token),
			UNIQUE KEY uq_discharge_record_shares_token_hash (token_hash),
			KEY idx_discharge_record_shares_expires_at (expires_at),
			CONSTRAINT fk_discharge_record_shares_record FOREIGN KEY (record_id) REFERENCES discharge_records (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`)
	const [shareTokenColumns] = await pool.execute(`
		SELECT COLUMN_NAME FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'discharge_record_shares' AND COLUMN_NAME = 'token'
	`, [config.database])
	if (!shareTokenColumns.length) await pool.query('ALTER TABLE discharge_record_shares ADD COLUMN token VARCHAR(128) NOT NULL AFTER record_id')
	const [shareTokenIndexes] = await pool.execute(`
		SELECT INDEX_NAME FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'discharge_record_shares' AND INDEX_NAME = 'uq_discharge_record_shares_token'
	`, [config.database])
	if (!shareTokenIndexes.length) await pool.query('ALTER TABLE discharge_record_shares ADD UNIQUE KEY uq_discharge_record_shares_token (token)')
	await pool.query(`
		INSERT IGNORE INTO hospitalization_number_registry (hospitalization_number, first_record_id)
		SELECT hospitalization_number, MIN(id)
		FROM discharge_records
		GROUP BY hospitalization_number
	`)

	await initializeFlowTable(pool)
	await initializeReservationTable(pool)
	const phone = config.testLoginPhone.trim()
	const password = typeof config.testLoginPassword === 'string' ? config.testLoginPassword : ''
	validateLoginCredentials(phone, password)
	const [existingUsers] = await pool.execute('SELECT id FROM system_users WHERE username = ? LIMIT 1', [phone])
	if (!existingUsers.length) {
		await pool.execute('INSERT INTO system_users (username, password_hash) VALUES (?, ?)', [phone, await hashPassword(password)])
		console.log(`已创建测试登录账号：${phone}`)
	}
}

function mapSummary(row) {
	return {
		id: row.id,
		hospitalizationNumber: row.hospitalization_number,
		gender: row.gender,
		age: row.age,
		phone: row.phone,
		diagnosis: row.diagnosis,
		createdAt: formatCreatedAt(row.created_at)
	}
}

function mapDetail(row) {
	return {
		...mapSummary(row),
		form: {
			hospitalizationNumber: row.hospitalization_number,
			gender: row.gender,
			age: row.age,
			phone: row.phone,
			diagnosis: row.diagnosis,
			hasDischargeMedication: row.has_discharge_medication,
			medicationTypes: fromJson(row.medication_types, []),
			hasTube: row.has_tube,
			tubeTypes: fromJson(row.tube_types, []),
			skinTypes: fromJson(row.skin_types, [])
		},
		reportSnapshot: fromJson(row.report_snapshot, [])
	}
}

const app = express()
app.disable('x-powered-by')
// Only the local reverse proxy may supply the client IP (used by public submission throttling).
app.set('trust proxy', 'loopback')
// Apply throttling before reading an anonymous submission, not after JSON parsing.
const reservationLimiter = createSubmissionLimiter()
const reservationJson = express.json({ limit: '8kb', inflate: false })
const regularJson = express.json({ limit: '12mb' })
app.use((req, res, next) => {
	if (req.method !== 'POST' || !/^\/api\/bed-reservations\/?$/i.test(req.path)) return regularJson(req, res, next)
	res.setHeader('Cache-Control', 'no-store')
	reservationLimiter(req, res, () => {
		if (!req.is('application/json')) return res.status(415).json({ message: '预约请求必须使用JSON格式' })
		reservationJson(req, res, error => {
			if (!error) return next()
			const status = error.status === 413 ? 413 : error.status === 415 ? 415 : 400
			res.status(status).json({ message: status === 413 ? '预约内容过大，请精简后重试' : '预约请求格式无效' })
		})
	})
})
app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*')
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
	if (req.method === 'OPTIONS') return res.status(204).end()
	next()
})

function requireAuth(req, res, next) {
	try {
		const authorization = req.headers.authorization || ''
		const match = authorization.match(/^Bearer\s+(.+)$/i)
		if (!match) throw new Error('请先登录')
		req.auth = verifyToken(match[1])
		next()
	} catch (error) {
		res.status(401).json({ message: error.message || '请先登录' })
	}
}

app.get('/api/health', async (_, res) => {
	try {
		await pool.query('SELECT 1')
		res.json({ ok: true })
	} catch (_) {
		res.status(503).json({ message: '数据库不可用' })
	}
})

app.post('/api/auth/login', async (req, res, next) => {
	try {
		const username = typeof (req.body && req.body.username) === 'string' ? req.body.username.trim() : ''
		const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : ''
		validateLoginCredentials(username, password)
		const [rows] = await pool.execute('SELECT * FROM system_users WHERE username = ? LIMIT 1', [username])
		if (!rows.length || !(await verifyPassword(password, rows[0].password_hash))) {
			return res.status(401).json({ message: '账号或密码错误' })
		}
		const expiresAt = Math.floor(Date.now() / 1000) + config.tokenExpiresInSeconds
		const token = signToken({ sub: rows[0].id, username: rows[0].username, exp: expiresAt })
		res.json({ token, expiresAt, user: { id: rows[0].id, username: rows[0].username } })
	} catch (error) {
		next(error)
	}
})

registerReservationRoutes(app, { getPool: () => pool, requireAuth })

app.use('/api/discharge-records', requireAuth)

const admissionPdfPath = path.join(__dirname, 'documents', 'admission-flow.pdf')
const imageStore = createImageStore(path.join(__dirname, 'storage', 'image-cache'))
registerImageRoutes(app, { prefix: '/documents/admission-flow', store: imageStore,
	resolvePdf: async () => fs.existsSync(admissionPdfPath) ? admissionPdfPath : null })
registerImageRoutes(app, { prefix: '/share/:token', store: imageStore, resolvePdf: async req => {
	const share = await findPublicShare(req.params.token)
	if (!share) return null
	const file = path.resolve(reportStorageDir, share.file_path)
	return path.dirname(file) === path.resolve(reportStorageDir) && fs.existsSync(file) ? file : null
} })

app.get('/api/admission-flow/share', async (req, res, next) => {
	try {
		if (!fs.existsSync(admissionPdfPath)) return res.status(503).json({ message: '入院流程文档暂不可用，请联系管理员' })
		const url = `${getShareBaseUrl(req)}/documents/admission-flow`
		const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 480 })
		res.setHeader('Cache-Control', 'no-store')
		res.json({ share: { url, qrDataUrl } })
	} catch (error) { next(error) }
})

// Fixed public guidance contains no patient data and does not expire.
app.get('/documents/admission-flow', (req, res) => {
	if (!fs.existsSync(admissionPdfPath)) return res.status(404).type('text').send('入院流程文档暂不可用')
	res.setHeader('Cache-Control', 'no-cache')
	res.type('html').send(imageReader({ title: '康复科入院流程', baseUrl: '/documents/admission-flow' }))
})

app.get('/documents/admission-flow/pdf', (req, res, next) => {
	if (!fs.existsSync(admissionPdfPath)) return res.status(404).type('text').send('入院流程文档暂不可用')
	res.type('application/pdf')
	res.setHeader('X-Content-Type-Options', 'nosniff')
	res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
	res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent('康复科入院流程.pdf')}`)
	res.sendFile(admissionPdfPath, error => { if (error) next(error) })
})

async function getOwnedRecord(id, userId) {
	const numericId = Number.parseInt(id, 10)
	if (!Number.isSafeInteger(numericId) || numericId < 1) {
		const error = new Error('记录编号无效')
		error.statusCode = 400
		throw error
	}
	const [rows] = await pool.execute('SELECT id FROM discharge_records WHERE id = ? AND created_by_user_id = ? LIMIT 1', [numericId, userId])
	if (!rows.length) {
		const error = new Error('未找到该记录')
		error.statusCode = 404
		throw error
	}
	return numericId
}

function mapShare(row, req) {
	return {
		url: buildShareUrl(req, row.token),
		qrDataUrl: row.qrDataUrl || '',
		expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at || ''),
		revoked: Boolean(row.revoked_at)
	}
}

registerFlowRoutes(app, { getPool: () => pool, getOwnedRecord, decodePdfBase64, createShareToken,
	hashShareToken, shareExpiryDate, buildShareUrl, mapShare, reportStorageDir, QRCode })

app.post('/api/discharge-records/:id/share', async (req, res, next) => {
	let connection
	let tempPath = ''
	try {
		const recordId = await getOwnedRecord(req.params.id, req.auth.sub)
		const pdf = decodePdfBase64(req.body && req.body.pdfBase64)
		const requestedName = normalizeString(req.body && req.body.fileName, 160)
		const safeName = (requestedName || `discharge-report-${recordId}.pdf`).replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_').slice(0, 160)
		const existingRows = (await pool.execute('SELECT * FROM discharge_record_shares WHERE record_id = ? LIMIT 1', [recordId]))[0]
		if (existingRows.length && !existingRows[0].revoked_at && new Date(existingRows[0].expires_at).getTime() > Date.now()) {
			const qrDataUrl = await QRCode.toDataURL(buildShareUrl(req, existingRows[0].token), { errorCorrectionLevel: 'M', margin: 2, width: 480 })
			return res.json({ share: mapShare({ ...existingRows[0], qrDataUrl }, req) })
		}

		const token = createShareToken()
		const tokenHash = hashShareToken(token)
		const fileName = `${recordId}-${tokenHash}.pdf`
		const finalPath = path.join(reportStorageDir, fileName)
		tempPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
		fs.writeFileSync(tempPath, pdf, { flag: 'wx' })
		fs.renameSync(tempPath, finalPath)
		const expiresAt = shareExpiryDate()
		connection = await pool.getConnection()
		await connection.beginTransaction()
		if (existingRows.length) {
			await connection.execute(`UPDATE discharge_record_shares SET token = ?, token_hash = ?, file_name = ?, file_path = ?, expires_at = ?, revoked_at = NULL WHERE record_id = ?`, [token, tokenHash, safeName, fileName, expiresAt, recordId])
		} else {
			await connection.execute(`INSERT INTO discharge_record_shares (record_id, token, token_hash, file_name, file_path, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, [recordId, token, tokenHash, safeName, fileName, expiresAt])
		}
		await connection.commit()
		connection.release()
		connection = null
		const qrDataUrl = await QRCode.toDataURL(buildShareUrl(req, token), { errorCorrectionLevel: 'M', margin: 2, width: 480 })
		res.status(201).json({ share: mapShare({ token, expires_at: expiresAt, qrDataUrl }, req) })
	} catch (error) {
		if (connection) {
			await connection.rollback()
			connection.release()
		}
		if (tempPath) {
			try { fs.unlinkSync(tempPath) } catch (_) {}
		}
		next(error)
	}
})

app.get('/api/discharge-records/:id/share', async (req, res, next) => {
	try {
		const recordId = await getOwnedRecord(req.params.id, req.auth.sub)
		const [rows] = await pool.execute('SELECT * FROM discharge_record_shares WHERE record_id = ? LIMIT 1', [recordId])
		if (!rows.length || rows[0].revoked_at || new Date(rows[0].expires_at).getTime() <= Date.now()) return res.json({ share: null })
		const qrDataUrl = await QRCode.toDataURL(buildShareUrl(req, rows[0].token), { errorCorrectionLevel: 'M', margin: 2, width: 480 })
		res.json({ share: mapShare({ ...rows[0], qrDataUrl }, req) })
	} catch (error) {
		next(error)
	}
})

app.delete('/api/discharge-records/:id/share', async (req, res, next) => {
	try {
		const recordId = await getOwnedRecord(req.params.id, req.auth.sub)
		await pool.execute('UPDATE discharge_record_shares SET revoked_at = CURRENT_TIMESTAMP WHERE record_id = ?', [recordId])
		res.json({ ok: true })
	} catch (error) {
		next(error)
	}
})

app.post('/api/discharge-records', async (req, res, next) => {
	let connection
	try {
		const requestId = normalizeString(req.body && req.body.requestId, 36)
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
			throw new Error('提交标识无效')
		}
		const form = validateRecord(req.body)
		const snapshot = normalizeSnapshot(req.body && req.body.reportSnapshot)
		connection = await pool.getConnection()
		await connection.beginTransaction()
		const [existingRequests] = await connection.execute(
			'SELECT id, created_by_user_id FROM discharge_records WHERE request_id = ? LIMIT 1 FOR UPDATE',
			[requestId]
		)
		if (existingRequests.length) {
			if (Number(existingRequests[0].created_by_user_id) !== Number(req.auth.sub)) {
				const error = new Error('提交标识无效')
				error.statusCode = 409
				throw error
			}
			const [rows] = await connection.execute(
				'SELECT * FROM discharge_records WHERE id = ? AND created_by_user_id = ? LIMIT 1',
				[existingRequests[0].id, req.auth.sub]
			)
			await connection.commit()
			return res.status(201).json({ record: mapDetail(rows[0]) })
		}

		try {
			await connection.execute(
				'INSERT INTO hospitalization_number_registry (hospitalization_number) VALUES (?)',
				[form.hospitalizationNumber]
			)
		} catch (error) {
			if (error && error.code === 'ER_DUP_ENTRY') {
				error.message = '该住院号已生成过出院报告，不能重复生成'
				error.statusCode = 409
			}
			throw error
		}

		const [result] = await connection.execute(`
			INSERT INTO discharge_records (
				request_id, created_by_user_id, hospitalization_number, gender, age, phone, diagnosis,
				has_discharge_medication, medication_types, has_tube, tube_types, skin_types, report_snapshot
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			requestId, req.auth.sub, form.hospitalizationNumber, form.gender, form.age, form.phone, form.diagnosis,
			form.hasDischargeMedication, toJson(form.medicationTypes), form.hasTube, toJson(form.tubeTypes),
			toJson(form.skinTypes), toJson(snapshot)
		])
		await connection.execute(
			'UPDATE hospitalization_number_registry SET first_record_id = ? WHERE hospitalization_number = ?',
			[result.insertId, form.hospitalizationNumber]
		)
		const [rows] = await connection.execute(
			'SELECT * FROM discharge_records WHERE id = ? AND created_by_user_id = ? LIMIT 1',
			[result.insertId, req.auth.sub]
		)
		await connection.commit()
		res.status(201).json({ record: mapDetail(rows[0]) })
	} catch (error) {
		if (connection) await connection.rollback()
		next(error)
	} finally {
		if (connection) connection.release()
	}
})

app.get('/api/discharge-records', async (req, res, next) => {
	try {
		const keyword = normalizeString(req.query.keyword, 100)
		const cursor = Number.parseInt(req.query.cursor, 10)
		const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50)
		const conditions = ['created_by_user_id = ?']
		const params = [req.auth.sub]
		if (keyword) {
			conditions.push('(hospitalization_number LIKE ? OR phone LIKE ? OR diagnosis LIKE ?)')
			params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
		}
		if (Number.isSafeInteger(cursor) && cursor > 0) {
			conditions.push('id < ?')
			params.push(cursor)
		}
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
		const [rows] = await pool.execute(`SELECT * FROM discharge_records ${where} ORDER BY id DESC LIMIT ?`, [...params, limit + 1])
		const hasMore = rows.length > limit
		const items = rows.slice(0, limit).map(mapSummary)
		res.json({ items, hasMore, nextCursor: hasMore ? items[items.length - 1].id : null })
	} catch (error) {
		next(error)
	}
})

app.get('/api/discharge-records/:id', async (req, res, next) => {
	try {
		const id = Number.parseInt(req.params.id, 10)
		if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: '记录编号无效' })
		const [rows] = await pool.execute(
			'SELECT * FROM discharge_records WHERE id = ? AND created_by_user_id = ? LIMIT 1',
			[id, req.auth.sub]
		)
		if (!rows.length) return res.status(404).json({ message: '未找到该记录' })
		res.json({ record: mapDetail(rows[0]) })
	} catch (error) {
		next(error)
	}
})

async function findPublicShare(token) {
	if (!/^[A-Za-z0-9_-]{40,100}$/.test(String(token || ''))) return null
	let [rows] = await pool.execute('SELECT *, \'出院报告\' AS document_title FROM discharge_record_shares WHERE token_hash = ? LIMIT 1', [hashShareToken(token)])
	if (!rows.length) [rows] = await pool.execute('SELECT *, \'出院流程\' AS document_title FROM discharge_record_flows WHERE token_hash = ? LIMIT 1', [hashShareToken(token)])
	if (!rows.length || rows[0].token !== token || rows[0].revoked_at || new Date(rows[0].expires_at).getTime() <= Date.now()) return null
	return rows[0]
}

app.get('/share/:token', async (req, res, next) => {
	try {
		const share = await findPublicShare(req.params.token)
		res.setHeader('Cache-Control', 'no-store')
		if (!share) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>链接无效</title><main style="font-family:system-ui;padding:32px;line-height:1.7;text-align:center"><h2>链接已失效</h2><p>该文档分享链接不存在、已过期或已被撤销。</p></main>')
		res.type('html').send(imageReader({ title: share.document_title, baseUrl: `/share/${encodeURIComponent(req.params.token)}`, expiresAt: new Date(share.expires_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }))
	} catch (error) {
		next(error)
	}
})

app.get('/share/:token/pdf', async (req, res, next) => {
	try {
		const share = await findPublicShare(req.params.token)
		res.setHeader('Cache-Control', 'no-store')
		if (!share) return res.status(404).type('text').send('分享链接已失效')
		const absolutePath = path.resolve(reportStorageDir, share.file_path)
		if (path.dirname(absolutePath) !== path.resolve(reportStorageDir) || !fs.existsSync(absolutePath)) return res.status(404).type('text').send('报告文件不存在')
		res.type('application/pdf')
		res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(share.file_name)}`)
		res.sendFile(absolutePath)
	} catch (error) {
		next(error)
	}
})

// 仅发布专用的 public 目录，源码、环境变量与数据库密码不会被静态服务暴露。
app.use('/api', (_, res) => res.status(404).json({ message: '接口不存在' }))
app.use(express.static(path.join(__dirname, 'public'), {
	dotfiles: 'deny',
	setHeaders(res, filePath) {
		res.setHeader('X-Content-Type-Options', 'nosniff')
		if (path.extname(filePath) === '.html') res.setHeader('Cache-Control', 'no-cache')
	}
}))

app.use((error, _, res, __) => {
	console.error(error)
	res.status(error.statusCode || 400).json({ message: error.message || '请求处理失败' })
})

initializeDatabase()
	.then(() => app.listen(config.portHttp, process.env.HOST || '0.0.0.0', () => {
		console.log(`康复科后端已启动：http://127.0.0.1:${config.portHttp}`)
	}))
	.catch(error => {
		console.error('后端启动失败，请检查 server/.env 中的 MySQL 配置。')
		console.error(error)
		process.exit(1)
	})

const fs = require('fs')
const path = require('path')

async function initializeFlowTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS discharge_record_flows (
    record_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    request_id CHAR(36) NOT NULL,
    form_json TEXT NOT NULL,
    token VARCHAR(128) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    file_name VARCHAR(180) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_discharge_flow_token (token),
    UNIQUE KEY uq_discharge_flow_token_hash (token_hash),
    CONSTRAINT fk_discharge_flow_record FOREIGN KEY (record_id) REFERENCES discharge_records(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}

function validateFlow(body) {
  const source = body && body.form || {}
  const form = {
    settlementMethod: source.settlementMethod,
    westernMedicine: source.westernMedicine,
    chineseMedicine: source.chineseMedicine
  }
  if (!['柜台身份证医保卡', '自助机结算', '短信通知'].includes(form.settlementMethod)) throw new Error('请选择结算方式')
  if (!['有', '无'].includes(form.westernMedicine)) throw new Error('请选择是否出院西药带药')
  if (!['有', '无'].includes(form.chineseMedicine)) throw new Error('请选择是否出院中药带药')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '')) throw new Error('提交标识无效')
  return form
}

function registerFlowRoutes(app, helpers) {
  const { getPool, getOwnedRecord, decodePdfBase64, createShareToken, hashShareToken,
    shareExpiryDate, buildShareUrl, mapShare, reportStorageDir, QRCode } = helpers

  async function mapFlow(row, req) {
    if (!row) return null
    const active = !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()
    const qrDataUrl = active ? await QRCode.toDataURL(buildShareUrl(req, row.token), { errorCorrectionLevel: 'M', margin: 2, width: 480 }) : ''
    return { form: JSON.parse(row.form_json), updatedAt: row.updated_at,
      share: active ? mapShare({ ...row, qrDataUrl }, req) : null }
  }

  app.get('/api/discharge-records/:id/flow', async (req, res, next) => {
    try {
      const id = await getOwnedRecord(req.params.id, req.auth.sub)
      const [rows] = await getPool().execute('SELECT * FROM discharge_record_flows WHERE record_id = ?', [id])
      res.json({ flow: await mapFlow(rows[0], req) })
    } catch (error) { next(error) }
  })

  app.post('/api/discharge-records/:id/flow', async (req, res, next) => {
    let connection
    let newFile = ''
    let committed = false
    try {
      const id = await getOwnedRecord(req.params.id, req.auth.sub)
      const form = validateFlow(req.body)
      const pdf = decodePdfBase64(req.body.pdfBase64)
      connection = await getPool().getConnection()
      await connection.beginTransaction()
      // Serialize generation/revocation on the patient, including the first insert.
      const [patients] = await connection.execute('SELECT hospitalization_number FROM discharge_records WHERE id = ? AND created_by_user_id = ? FOR UPDATE', [id, req.auth.sub])
      if (!patients.length) { const error = new Error('未找到该记录'); error.statusCode = 404; throw error }
      const [rows] = await connection.execute('SELECT * FROM discharge_record_flows WHERE record_id = ?', [id])
      const previous = rows[0]
      if (previous && previous.request_id === req.body.requestId) {
        if (previous.form_json !== JSON.stringify(form) || previous.revoked_at || new Date(previous.expires_at).getTime() <= Date.now()) {
          const error = new Error('已生成出院流程，请前往患者详情页查看'); error.statusCode = 409; throw error
        }
        const flow = await mapFlow(previous, req)
        await connection.commit()
        return res.json({ flow })
      }
      if (previous) {
        const error = new Error('已生成出院流程，请前往患者详情页查看'); error.statusCode = 409; throw error
      }
      const token = createShareToken()
      const tokenHash = hashShareToken(token)
      const filePath = `flow-${id}-${tokenHash}.pdf`
      const patientNumber = patients[0].hospitalization_number.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_')
      const row = { record_id: id, form_json: JSON.stringify(form), token, expires_at: shareExpiryDate(), updated_at: new Date() }
      const flow = await mapFlow(row, req)
      newFile = path.join(reportStorageDir, filePath)
      fs.writeFileSync(newFile, pdf, { flag: 'wx' })
      await connection.execute(`INSERT INTO discharge_record_flows
        (record_id, request_id, form_json, token, token_hash, file_name, file_path, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.body.requestId, row.form_json, token, tokenHash, `出院流程_${patientNumber}.pdf`, filePath, row.expires_at])
      await connection.commit()
      committed = true
      res.status(201).json({ flow })
    } catch (error) {
      if (connection && !committed) await connection.rollback()
      if (newFile && !committed) removePdf(path.basename(newFile))
      next(error)
    } finally { if (connection) connection.release() }
  })

  function removePdf(fileName) {
    const file = path.resolve(reportStorageDir, fileName)
    if (path.dirname(file) !== path.resolve(reportStorageDir)) return
    try { fs.unlinkSync(file) } catch (error) {
      if (error.code !== 'ENOENT') console.error('无法清理旧出院流程 PDF', error.code)
    }
  }

  app.delete('/api/discharge-records/:id/flow/share', async (req, res, next) => {
    let connection
    try {
      const id = await getOwnedRecord(req.params.id, req.auth.sub)
      connection = await getPool().getConnection()
      await connection.beginTransaction()
      await connection.execute('SELECT id FROM discharge_records WHERE id = ? FOR UPDATE', [id])
      await connection.execute('UPDATE discharge_record_flows SET revoked_at=CURRENT_TIMESTAMP WHERE record_id=?', [id])
      await connection.commit()
      res.json({ ok: true })
    } catch (error) {
      if (connection) await connection.rollback()
      next(error)
    } finally { if (connection) connection.release() }
  })
}

module.exports = { initializeFlowTable, registerFlowRoutes }

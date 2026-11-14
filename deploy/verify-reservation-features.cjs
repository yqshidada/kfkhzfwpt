// Read-only production checks. Credentials are read on the server and never printed.
const fs = require('fs'), https = require('https'), assert = require('assert/strict')
const app = '/opt/rehab-app/server'
const settings = Object.fromEntries(fs.readFileSync(app + '/.env','utf8').split(/\r?\n/).map(line => line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m => [m[1],m[2]]))
function request(route, { method = 'GET', body, token } = {}) {
  return new Promise((resolve,reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = https.request({ hostname: 'gzitwmkfk.cn', path: route, method,
      lookup: (name,options,cb) => options.all ? cb(null,[{address:'127.0.0.1',family:4}]) : cb(null,'127.0.0.1',4),
      headers: { ...(data ? {'content-type':'application/json','content-length':data.length} : {}), ...(token ? {authorization:'Bearer '+token} : {}) }
    }, res => { const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks),headers:res.headers})) })
    req.setTimeout(15000,()=>req.destroy(Error('Request timeout')));req.on('error',reject);req.end(data)
  })
}
async function bundle(prefix) {
  const names=fs.readdirSync(app+'/public/static/js').filter(name=>name.startsWith(prefix)&&name.endsWith('.js'))
  assert.equal(names.length,1,'Expected one current H5 bundle: '+prefix)
  const bytes=fs.readFileSync(app+'/public/static/js/'+names[0]),response=await request('/static/js/'+names[0])
  assert.equal(response.status,200);assert.equal(response.bytes.compare(bytes),0)
  return bytes.toString('utf8').replace(/\\u([0-9a-f]{4})/gi,(_,c)=>String.fromCharCode(parseInt(c,16)))
}
;(async()=>{
  const login=await request('/api/auth/login',{method:'POST',body:{username:settings.TEST_LOGIN_PHONE,password:settings.TEST_LOGIN_PASSWORD}})
  assert.equal(login.status,200,'New shared account must log in over HTTPS')
  const session=JSON.parse(login.bytes);assert.equal(session.user.username,settings.TEST_LOGIN_PHONE);assert.ok(session.token)
  for(const route of ['/api/discharge-records?limit=1','/api/bed-reservations?limit=1']) assert.equal((await request(route,{token:session.token})).status,200,'Both entry queues must accept new login')
  assert.equal((await request('/api/bed-reservations/1/note',{method:'POST',body:{note:'',version:0}})).status,401)
  const invalid=await request('/api/bed-reservations/1/note',{method:'POST',token:session.token,body:{note:'x'.repeat(1001),version:0}})
  assert.equal(invalid.status,400,'Oversized note must be rejected before any update')
  assert.equal(invalid.headers['cache-control'],'no-store')
  const lookup=await request('/api/bed-reservations/lookup',{method:'POST',body:{phone:'13800138000',idCard:'11010519491231002X'}})
  assert.equal(lookup.status,400);assert.equal(JSON.parse(lookup.bytes).code,'CAPTCHA_INVALID');assert.equal(lookup.headers['cache-control'],'no-store')
  const noteList=JSON.parse((await request('/api/bed-reservations?limit=1',{token:session.token})).bytes)
  for(const item of noteList.items) { assert.equal(typeof item.staffNote,'string');assert.ok(Number.isInteger(item.staffNoteVersion));assert.ok(Object.hasOwn(item,'staffNoteUpdatedAt')) }
  const mysql=require(app+'/node_modules/mysql2/promise')
  const db=await mysql.createConnection({host:settings.DB_HOST||'127.0.0.1',port:Number(settings.DB_PORT||3306),user:settings.DB_USER,password:settings.DB_PASSWORD,database:settings.DB_NAME})
  try {
    const [columns]=await db.query('SHOW COLUMNS FROM bed_reservations')
    for(const name of ['staff_note','staff_note_version','staff_note_updated_at_ms','staff_note_updated_by_user_id'])assert.ok(columns.some(column=>column.Field===name))
    const [result]=await db.query('UPDATE bed_reservations SET staff_note = staff_note WHERE 1=0');assert.equal(result.affectedRows,0)
  } finally { await db.end() }
  const list=await bundle('pages-nurse-list.'),booking=await bundle('pages-bed-reservation-index.'),loginPage=await bundle('pages-login-index.')
  for(const text of ['护士备注','保存备注','加载最新备注','noteEditors'])assert.ok(list.includes(text),'Nurse note control missing')
  for(const text of ['预约查询 / 再次预约','请输入原预约手机号','请输入身份证号','查询预约','usePreviousReservation','lookupPending'])assert.ok(booking.includes(text),'Patient lookup/rebook control missing')
  assert.ok(!loginPage.includes(settings.TEST_LOGIN_PASSWORD),'Login password must not be bundled')
  console.log('PASS: HTTPS new shared login and both queues, protected staff notes/schema/zero-row UPDATE permission, missing-captcha lookup guard/no-store; exact H5 note and patient lookup/rebook controls; zero patient writes')
})().catch(error=>{console.error('Reservation feature verification failed:',error.code||error.name);process.exitCode=1})
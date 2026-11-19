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
  assert.equal(login.status,200,'Shared login must remain available');const token=JSON.parse(login.bytes).token
  assert.equal((await request('/api/bed-reservations?limit=1')).status,401,'Aggregate must require login')
  const mysql=require(app+'/node_modules/mysql2/promise')
  const db=await mysql.createConnection({host:settings.DB_HOST||'127.0.0.1',port:Number(settings.DB_PORT||3306),user:settings.DB_USER,password:settings.DB_PASSWORD,database:settings.DB_NAME})
  try {
    async function expected() {
      const [rows]=await db.query('SELECT COUNT(*) AS n, SUM(confirmed_at_ms - created_at_ms) AS total_ms FROM bed_reservations WHERE confirmed_at_ms IS NOT NULL AND cancelled_at_ms IS NULL AND confirmed_at_ms >= created_at_ms')
      const count=Number(rows[0].n);return {completedCount:count,averageDays:count?Number(rows[0].total_ms)/count/86400000:null}
    }
    let verified=false
    for(let attempt=0;attempt<3&&!verified;attempt++) {
      const before=await expected(),results=[]
      for(const query of ['?limit=1','?limit=1&cursor=1','?keyword=__release_summary_no_match__&status='+encodeURIComponent('预约中'),'?status='+encodeURIComponent('取消预约')+'&reminder=tomorrow']) {
        const response=await request('/api/bed-reservations'+query,{token})
        assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store')
        results.push(JSON.parse(response.bytes).waitingSummary)
      }
      const after=await expected()
      if(JSON.stringify(before)!==JSON.stringify(after))continue // A real confirmation may happen while reading.
      for(const summary of results) {
        assert.ok(summary);assert.equal(summary.completedCount,before.completedCount)
        if(before.averageDays===null)assert.equal(summary.averageDays,null)
        else {assert.ok(Number.isFinite(summary.averageDays));assert.ok(Math.abs(summary.averageDays-before.averageDays)<1e-8,'Global average must match source timestamps and ignore all filters')}
      }
      verified=true
    }
    assert.ok(verified,'Summary changed during all verification attempts')
  } finally {await db.end()}
  const list=await bundle('pages-nurse-list.')
  for(const text of ['整体平均约床时长','waitingSummary','completedCount','averageDays','暂无预约成功记录，暂无法估算','护士备注','保存备注'])assert.ok(list.includes(text),'Summary UI or existing note controls missing')
  assert.ok(!list.includes('仅供等床参考'),'Removed waiting-reference sentence remains')
  assert.ok(!list.includes('护长、护士可在此填写备注'),'Removed note placeholder remains')
  console.log('PASS: real HTTPS authenticated global waiting mean/count match database across search/status/reminder/pagination; no-store/auth/empty semantics; exact H5 summary and blank-note controls; zero business writes')
})().catch(error=>{console.error('Overall waiting verification failed:',error.code||error.name);process.exitCode=1})

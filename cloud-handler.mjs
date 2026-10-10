import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {ENTITIES,FIELDS,SALES,PROJECT,TASK,PRODUCTS,TEMPLATES,fail} from './domain.mjs';
import {passwordCheck,passwordHash,list,get,save,audit,transaction,convert,createProject} from './cloud-db.mjs';
import {search,chat,createDraft,resolveDraft} from './cloud-assistant.mjs';
import {lookupCompany,enrichCompany,limitLookup} from './company-lookup.mjs';
import {quickOpportunity,csvExport} from './workflow.mjs';
const root=dirname(fileURLToPath(import.meta.url));
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
async function body(req){if(req.body!==undefined)return typeof req.body==='string'?JSON.parse(req.body):req.body;let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>8*1024*1024)fail('請求超過 8 MB',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail('JSON 格式錯誤');}}

const userOf=s=>({id:s.userId,name:s.name,email:s.email,role:s.role});
function writable(user){if(user.role==='viewer')fail('此帳號僅可檢視',403);}
function admin(user){if(user.role!=='admin')fail('僅管理員可操作',403);}
const cookie=(id,max)=>`sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${max}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`;
export async function handle(req,res,db){
async function session(req){const id=/\bsid=([a-f0-9]+)\b/.exec(req.headers.cookie||'')?.[1];if(!id)return null;return (await db.prepare('SELECT s.*,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.userId WHERE s.id=? AND s.expires>?').get(id,Date.now()));}
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try {
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 if(!['GET','HEAD'].includes(req.method)) {
 const origin=req.headers.origin;
 if(origin && origin!==`${process.env.COOKIE_SECURE==='1'?'https':'http'}://${req.headers.host}`)fail('來源驗證失敗',403);
 if(req.headers['content-type']?.split(';')[0]!=='application/json')fail('請使用 JSON',415);
 }
 if(path==='/api/login'&&req.method==='POST') {
 const key=String(req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown').slice(0,200),prior=await (await db.prepare('SELECT count,time FROM login_attempts WHERE id=?').get(key))||{count:0,time:Date.now()};
 if(Date.now()-prior.time>600000){prior.count=0;prior.time=Date.now();}if(prior.count>=15)fail('嘗試過於頻繁，請稍後再試',429);
 const b=await body(req);if(typeof b.email!=='string'||typeof b.password!=='string'||b.password.length>200)fail('帳號密碼格式錯誤');
 const u=(await db.prepare('SELECT * FROM users WHERE email=?').get(b.email.trim().toLowerCase()));
 if(!u||!passwordCheck(b.password,u.password)){prior.count++;await (await db.prepare('INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET count=EXCLUDED.count,time=EXCLUDED.time').run(key,prior.count,prior.time));fail('帳號或密碼錯誤',401);}
 await (await db.prepare('DELETE FROM login_attempts WHERE id=?').run(key));const id=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
 (await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()));(await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(id,u.id,csrf,Date.now()+28800000));
 (await audit(db,u.id,'login','users',u.id,null,null));return send(res,200,{user:{id:u.id,name:u.name,role:u.role,email:u.email},csrf},{'Set-Cookie':cookie(id,28800)});
 }
 if(path.startsWith('/api/')) {
 const s=(await session(req));if(!s)fail('請先登入',401);const user=userOf(s);
 if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==s.csrf)fail('安全驗證失敗，請重新登入',403);
 if(path==='/api/me'&&req.method==='GET')return send(res,200,{user,csrf:s.csrf});
 if(path==='/api/logout'&&req.method==='POST'){(await db.prepare('DELETE FROM sessions WHERE id=?').run(s.id));return send(res,200,{ok:true},{'Set-Cookie':cookie('',0)});}
 if(path==='/api/company-lookup'&&req.method==='GET'){writable(user);await limitLookup(db,user.id);return send(res,200,await lookupCompany(url.searchParams.get('q')));}
 if(path==='/api/company-enrich'&&req.method==='POST'){writable(user);await limitLookup(db,user.id);return send(res,200,await enrichCompany(await body(req)));}
 if(path==='/api/opportunities/quick-create'&&req.method==='POST'){writable(user);return send(res,201,await quickOpportunity(db,{list,save,transaction},user,await body(req)));}
 const exp=/^\/api\/export\/([a-z]+)$/.exec(path);if(exp&&req.method==='GET'&&ENTITIES.includes(exp[1])){admin(user);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${exp[1]}.csv"`,'Cache-Control':'no-store'});return res.end(csvExport(exp[1],await list(db,exp[1])));}
 if(path==='/api/data'&&req.method==='GET') {
 const data={};for(const t of ENTITIES)data[t]=await (await list(db,t));
 data.users=(await db.prepare('SELECT id,name,email,role FROM users ORDER BY name').all());
 data.drafts=(await db.prepare('SELECT * FROM drafts WHERE userId=? ORDER BY createdAt DESC LIMIT 100').all(user.id)).map(d=>({...d,payload:JSON.parse(d.payload)}));
 data.chats=(await db.prepare('SELECT role,content,createdAt FROM chats WHERE userId=? ORDER BY createdAt DESC LIMIT 30').all(user.id)).reverse();
 data.audit=user.role==='admin'?(await db.prepare('SELECT a.*,u.name actor FROM audit a JOIN users u ON u.id=a.userId ORDER BY a.createdAt DESC LIMIT 200').all()):[];
 return send(res,200,{...data,meta:{version:'1.0.0-rc.1',mode:process.env.OPENAI_API_KEY?'live':'demo',uploadLimitMb:3,storage:'PostgreSQL',seedDemo:process.env.SEED_DEMO==='1',fields:FIELDS,sales:SALES,project:PROJECT,task:TASK,products:PRODUCTS,templates:TEMPLATES}});
 }
 if(path==='/api/search'&&req.method==='GET')return send(res,200,(await search(db,url.searchParams.get('q'))));
 if(path==='/api/chat'&&req.method==='POST'){const b=await body(req);return send(res,200,await (await chat(db,user,b.message)));}
 if(path==='/api/drafts'&&req.method==='POST'){writable(user);return send(res,201,(await createDraft(db,user,await body(req))));}
 const draftMatch=/^\/api\/drafts\/([^/]+)$/.exec(path);
 if(draftMatch&&req.method==='POST'){const b=await body(req);return send(res,200,(await resolveDraft(db,user,draftMatch[1],b.decision)));}
 const convertMatch=/^\/api\/opportunities\/([^/]+)\/convert$/.exec(path);
 if(convertMatch&&req.method==='POST'){writable(user);return send(res,200,(await convert(db,convertMatch[1],user.id)));}
 if(path==='/api/password'&&req.method==='POST') {
 const b=await body(req);const u=(await db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
 if(typeof b.current!=='string'||!passwordCheck(b.current,u.password))fail('原密碼錯誤');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>200)fail('新密碼須為 12–200 字元');
 (await transaction(db,async()=>{(await db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),user.id));(await db.prepare('DELETE FROM sessions WHERE userId=? AND id<>?').run(user.id,s.id));(await audit(db,user.id,'password_change','users',user.id,null,null));}));return send(res,200,{ok:true});
 }
 if(path==='/api/users'&&req.method==='POST') {
 admin(user);const b=await body(req);if(!b.name||typeof b.name!=='string'||b.name.length>100||typeof b.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)||!['admin','member','viewer'].includes(b.role)||typeof b.password!=='string'||b.password.length<12||b.password.length>200)fail('請填姓名、有效 Email、角色與 12–200 字元密碼');
 const id=randomUUID();(await transaction(db,async()=>{(await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,b.name,b.email.trim().toLowerCase(),b.role,passwordHash(b.password)));(await audit(db,user.id,'user_create','users',id,null,{name:b.name,email:b.email,role:b.role}));}));return send(res,201,{id});
 }
 const userMatch=/^\/api\/users\/([^/]+)$/.exec(path);
 if(userMatch&&req.method==='PATCH') {
 admin(user);const b=await body(req);if(!['admin','member','viewer'].includes(b.role))fail('角色錯誤');
 const target=(await db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(userMatch[1]));if(!target)fail('帳號不存在',404);if(target.id===user.id)fail('不能修改自己的角色');
 (await transaction(db,async()=>{(await db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role,target.id));(await db.prepare('DELETE FROM sessions WHERE userId=?').run(target.id));(await audit(db,user.id,'role_change','users',target.id,target,{...target,role:b.role}));}));return send(res,200,{ok:true});
 }
 if(path==='/api/uploads'&&req.method==='POST') {
 writable(user);const b=await body(req);if(typeof b.content!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.content))fail('檔案格式錯誤');
 const bytes=Buffer.from(b.content,'base64');if(bytes.length>3*1024*1024)fail('檔案上限 3 MB',413);
 const name=String(b.name||'').replace(/[\\/\x00-\x1f]/g,'_').slice(0,180);if(!name)fail('請選擇檔案');
 const storageKey=randomUUID();await (await db.prepare('INSERT INTO attachments VALUES(?,?)').run(storageKey,bytes));
 const text=/\.(txt|md|csv|json|log)$/i.test(name)?bytes.toString('utf8').slice(0,250000):'';
 try {const r=(await transaction(db,async()=>(await save(db,'files',{...b,name},user.id,null,null,{storageKey,size:bytes.length,contentType:'application/octet-stream',extractedText:text}))));return send(res,201,r);}catch(e){await (await db.prepare('DELETE FROM attachments WHERE id=?').run(storageKey));throw e;}
 }
 const download=/^\/api\/files\/([^/]+)\/download$/.exec(path);
 if(download&&req.method==='GET') {
 const file=(await get(db,'files',download[1]));if(!file?.storageKey)fail('檔案不存在',404);
 const entry=await (await db.prepare('SELECT bytes FROM attachments WHERE id=?').get(file.storageKey));if(!entry)fail('檔案不存在',404);const bytes=entry.bytes;res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'no-store'});return res.end(bytes);
 }
 const match=/^\/api\/records\/([a-z]+)(?:\/([^/]+))?$/.exec(path);
 if(match&&ENTITIES.includes(match[1])) {
 const [,type,id]=match;
 if(req.method==='GET'&&id){const record=(await get(db,type,id));if(!record)fail('資料不存在',404);return send(res,200,record);}
 if(req.method==='POST'&&!id&&type!=='files'){writable(user);const b=await body(req);return send(res,201,(await transaction(db,async()=>type==='projects'?(await createProject(db,b,user.id)):(await save(db,type,b,user.id)))));}
 if(req.method==='PATCH'&&id){writable(user);const b=await body(req);return send(res,200,(await transaction(db,async()=>(await save(db,type,b,user.id,id,b.version)))));}
 if(req.method==='DELETE'&&id){admin(user);const b=await body(req),before=(await get(db,type,id));if(!before)fail('資料不存在',404);if(b.version!==before.version)fail('資料版本已變更',409);
 (await transaction(db,async()=>{(await db.prepare(`DELETE FROM ${type} WHERE id=?`).run(id));(await db.prepare('DELETE FROM search_index WHERE entity=? AND recordId=?').run(type,id));(await audit(db,user.id,'delete',type,id,before,null));}));if(type==='files'&&before.storageKey)await (await db.prepare('DELETE FROM attachments WHERE id=?').run(before.storageKey));return send(res,200,{ok:true});}
 }
 fail('找不到此操作',404);
 }
 const assets={'/':'index.html','/app.js':'app.js','/company-form.js':'company-form.js','/style.css':'style.css'};if(!assets[path]||req.method!=='GET')fail('找不到頁面',404);
 const content=readFileSync(join(root,'public',assets[path]));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(content);
 }catch(e){const message=/FOREIGN KEY/.test(e.message)?'此資料有關聯紀錄，請先處理關聯後再刪除':/UNIQUE/.test(e.message)?'資料已存在':e.status?e.message:'伺服器處理失敗';if(!e.status&&!/constraint/i.test(e.message))console.error(e);if(!res.headersSent)send(res,e.status||(/constraint/i.test(e.message)?409:500),{error:message});else res.end();}
}


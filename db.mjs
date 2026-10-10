import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {ENTITIES,FIELDS,REF,validate,fail,TEMPLATES} from './domain.mjs';
import {existingCompany} from './workflow.mjs';
export function passwordHash(password) {const salt=randomBytes(16).toString('hex'); return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function passwordCheck(password,hash) {const [salt,key]=hash.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'));}
export function openDatabase(directory) {
 mkdirSync(directory,{recursive:true});const db=new DatabaseSync(join(directory,'crm.sqlite'));
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')),password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,recordId TEXT,before TEXT,after TEXT,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,content TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS login_attempts(id TEXT PRIMARY KEY,count INTEGER NOT NULL,time INTEGER NOT NULL);`);
 for (const type of ENTITIES) {
   const refs=Object.keys(FIELDS[type]).filter(k=>REF[k]).map(k=>`${k} TEXT REFERENCES ${REF[k]}(id)`).join(',');
   db.exec(`CREATE TABLE IF NOT EXISTS ${type}(id TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL${refs?','+refs:''}${type==='projects'?',sourceOpportunityId TEXT UNIQUE REFERENCES opportunities(id)':''});`);
 }
 db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity UNINDEXED,recordId UNINDEXED,body,tokenize='trigram'); CREATE INDEX IF NOT EXISTS audit_time ON audit(createdAt);`);
 return db;
}
export const unpack=row=>row?{...JSON.parse(row.payload),id:row.id,version:row.version,createdAt:row.createdAt,updatedAt:row.updatedAt}:null;
export function list(db,type){return db.prepare(`SELECT * FROM ${type} ORDER BY createdAt DESC`).all().map(unpack);}
export function get(db,type,id){return unpack(db.prepare(`SELECT * FROM ${type} WHERE id=?`).get(id));}
export function audit(db,userId,action,entity,recordId,before,after){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),userId,action,entity,recordId,JSON.stringify(before??null),JSON.stringify(after??null),new Date().toISOString());}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try {const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
export function save(db,type,input,userId,id=null,version=null,extra={}) {
 const before=id?get(db,type,id):null;if(id&&!before)fail('資料不存在',404);
 if(before && version!==before.version)fail('資料已被修改，請重新整理後再操作',409);
 const data={...validate(db,type,input,before||{}),...extra};
 if(type==='companies'&&existingCompany(list(db,type),data,id))fail('公司名稱或統編已存在，請選擇既有公司',409);
 if(before?.companyId && data.companyId!==before.companyId) {
   const refField={opportunities:'opportunityId',projects:'projectId',visits:'visitId',meetings:'meetingId'}[type];
   if(refField && ENTITIES.some(t=>FIELDS[t][refField] && db.prepare(`SELECT id FROM ${t} WHERE ${refField}=? LIMIT 1`).get(before.id))) fail('此紀錄已有關聯資料，不能改到其他公司');
 }
 if(type==='opportunities' && before && db.prepare('SELECT id FROM projects WHERE sourceOpportunityId=?').get(before.id)) {
   if(data.stage!=='結案'||data.outcome!=='成交'||data.product!==before.product)fail('已轉專案的成交商機不能重新開案或變更產品');
 }
 if(type==='projects' && before?.opportunityId)data.opportunityId=before.opportunityId;
 if(type==='files' && before)for(const k of ['storageKey','size','contentType','extractedText'])data[k]=before[k];
 const key=id||randomUUID(),now=new Date().toISOString();
 const refs=Object.keys(FIELDS[type]).filter(k=>REF[k]);
 if(before)db.prepare(`UPDATE ${type} SET payload=?,version=version+1,updatedAt=?${refs.map(k=>`,${k}=?`).join('')} WHERE id=?`).run(JSON.stringify(data),now,...refs.map(k=>data[k]||null),key);
 else {
 const columns=['id','payload','createdAt','updatedAt',...refs,...(type==='projects'?['sourceOpportunityId']:[])];
 db.prepare(`INSERT INTO ${type}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(key,JSON.stringify(data),now,now,...refs.map(k=>data[k]||null),...(type==='projects'?[data.opportunityId||null]:[]));
 }
 db.prepare('DELETE FROM search_index WHERE entity=? AND recordId=?').run(type,key);
 db.prepare('INSERT INTO search_index(entity,recordId,body) VALUES(?,?,?)').run(type,key,Object.values(data).join(' '));
 const after=get(db,type,key);audit(db,userId,before?'update':'create',type,key,before,after);return after;
}
export function createProject(db,input,userId,extra={}) {
 const p=save(db,'projects',input,userId,null,null,extra);
 TEMPLATES[p.product].forEach((name,index)=>save(db,'milestones',{name,projectId:p.id,stage:'待辦',description:`第 ${index+1} 階段，完成後由負責人確認驗收。`},userId));
 return p;
}
export function convert(db,id,userId) {
 const o=get(db,'opportunities',id);if(!o)fail('商機不存在',404);
 if(o.stage!=='結案'||o.outcome!=='成交')fail('僅成交商機可以轉專案');
 const existing=db.prepare('SELECT * FROM projects WHERE sourceOpportunityId=?').get(id);if(existing)return unpack(existing);
 return transaction(db,()=>{
 const p=createProject(db,{name:o.name,companyId:o.companyId,product:o.product,ownerId:o.ownerId,stage:'啟動規劃',description:o.needs,risks:o.risks},userId,{opportunityId:id});
 audit(db,userId,'convert','opportunities',id,o,{projectId:p.id});return p;
 });
}
export function seed(db) {
 if(db.prepare('SELECT count(*) n FROM users').get().n)return;
 const password=process.env.ADMIN_PASSWORD||'GameDemo!2026';if(password.length<12)fail('ADMIN_PASSWORD 至少 12 字元');
 const admin=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(admin,'系統管理員',(process.env.ADMIN_EMAIL||'admin@game.local').toLowerCase(),'admin',passwordHash(password));
 if(process.env.SEED_DEMO==='0')return;
 const member=randomUUID(),viewer=randomUUID();
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(member,'林業務（示例）','sales@game.local','member',passwordHash('SalesDemo!2026'));
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(viewer,'唯讀主管（示例）','viewer@game.local','viewer',passwordHash('ViewDemo!2026'));
 transaction(db,()=>{
 const c1=save(db,'companies',{name:'星河製造（示例）',industry:'智慧製造',notes:'虛構示例公司；所有金額僅供操作展示。'},admin);
 const c2=save(db,'companies',{name:'森境設計（示例）',industry:'空間設計'},admin);
 const c3=save(db,'companies',{name:'遠景科技（示例）',industry:'資訊服務'},admin);
 save(db,'contacts',{name:'陳怡安（示例）',companyId:c1.id,title:'營運經理',email:'chen@example.com',decisionRole:'需求發起人'},admin);
 save(db,'contacts',{name:'王志明（示例）',companyId:c1.id,title:'資訊主管',email:'wang@example.com',decisionRole:'技術決策人'},admin);
 const specs=[['GAME 知識助理導入',c1,'GAME 系統','方案提案'],['沉浸式品牌展間',c2,'虛擬展間','報價議價'],['專案流程數位化',c3,'PMS 專案管理','待簽約'],['企業官網整合',c1,'客製化網站／軟體','結案'],['GAME 售後客服',c3,'GAME 系統','新商機'],['網站會員系統',c2,'客製化網站／軟體','需求洽談']];
 const opps=specs.map(([name,c,product,stage],i)=>save(db,'opportunities',{name:name+'（示例）',companyId:c.id,product,stage,outcome:stage==='結案'?'成交':'',ownerId:member,amount:String([320000,480000,240000,180000,150000,200000][i]),probability:String([50,65,80,100,10,30][i]),dueDate:'2026-11-15',needs:'確認使用場景、角色權限與驗收範圍。',risks:i===0?'資料授權尚未確認':'',nextStep:'安排需求確認會議'},admin));
 save(db,'projects',{name:'企業官網整合（示例）',companyId:c1.id,product:'客製化網站／軟體',stage:'開發整合',ownerId:member,dueDate:'2026-11-30',description:'官網、表單與客戶資料整合',risks:'素材交付延遲'},admin,null,null,{opportunityId:opps[3].id});
 const p=list(db,'projects')[0];TEMPLATES[p.product].forEach((name,i)=>save(db,'milestones',{name,projectId:p.id,stage:i<3?'已完成':'待辦',dueDate:'2026-11-20'},admin));
 save(db,'tasks',{name:'確認 GAME 資料授權',opportunityId:opps[0].id,ownerId:member,stage:'待辦',priority:'高',dueDate:'2026-10-15',description:'請客戶資訊主管確認內部資料可使用範圍。'},admin);
 save(db,'tasks',{name:'官網表單整合',projectId:p.id,ownerId:member,stage:'進行中',priority:'中',dueDate:'2026-10-22'},admin);
 save(db,'tasks',{name:'展間素材清單確認',opportunityId:opps[1].id,ownerId:member,stage:'待確認',priority:'高',dueDate:'2026-10-13'},admin);
 save(db,'visits',{name:'GAME 需求訪談（示例）',companyId:c1.id,opportunityId:opps[0].id,date:'2026-10-09',method:'實體拜訪',attendees:'陳怡安、王志明、林業務（均為示例）',discussion:'客戶希望整合 SOP 與售後 FAQ。先以單一部門試行。',needs:'權限控管與來源追溯',competitors:'尚未確認',intent:'積極評估',budget:'320000',nextStep:'整理資料授權清單',followUpAt:'2026-10-15T10:00',ownerId:member},admin);
 save(db,'meetings',{name:'官網進度會議（示例）',companyId:c1.id,projectId:p.id,date:'2026-10-08',attendees:'客戶窗口、專案負責人（示例）',transcript:'窗口：素材下週交付。PM：表單先以測試資料完成串接。窗口：同意先驗收表單功能。',summary:'素材延遲，表單串接持續進行。',decisions:'先驗收表單功能',changes:'素材交付延後一週',risks:'素材可能影響整體上線時間',todos:'追蹤素材；完成表單測試',ownerId:member},admin);
 });
}


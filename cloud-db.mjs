import {randomUUID} from 'node:crypto';
import {ENTITIES,FIELDS,REF,validate,fail,TEMPLATES} from './domain.mjs';
export {passwordHash,passwordCheck} from './db.mjs';

// Only allowlisted identifiers are interpolated. All content uses SQL parameters.
export function adapter(client) {
 const sql=q=>{let i=0;return q.replaceAll('?',()=>'$'+(++i));};
 return {client,prepare(q){return {
  async get(...values){return (await client.query(sql(q),values)).rows[0];},
  async all(...values){return (await client.query(sql(q),values)).rows;},
  async run(...values){return client.query(sql(q),values);}
 };}};
}
export async function initialize(client) {
 await client.query(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')),password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,"recordId" TEXT,before TEXT,after TEXT,"createdAt" TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',"createdAt" TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,content TEXT NOT NULL,"createdAt" TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS login_attempts(id TEXT PRIMARY KEY,count INTEGER NOT NULL,time BIGINT NOT NULL);`);
 for(const type of ENTITIES) {
  const refs=Object.keys(FIELDS[type]).filter(k=>REF[k]).map(k=>`"${k}" TEXT REFERENCES ${REF[k]}(id)`);
  await client.query(`CREATE TABLE IF NOT EXISTS ${type}(id TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,"createdAt" TEXT NOT NULL,"updatedAt" TEXT NOT NULL${refs.length?','+refs.join(','):''}${type==='projects'?',"sourceOpportunityId" TEXT UNIQUE REFERENCES opportunities(id)':''});`);
 }
 await client.query('CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,bytes BYTEA NOT NULL); CREATE TABLE IF NOT EXISTS search_index(entity TEXT NOT NULL,"recordId" TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(entity,"recordId"));');
}
// Preserve camelCase fields used by the shared API when PostgreSQL parses identifiers.
export function quoteSql(q){return q.replace(/\b(userId|recordId|createdAt|updatedAt|companyId|opportunityId|projectId|visitId|meetingId|ownerId|sourceOpportunityId)\b/g,'"$1"');}
export function postgresAdapter(client){const base=adapter(client);return {...base,prepare:q=>base.prepare(quoteSql(q))};}
export const unpack=r=>r?{...JSON.parse(r.payload),id:r.id,version:r.version,createdAt:r.createdAt,updatedAt:r.updatedAt}:null;
export async function list(db,type){return (await db.prepare(`SELECT * FROM ${type} ORDER BY createdAt DESC`).all()).map(unpack);}
export async function get(db,type,id){return unpack(await db.prepare(`SELECT * FROM ${type} WHERE id=?`).get(id));}
export async function validateAsync(db,type,input,existing={}) {
 const cache=new Map();
 for(const [field,table] of Object.entries(REF)) {
  const id=input?.[field]??existing[field];if(!id)continue;
  const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(String(id));
  cache.set(table+':'+id,row);
 }
 return validate({prepare:q=>({get:id=>cache.get(q.match(/FROM (\w+)/)[1]+':'+id)})},type,input,existing);
}
export async function audit(db,userId,action,entity,recordId,before,after){await db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),userId,action,entity,recordId,JSON.stringify(before??null),JSON.stringify(after??null),new Date().toISOString());}
// A request owns its outer PostgreSQL transaction. Savepoints isolate tool errors.
export async function transaction(db,fn){const key='sp_'+randomUUID().replaceAll('-','');await db.client.query('SAVEPOINT '+key);try{const result=await fn();await db.client.query('RELEASE SAVEPOINT '+key);return result;}catch(e){await db.client.query('ROLLBACK TO SAVEPOINT '+key);await db.client.query('RELEASE SAVEPOINT '+key);throw e;}}
export async function save(db,type,input,userId,id=null,version=null,extra={}) {
 if(!ENTITIES.includes(type))fail('類型錯誤');
 const before=id?await get(db,type,id):null;if(id&&!before)fail('資料不存在',404);
 if(before&&version!==before.version)fail('資料已被修改，請重新整理後再操作',409);
 const data={...await validateAsync(db,type,input,before||{}),...extra};
 if(before?.companyId&&data.companyId!==before.companyId){const field={opportunities:'opportunityId',projects:'projectId',visits:'visitId',meetings:'meetingId'}[type];if(field)for(const t of ENTITIES)if(FIELDS[t][field]&&await db.prepare(`SELECT id FROM ${t} WHERE ${field}=? LIMIT 1`).get(id))fail('此紀錄已有關聯資料，不能改到其他公司');}
 if(type==='opportunities'&&before&&await db.prepare('SELECT id FROM projects WHERE sourceOpportunityId=?').get(id))if(data.stage!=='結案'||data.outcome!=='成交'||data.product!==before.product)fail('已轉專案的成交商機不能重新開案或變更產品');
 if(type==='projects'&&before?.opportunityId)data.opportunityId=before.opportunityId;
 if(type==='files'&&before)for(const k of ['storageKey','size','contentType','extractedText'])data[k]=before[k];
 const key=id||randomUUID(),now=new Date().toISOString(),refs=Object.keys(FIELDS[type]).filter(k=>REF[k]);
 if(before)await db.prepare(`UPDATE ${type} SET payload=?,version=version+1,updatedAt=?${refs.map(k=>`,${k}=?`).join('')} WHERE id=?`).run(JSON.stringify(data),now,...refs.map(k=>data[k]||null),key);
 else{const columns=['id','payload','createdAt','updatedAt',...refs,...(type==='projects'?['sourceOpportunityId']:[])];await db.prepare(`INSERT INTO ${type}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(key,JSON.stringify(data),now,now,...refs.map(k=>data[k]||null),...(type==='projects'?[data.opportunityId||null]:[]));}
 await db.prepare('DELETE FROM search_index WHERE entity=? AND recordId=?').run(type,key);
 await db.prepare('INSERT INTO search_index VALUES(?,?,?)').run(type,key,Object.values(data).join(' '));
 const after=await get(db,type,key);await audit(db,userId,before?'update':'create',type,key,before,after);return after;
}
export async function createProject(db,input,userId,extra={}){const p=await save(db,'projects',input,userId,null,null,extra);for(const [i,name] of TEMPLATES[p.product].entries())await save(db,'milestones',{name,projectId:p.id,stage:'待辦',description:`第 ${i+1} 階段，完成後由負責人確認驗收。`},userId);return p;}
export async function convert(db,id,userId){const o=await get(db,'opportunities',id);if(!o)fail('商機不存在',404);if(o.stage!=='結案'||o.outcome!=='成交')fail('僅成交商機可以轉專案');const existing=await db.prepare('SELECT * FROM projects WHERE sourceOpportunityId=?').get(id);if(existing)return unpack(existing);return transaction(db,async()=>{const p=await createProject(db,{name:o.name,companyId:o.companyId,product:o.product,ownerId:o.ownerId,stage:'啟動規劃',description:o.needs,risks:o.risks},userId,{opportunityId:id});await audit(db,userId,'convert','opportunities',id,o,{projectId:p.id});return p;});}

import {randomUUID} from 'node:crypto';
import {ENTITIES,FIELDS,REF,validate,fail,TEMPLATES} from './domain.mjs';
import {existingCompany} from './workflow.mjs';
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
  // Trash: soft-deleted rows keep their data; "trashRoot" names the record whose deletion moved them (type:id).
  await client.query(`ALTER TABLE ${type} ADD COLUMN IF NOT EXISTS "deletedAt" TEXT; ALTER TABLE ${type} ADD COLUMN IF NOT EXISTS "trashRoot" TEXT; CREATE INDEX IF NOT EXISTS ${type}_deleted_idx ON ${type}("deletedAt");`);
 }
 await client.query('CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,bytes BYTEA NOT NULL); CREATE TABLE IF NOT EXISTS search_index(entity TEXT NOT NULL,"recordId" TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(entity,"recordId"));');
}
// Preserve camelCase fields used by the shared API when PostgreSQL parses identifiers.
export function quoteSql(q){return q.replace(/\b(userId|recordId|createdAt|updatedAt|companyId|opportunityId|projectId|visitId|meetingId|ownerId|sourceOpportunityId|deletedAt|trashRoot)\b/g,'"$1"');}
export function postgresAdapter(client){const base=adapter(client);return {...base,prepare:q=>base.prepare(quoteSql(q))};}
export const unpack=r=>r?{...JSON.parse(r.payload),id:r.id,version:r.version,createdAt:r.createdAt,updatedAt:r.updatedAt}:null;
// Records in the trash are invisible to every normal read.
export async function list(db,type){return (await db.prepare(`SELECT * FROM ${type} WHERE deletedAt IS NULL ORDER BY createdAt DESC`).all()).map(unpack);}
export async function get(db,type,id){return unpack(await db.prepare(`SELECT * FROM ${type} WHERE id=? AND deletedAt IS NULL`).get(id));}
export async function validateAsync(db,type,input,existing={}) {
 const cache=new Map();
 for(const [field,table] of Object.entries(REF)) {
  const id=input?.[field]??existing[field];if(!id)continue;
  const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(String(id));
  cache.set(table+':'+id,row&&!row.deletedAt?row:undefined);
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
 if(type==='companies'&&existingCompany(await list(db,type),data,id))fail('公司名稱或統編已存在，請選擇既有公司',409);
 if(before?.companyId&&data.companyId!==before.companyId){const field={opportunities:'opportunityId',projects:'projectId',visits:'visitId',meetings:'meetingId'}[type];if(field)for(const t of ENTITIES)if(FIELDS[t][field]&&await db.prepare(`SELECT id FROM ${t} WHERE ${field}=? AND deletedAt IS NULL LIMIT 1`).get(id))fail('此紀錄已有關聯資料，不能改到其他公司');}
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
// ---------------------------------------------------------------------------
// Trash (soft delete). Deleting a record moves it, and everything that depends
// on it, to the trash as one batch. The batch can be restored together for
// TRASH_DAYS days; after that it is removed for good, together with any rows
// that would otherwise be left without their parent.
// ---------------------------------------------------------------------------
export const TRASH_DAYS=90;
// Every parent/child link between entity tables (users are never deleted, so they are skipped).
const CHILD_EDGES=(()=>{const edges=[];for(const child of ENTITIES)for(const column of Object.keys(FIELDS[child]))if(REF[column]&&REF[column]!=='users')edges.push({child,column,parent:REF[column]});edges.push({child:'projects',column:'sourceOpportunityId',parent:'opportunities'});return edges;})();
// Children first, so foreign keys never block a permanent delete.
const PURGE_ORDER=['files','tasks','milestones','meetings','visits','projects','opportunities','contacts','companies'];
const chunks=(items,size=400)=>{const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;};
const marks=ids=>ids.map(()=>'?').join(',');
const byType=(rows,type)=>rows.filter(x=>x.type===type).map(x=>x.id);
async function childrenOf(db,type,ids,activeOnly){
 const found=[];
 for(const edge of CHILD_EDGES.filter(e=>e.parent===type))for(const part of chunks(ids))for(const row of await db.prepare(`SELECT id FROM ${edge.child} WHERE ${edge.column} IN (${marks(part)})${activeOnly?' AND deletedAt IS NULL':''}`).all(...part))found.push({type:edge.child,id:row.id});
 return found;
}
// Follow parent→child links until nothing new is found.
async function closure(db,seeds,activeOnly){
 const seen=new Map(seeds.map(s=>[s.type+':'+s.id,s]));let frontier=[...seen.values()];
 while(frontier.length){const next=[];for(const type of ENTITIES){const ids=byType(frontier,type);if(!ids.length)continue;for(const child of await childrenOf(db,type,ids,activeOnly)){const key=child.type+':'+child.id;if(!seen.has(key)){seen.set(key,child);next.push(child);}}}frontier=next;}
 return [...seen.values()];
}
export async function trashRecord(db,type,id,userId,version){
 if(!ENTITIES.includes(type))fail('類型錯誤');
 const before=await get(db,type,id);if(!before)fail('資料不存在',404);
 if(version!==before.version)fail('資料版本已變更',409);
 const members=await closure(db,[{type,id}],true),root=type+':'+id,now=new Date().toISOString();
 for(const t of ENTITIES){const ids=byType(members,t);for(const part of chunks(ids)){
  await db.prepare(`UPDATE ${t} SET deletedAt=?,trashRoot=? WHERE id IN (${marks(part)})`).run(now,root,...part);
  await db.prepare(`DELETE FROM search_index WHERE entity=? AND recordId IN (${marks(part)})`).run(t,...part);
 }}
 await audit(db,userId,'trash',type,id,before,{moved:members.length});
 return {moved:members.length};
}
export async function trashList(db){
 const items=[],counts=new Map();
 for(const type of ENTITIES)for(const r of await db.prepare(`SELECT id,payload,deletedAt,trashRoot FROM ${type} WHERE deletedAt IS NOT NULL`).all()){
  counts.set(r.trashRoot,(counts.get(r.trashRoot)||0)+1);
  if(r.trashRoot===type+':'+r.id)items.push({type,id:r.id,name:JSON.parse(r.payload).name||'',deletedAt:r.deletedAt,purgeAt:new Date(Date.parse(r.deletedAt)+TRASH_DAYS*86400000).toISOString()});
 }
 return items.map(i=>({...i,count:counts.get(i.type+':'+i.id)||1})).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
}
export async function restoreRecord(db,type,id,userId){
 if(!ENTITIES.includes(type))fail('類型錯誤');
 const root=type+':'+id,row=await db.prepare(`SELECT id,payload,deletedAt,trashRoot FROM ${type} WHERE id=?`).get(id);
 if(!row||!row.deletedAt||row.trashRoot!==root)fail('垃圾桶中找不到此資料',404);
 if(type==='companies'){const clash=existingCompany(await list(db,'companies'),JSON.parse(row.payload),id);if(clash)fail('已有同名或同統編的公司「'+clash.name+'」，請先處理後再還原',409);}
 let restored=0;
 for(const t of ENTITIES){
  const rows=await db.prepare(`SELECT id,payload FROM ${t} WHERE trashRoot=?`).all(root);if(!rows.length)continue;
  await db.prepare(`UPDATE ${t} SET deletedAt=NULL,trashRoot=NULL WHERE trashRoot=?`).run(root);
  for(const r of rows){await db.prepare('DELETE FROM search_index WHERE entity=? AND recordId=?').run(t,r.id);await db.prepare('INSERT INTO search_index VALUES(?,?,?)').run(t,r.id,Object.values(JSON.parse(r.payload)).join(' '));}
  restored+=rows.length;
 }
 // A restored row must not point at something that is still in the trash.
 for(const e of CHILD_EDGES)if(await db.prepare(`SELECT c.id FROM ${e.child} c JOIN ${e.parent} p ON p.id=c.${e.column} WHERE c.deletedAt IS NULL AND p.deletedAt IS NOT NULL LIMIT 1`).get())fail('此資料關聯的其他資料仍在垃圾桶中，請先還原那些資料',409);
 await audit(db,userId,'restore',type,id,null,{restored});
 return {restored};
}
// Permanently remove the given rows plus everything that depends on them, in foreign-key-safe order.
async function purgeRows(db,seeds){
 const all=await closure(db,seeds,false);let removed=0;
 for(const t of PURGE_ORDER)for(const part of chunks(byType(all,t))){
  if(t==='files'){const keys=(await db.prepare(`SELECT payload FROM files WHERE id IN (${marks(part)})`).all(...part)).map(r=>JSON.parse(r.payload).storageKey).filter(Boolean);for(const k of chunks(keys))await db.prepare(`DELETE FROM attachments WHERE id IN (${marks(k)})`).run(...k);}
  await db.prepare(`DELETE FROM search_index WHERE entity=? AND recordId IN (${marks(part)})`).run(t,...part);
  await db.prepare(`DELETE FROM ${t} WHERE id IN (${marks(part)})`).run(...part);
  removed+=part.length;
 }
 return removed;
}
export async function purgeBatch(db,type,id,userId){
 if(!ENTITIES.includes(type))fail('類型錯誤');
 const root=type+':'+id,seeds=[];
 for(const t of ENTITIES)for(const r of await db.prepare(`SELECT id FROM ${t} WHERE trashRoot=?`).all(root))seeds.push({type:t,id:r.id});
 if(!seeds.some(s=>s.type===type&&s.id===id))fail('垃圾桶中找不到此資料',404);
 const removed=await purgeRows(db,seeds);await audit(db,userId,'trash_purge_now',type,id,null,{removed});return {removed};
}
export async function purgeExpired(db,userId,now=Date.now()){
 const cutoff=new Date(now-TRASH_DAYS*86400000).toISOString(),seeds=[];
 for(const t of ENTITIES)for(const r of await db.prepare(`SELECT id FROM ${t} WHERE deletedAt IS NOT NULL AND deletedAt<?`).all(cutoff))seeds.push({type:t,id:r.id});
 if(!seeds.length)return 0;
 const removed=await purgeRows(db,seeds);await audit(db,userId,'trash_purge','trash',null,null,{removed});return removed;
}
export async function createProject(db,input,userId,extra={}){const p=await save(db,'projects',input,userId,null,null,extra);for(const [i,name] of TEMPLATES[p.product].entries())await save(db,'milestones',{name,projectId:p.id,stage:'待辦',description:`第 ${i+1} 階段，完成後由負責人確認驗收。`},userId);return p;}
export async function convert(db,id,userId){const o=await get(db,'opportunities',id);if(!o)fail('商機不存在',404);if(o.stage!=='結案'||o.outcome!=='成交')fail('僅成交商機可以轉專案');const existing=await db.prepare('SELECT * FROM projects WHERE sourceOpportunityId=?').get(id);if(existing){if(existing.deletedAt)fail('此商機轉出的專案在垃圾桶中，請先到垃圾桶還原該專案',409);return unpack(existing);}return transaction(db,async()=>{const p=await createProject(db,{name:o.name,companyId:o.companyId,product:o.product,ownerId:o.ownerId,stage:'啟動規劃',description:o.needs,risks:o.risks},userId,{opportunityId:id});await audit(db,userId,'convert','opportunities',id,o,{projectId:p.id});return p;});}


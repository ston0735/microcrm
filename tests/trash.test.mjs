import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,seed} from '../db.mjs';
import {list,get,save,transaction,trashRecord,trashList,restoreRecord,purgeBatch,purgeExpired} from '../cloud-db.mjs';
import {search} from '../cloud-assistant.mjs';
import {handle} from '../cloud-handler.mjs';
import {ENTITIES,FIELDS} from '../domain.mjs';

// Runs the cloud code against SQLite (foreign keys ON), like cloud.test.mjs: it checks the logic, not a real PostgreSQL server.
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'microcrm-trash-test-')),raw=openDatabase(dir);seed(raw);
 raw.exec('CREATE TABLE attachments(id TEXT PRIMARY KEY,bytes BLOB);');
 const db={client:{async query(q){raw.exec(q);}},prepare(q){const stmt=raw.prepare(q.replaceAll('ILIKE','LIKE'));return {async get(...v){return stmt.get(...v);},async all(...v){return stmt.all(...v);},async run(...v){return stmt.run(...v);}};}};
 return {raw,db,admin:raw.prepare("SELECT * FROM users WHERE role='admin'").get(),close(){raw.close();rmSync(dir,{recursive:true,force:true});}};
}
const sizes=async db=>Object.fromEntries(await Promise.all(ENTITIES.map(async t=>[t,(await list(db,t)).length])));
const backdate=(raw,root)=>{for(const t of ENTITIES)raw.prepare(`UPDATE ${t} SET deletedAt='2000-01-01T00:00:00.000Z' WHERE trashRoot=?`).run(root);};
async function busiestCompany(db){const projects=await list(db,'projects');return get(db,'companies',projects[0].companyId);}

test('deleting a company moves it and everything under it to the trash; restoring brings it all back',async()=>{
 const {raw,db,admin,close}=setup();
 try{
  const company=await busiestCompany(db),before=await sizes(db);
  const contact=(await list(db,'contacts')).find(x=>x.companyId===company.id);
  assert.ok((await search(db,contact.name)).length>=1);
  const moved=await trashRecord(db,'companies',company.id,admin.id,company.version);
  assert.ok(moved.moved>1);
  assert.equal(await get(db,'companies',company.id),null);
  for(const t of ENTITIES)assert.equal((await list(db,t)).some(r=>r.companyId===company.id),false,t+' still visible');
  assert.equal((await search(db,contact.name)).length,0);
  const items=await trashList(db);
  assert.equal(items.length,1);assert.equal(items[0].type,'companies');assert.equal(items[0].count,moved.moved);
  const restored=await restoreRecord(db,'companies',company.id,admin.id);
  assert.equal(restored.restored,moved.moved);assert.deepEqual(await sizes(db),before);
  assert.ok((await search(db,contact.name)).length>=1);assert.equal((await trashList(db)).length,0);
 }finally{close();}
});

test('a stale version cannot delete, and trashed records cannot be referenced or edited',async()=>{
 const {db,admin,close}=setup();
 try{
  const company=await busiestCompany(db);
  await assert.rejects(trashRecord(db,'companies',company.id,admin.id,company.version+5),/版本已變更/);
  await trashRecord(db,'companies',company.id,admin.id,company.version);
  await assert.rejects(trashRecord(db,'companies',company.id,admin.id,company.version),/不存在/);
  await assert.rejects(save(db,'contacts',{name:'新聯絡人',companyId:company.id},admin.id),/不存在/);
 }finally{close();}
});

test('a record cannot be restored while something it belongs to is still in the trash',async()=>{
 const {db,admin,close}=setup();
 try{
  const project=(await list(db,'projects'))[0],company=await get(db,'companies',project.companyId);
  await trashRecord(db,'projects',project.id,admin.id,project.version);
  await trashRecord(db,'companies',company.id,admin.id,company.version);
  await assert.rejects(transaction(db,()=>restoreRecord(db,'projects',project.id,admin.id)),/仍在垃圾桶/);
  assert.equal((await trashList(db)).some(i=>i.type==='projects'&&i.id===project.id),true);
  await restoreRecord(db,'companies',company.id,admin.id);
  await restoreRecord(db,'projects',project.id,admin.id);
  assert.ok(await get(db,'projects',project.id));assert.equal((await trashList(db)).length,0);
 }finally{close();}
});

test('after 90 days the batch is removed for good, with attachments and any orphaned rows',async()=>{
 const {raw,db,admin,close}=setup();
 try{
  const company=await busiestCompany(db),root='companies:'+company.id;
  raw.prepare('INSERT INTO attachments VALUES(?,?)').run('blob-1',Buffer.from('x'));
  await save(db,'files',{name:'a.txt',companyId:company.id},admin.id,null,null,{storageKey:'blob-1',size:1,contentType:'x',extractedText:''});
  await trashRecord(db,'companies',company.id,admin.id,company.version);
  assert.equal(await purgeExpired(db,admin.id),0,'recent trash must be kept');
  assert.equal(raw.prepare('SELECT count(*) n FROM attachments').get().n,1);
  // Simulate an orphan: a child that is still active although its company is about to disappear.
  const contactId=raw.prepare('SELECT id FROM contacts WHERE trashRoot=?').get(root).id;
  raw.prepare('UPDATE contacts SET deletedAt=NULL,trashRoot=NULL WHERE id=?').run(contactId);
  backdate(raw,root);
  assert.ok(await purgeExpired(db,admin.id)>0);
  assert.equal(raw.prepare('SELECT count(*) n FROM companies WHERE id=?').get(company.id).n,0);
  assert.equal(raw.prepare('SELECT count(*) n FROM contacts WHERE id=?').get(contactId).n,0,'orphan removed with its company');
  for(const t of ENTITIES.filter(x=>FIELDS[x].companyId))assert.equal(raw.prepare(`SELECT count(*) n FROM ${t} WHERE companyId=?`).get(company.id).n,0,t);
  assert.equal(raw.prepare('SELECT count(*) n FROM attachments').get().n,0);
  assert.equal(raw.prepare("SELECT count(*) n FROM audit WHERE action='trash_purge'").get().n,1);
 }finally{close();}
});

test('admins can empty one trash item immediately',async()=>{
 const {raw,db,admin,close}=setup();
 try{
  const task=(await list(db,'tasks'))[0];
  await trashRecord(db,'tasks',task.id,admin.id,task.version);
  await assert.rejects(purgeBatch(db,'tasks','missing',admin.id),/找不到/);
  assert.equal((await purgeBatch(db,'tasks',task.id,admin.id)).removed,1);
  assert.equal(raw.prepare('SELECT count(*) n FROM tasks WHERE id=?').get(task.id).n,0);
 }finally{close();}
});

test('trash API: admin only, delete is soft, restore works, login clears expired trash',async()=>{
 const {raw,db,close}=setup();
 try{
  const call=async(method,url,body,headers={})=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,h){this.statusCode=code;Object.assign(this.headers,h);this.headersSent=true;},end(b){this.body=b;}};await handle({method,url,body,headers:{host:'localhost','content-type':'application/json',...headers},socket:{remoteAddress:'test'}},res,db);return res;};
  const signIn=async(email,password)=>{const r=await call('POST','/api/login',{email,password});assert.equal(r.statusCode,200);return {cookie:r.headers['Set-Cookie'],'x-csrf-token':JSON.parse(r.body).csrf};};
  const admin=await signIn('admin@game.local','GameDemo!2026'),member=await signIn('sales@game.local','SalesDemo!2026');
  const data=JSON.parse((await call('GET','/api/data',undefined,admin)).body);
  assert.equal(data.meta.version,'1.0.0');assert.equal(data.meta.trashDays,90);
  const company=data.companies.find(c=>data.projects.some(p=>p.companyId===c.id));
  assert.equal((await call('DELETE','/api/records/companies/'+company.id,{version:company.version},member)).statusCode,403);
  assert.equal((await call('GET','/api/trash',undefined,member)).statusCode,403);
  assert.equal((await call('DELETE','/api/records/companies/'+company.id,{version:company.version+1},admin)).statusCode,409);
  const deleted=await call('DELETE','/api/records/companies/'+company.id,{version:company.version},admin);
  assert.equal(deleted.statusCode,200);assert.ok(JSON.parse(deleted.body).moved>1);
  assert.equal(JSON.parse((await call('GET','/api/data',undefined,admin)).body).companies.some(c=>c.id===company.id),false);
  const trash=JSON.parse((await call('GET','/api/trash',undefined,admin)).body);assert.equal(trash[0].id,company.id);
  assert.equal((await call('POST','/api/trash/restore',{type:'companies',id:company.id},member)).statusCode,403);
  assert.equal((await call('POST','/api/trash/restore',{type:'companies',id:company.id},admin)).statusCode,200);
  assert.equal(JSON.parse((await call('GET','/api/data',undefined,admin)).body).companies.some(c=>c.id===company.id),true);
  assert.equal((await call('POST','/api/trash/restore',{type:'companies',id:company.id},admin)).statusCode,404);
  // Delete again, make it 91 days old, and let the next login clean it up.
  const again=JSON.parse((await call('GET','/api/data',undefined,admin)).body).companies.find(c=>c.id===company.id);
  await call('DELETE','/api/records/companies/'+company.id,{version:again.version},admin);backdate(raw,'companies:'+company.id);
  await signIn('admin@game.local','GameDemo!2026');
  assert.equal(raw.prepare('SELECT count(*) n FROM companies WHERE id=?').get(company.id).n,0);
 }finally{close();}
});

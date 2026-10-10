import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,seed} from '../db.mjs';
import {list,get,save,convert,postgresAdapter,quoteSql} from '../cloud-db.mjs';
import {createDraft,resolveDraft,chat,search} from '../cloud-assistant.mjs';
import {handle} from '../cloud-handler.mjs';
// This verifies asynchronous application logic, not a real PostgreSQL deployment.
test('cloud async workflow preserves conversion, draft confirmation, roles, attachments and login',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'microcrm-cloud-test-')),raw=openDatabase(dir);seed(raw);
 raw.exec('CREATE TABLE login_attempts(id TEXT PRIMARY KEY,count INTEGER,time INTEGER); CREATE TABLE attachments(id TEXT PRIMARY KEY,bytes BLOB);');
 const db={client:{async query(q){raw.exec(q);}},prepare(q){const stmt=raw.prepare(q.replaceAll('ILIKE','LIKE'));return {async get(...v){return stmt.get(...v);},async all(...v){return stmt.all(...v);},async run(...v){return stmt.run(...v);}};}};
 try{
  const user=raw.prepare("SELECT * FROM users WHERE role='admin'").get(),viewer=raw.prepare("SELECT * FROM users WHERE role='viewer'").get();
  const opp=(await list(db,'opportunities')).find(o=>o.stage==='新商機');
  const won=await save(db,'opportunities',{stage:'結案',outcome:'成交'},user.id,opp.id,opp.version);
  const p=await convert(db,won.id,user.id);assert.equal((await convert(db,won.id,user.id)).id,p.id);assert.equal((await list(db,'milestones')).filter(m=>m.projectId===p.id).length,6);
  await assert.rejects(save(db,'opportunities',{stage:'需求洽談'},user.id,won.id,won.version),/不能重新/);
  const draft=await createDraft(db,user,{kind:'create_task',data:{name:'雲端草稿驗證',projectId:p.id,ownerId:user.id,stage:'待辦'}});
  assert.equal((await list(db,'tasks')).some(t=>t.name==='雲端草稿驗證'),false);
  await assert.rejects(resolveDraft(db,viewer,draft.id,'confirm'),/唯讀/);
  await resolveDraft(db,user,draft.id,'confirm');await assert.rejects(resolveDraft(db,user,draft.id,'confirm'),/已處理/);
  assert.equal((await search(db,'雲端草稿'))[0].record.name,'雲端草稿驗證');
  assert.equal((await chat(db,user,'查詢目前進度')).mode,'demo');
  const call=async(method,url,body,headers={})=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,h){this.statusCode=code;Object.assign(this.headers,h);this.headersSent=true;},end(b){this.body=b;}};await handle({method,url,body,headers:{host:'localhost','content-type':'application/json',...headers},socket:{remoteAddress:'test'}},res,db);return res;};
  const login=await call('POST','/api/login',{email:'admin@game.local',password:'GameDemo!2026'});assert.equal(login.statusCode,200);const auth={'cookie':login.headers['Set-Cookie'],'x-csrf-token':JSON.parse(login.body).csrf};
  const data=await call('GET','/api/data',undefined,auth);assert.equal(JSON.parse(data.body).meta.uploadLimitMb,3);
  const uploaded=await call('POST','/api/uploads',{name:'cloud.txt',content:Buffer.from('雲端附件內文').toString('base64')},auth);assert.equal(uploaded.statusCode,201);const file=JSON.parse(uploaded.body);
  const download=await call('GET',`/api/files/${file.id}/download`,undefined,auth);assert.equal(Buffer.from(download.body).toString(),'雲端附件內文');
  assert.equal((await search(db,'附件內文')).length,1);
  const bad=await call('POST','/api/login',{email:'admin@game.local',password:'wrong'});assert.equal(bad.statusCode,401);assert.equal(raw.prepare('SELECT count FROM login_attempts').get().count,1);
 }finally{raw.close();rmSync(dir,{recursive:true,force:true});}
});
test('PostgreSQL adapter quotes metadata and parameterizes values',async()=>{
 let capture;const db=postgresAdapter({async query(sql,values){capture={sql,values};return {rows:[{id:'a'}]};}});
 await db.prepare('SELECT userId,createdAt FROM sessions WHERE id=? AND expires>?').get("'; DROP TABLE users;--",0);
 assert.equal(capture.sql,'SELECT "userId","createdAt" FROM sessions WHERE id=$1 AND expires>$2');assert.equal(capture.values[0],"'; DROP TABLE users;--");
 assert.equal(quoteSql('SELECT companyId FROM projects'),'SELECT "companyId" FROM projects');
});

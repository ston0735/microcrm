import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,seed,list,get,save,transaction,convert,passwordCheck} from '../db.mjs';
import {createDraft,resolveDraft,search,chat} from '../assistant.mjs';
test('CRM domain: relations, templates, optimistic locking, search and audited draft confirmation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'game-domain-'));const db=openDatabase(dir);
 try {
 seed(db);const admin=db.prepare("SELECT * FROM users WHERE role='admin'").get();const viewer=db.prepare("SELECT * FROM users WHERE role='viewer'").get();
 assert(passwordCheck('GameDemo!2026',admin.password));assert.equal(list(db,'companies').length,3);assert.equal(list(db,'contacts').length,2);
 const o=list(db,'opportunities').find(o=>o.product==='GAME 系統'&&o.stage==='方案提案');
 assert.throws(()=>save(db,'opportunities',{stage:'結案'},admin.id,o.id,o.version),/結案必須/);
 assert.throws(()=>save(db,'tasks',{name:'bad',ownerId:'missing',stage:'待辦'},admin.id),/不存在/);
 const updated=transaction(db,()=>save(db,'opportunities',{stage:'結案',outcome:'成交'},admin.id,o.id,o.version));
 assert.throws(()=>save(db,'opportunities',{needs:'stale'},admin.id,o.id,o.version),/已被修改/);
 const project=convert(db,o.id,admin.id);assert.equal(list(db,'milestones').filter(m=>m.projectId===project.id).length,6);
 assert.equal(convert(db,o.id,admin.id).id,project.id);assert.equal(get(db,'projects',project.id).opportunityId,o.id);
 assert.throws(()=>save(db,'opportunities',{stage:'新商機'},admin.id,o.id,updated.version),/已轉專案/);
 const otherCompany=list(db,'companies').find(c=>c.id!==o.companyId);
 assert.throws(()=>save(db,'opportunities',{companyId:otherCompany.id},admin.id,o.id,updated.version),/已有關聯資料/);
 assert.equal(search(db,'GAME').length>0,true);assert.equal(search(db,'素材').length>0,true);assert.equal(search(db,'星河製造').length>0,true);
 const task={name:'確認資料授權',projectId:project.id,ownerId:admin.id,stage:'待辦',description:'測試草稿'};
 assert.throws(()=>createDraft(db,viewer,{kind:'create_task',data:task}),/唯讀/);
 const count=list(db,'tasks').length,d=createDraft(db,admin,{kind:'create_task',data:task});assert.equal(list(db,'tasks').length,count);
 assert.throws(()=>resolveDraft(db,viewer,d.id,'confirm'),/唯讀/);
 const result=resolveDraft(db,admin,d.id,'confirm');assert.equal(result.status,'confirmed');assert.equal(list(db,'tasks').length,count+1);
 assert.throws(()=>resolveDraft(db,admin,d.id,'confirm'),/已處理/);
 const reject=createDraft(db,admin,{kind:'create_task',data:task});resolveDraft(db,admin,reject.id,'reject');assert.equal(list(db,'tasks').length,count+1);
 const p=get(db,'projects',project.id);const stale=createDraft(db,admin,{kind:'update_stage',entity:'projects',id:p.id,stage:'需求確認'});
 transaction(db,()=>save(db,'projects',{risks:'new risk'},admin.id,p.id,p.version));assert.throws(()=>resolveDraft(db,admin,stale.id,'confirm'),/已被修改/);
 assert.equal(db.prepare('SELECT status FROM drafts WHERE id=?').get(stale.id).status,'pending');
 assert(db.prepare("SELECT count(*) n FROM audit WHERE action='draft_confirm'").get().n>0);
 assert.throws(()=>transaction(db,()=>db.prepare('DELETE FROM companies WHERE id=?').run(o.companyId)),/FOREIGN KEY/);
 const reply=await chat(db,admin,'GAME');assert.equal(reply.mode,'demo');assert.match(reply.answer,/並非真實 AI/);
 assert.equal(updated.outcome,'成交');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Responses adapter: mocked tool cycle only proposes a draft, reports provider failures',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'game-ai-'));const db=openDatabase(dir);seed(db);
 const originalFetch=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-not-a-real-key';
 try {
 const admin=db.prepare("SELECT * FROM users WHERE role='admin'").get(),o=list(db,'opportunities')[0],count=list(db,'tasks').length;let step=0;
 globalThis.fetch=async(url,options)=>{
 assert.equal(url,'https://api.openai.com/v1/responses');const request=JSON.parse(options.body);assert.equal(request.store,false);assert(request.tools.some(t=>t.name==='propose_task'));
 if(step++===0)return {ok:true,json:async()=>({output:[{type:'function_call',name:'propose_task',call_id:'call1',arguments:JSON.stringify({name:'模型建議任務',opportunityId:o.id,projectId:'',ownerId:admin.id,dueDate:'2026-11-01',description:'測試模型工具草稿'})}]})};
 assert(request.input.some(i=>i.type==='function_call_output'&&i.call_id==='call1'));
 return {ok:true,json:async()=>({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'已提出草稿，尚未建立任務，請確認。'}]}]})};
 };
 const reply=await chat(db,admin,'建立任務');assert.equal(reply.mode,'live');assert.equal(reply.drafts.length,1);assert.equal(list(db,'tasks').length,count);assert.match(reply.answer,/尚未建立/);
 resolveDraft(db,admin,reply.drafts[0].id,'confirm');assert.equal(list(db,'tasks').length,count+1);
 globalThis.fetch=async()=>({ok:false,status:401});await assert.rejects(()=>chat(db,admin,'查詢'),/AI 服務失敗/);
 }finally {globalThis.fetch=originalFetch;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;db.close();rmSync(dir,{recursive:true,force:true});}
});


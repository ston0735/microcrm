import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,seed} from '../db.mjs';
import * as repo from '../cloud-db.mjs';
import {quickOpportunity,csvExport} from '../workflow.mjs';
import {lookupCompany,enrichCompany,registryUrl,limitLookup} from '../company-lookup.mjs';
test('inline company/contact/opportunity is atomic, reuses identity and enforces roles',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'microcrm-inline-')),raw=openDatabase(dir);seed(raw);
 const db={client:{async query(q){raw.exec(q);}},prepare(q){const stmt=raw.prepare(q);return {async get(...v){return stmt.get(...v);},async all(...v){return stmt.all(...v);},async run(...v){return stmt.run(...v);}};}};
 try{const admin=raw.prepare("SELECT * FROM users WHERE role='admin'").get(),viewer={...admin,role:'viewer'};
  const payload={company:{name:'原子交易測試公司',taxId:'12345678',phone:'02-12345678'},contact:{name:'公開業務窗口',email:'sales@example.com'},opportunity:{name:'快速新增測試',ownerId:admin.id,product:'GAME 系統',stage:'新商機'}};
  const a=await quickOpportunity(db,repo,admin,payload);assert.equal(a.contact.companyId,a.company.id);assert.equal(a.opportunity.companyId,a.company.id);assert.equal(a.company.phone,'02-12345678');
  const b=await quickOpportunity(db,repo,admin,{...payload,company:{...payload.company,address:'不得覆蓋'},contact:{},opportunity:{...payload.opportunity,name:'另一個商機'}});assert.equal(b.reused,true);assert.equal(b.company.id,a.company.id);assert.equal(b.company.address,'');
  const before=(await repo.list(db,'companies')).length;await assert.rejects(quickOpportunity(db,repo,admin,{...payload,company:{name:'不應留下的公司'},opportunity:{...payload.opportunity,stage:'不存在'}}),/階段錯誤/);assert.equal((await repo.list(db,'companies')).length,before);
  await assert.rejects(quickOpportunity(db,repo,admin,{...payload,company:{name:'聯絡人失敗應回復'},contact:{name:'錯誤聯絡人',email:'invalid'}}),/Email/);assert.equal((await repo.list(db,'companies')).length,before);
  await assert.rejects(quickOpportunity(db,repo,viewer,payload),/僅可檢視/);
  await assert.rejects(repo.save(db,'companies',{name:'另一名稱',taxId:'12345678'},admin.id),/已存在/);
  await assert.rejects(repo.save(db,'companies',{name:'錯誤統編',taxId:'123'},admin.id),/8 碼/);
  await assert.rejects(repo.save(db,'tasks',{name:'不存在日期',stage:'待辦',ownerId:admin.id,dueDate:'2026-02-31'},admin.id),/日期不存在/);
  for(let i=0;i<20;i++)await limitLookup(db,admin.id);await assert.rejects(limitLookup(db,admin.id),/過於頻繁/);
 }finally{raw.close();rmSync(dir,{recursive:true,force:true});}
});
test('registry query is fixed host, validates syntax, preserves source and never invents phone',async()=>{
 assert.equal(registryUrl('20828393').hostname,'data.gcis.nat.gov.tw');assert.match(registryUrl('精冠智能').searchParams.get('$filter'),/Company_Name like/);
 assert.throws(()=>registryUrl("公司' or 1=1"),/公司名稱/);assert.throws(()=>registryUrl('a'),/至少 2/);
 const fake=async()=>({ok:true,text:async()=>JSON.stringify([{Company_Name:'測試股份有限公司',Business_Accounting_NO:'20828393',Company_Location:'台北市',Company_Status_Desc:'核准設立'}])});
 const found=await lookupCompany('20828393',fake);assert.equal(found.candidates[0].phone,'');assert.equal(found.candidates[0].address,'台北市');assert.match(found.candidates[0].sourceUrl,/^https:\/\/data\.gcis/);
 await assert.rejects(lookupCompany('20828393',async()=>{throw new Error('timeout');}),/手動填寫/);
});
test('AI enrichment requires identity and actual search citations; no-key mode is explicit',async()=>{
 const before=process.env.OPENAI_API_KEY;try{delete process.env.OPENAI_API_KEY;await assert.rejects(enrichCompany({name:'測試',taxId:'20828393'}),/尚未啟用/);process.env.OPENAI_API_KEY='mock-key';
  const candidate={name:'測試公司',taxId:'20828393',address:'台北市'},source='https://example.com/contact';
  const fake=async()=>({ok:true,json:async()=>({output:[{type:'web_search_call',action:{sources:[{url:source}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({identityVerified:true,phone:{value:'02-12345678',sourceUrl:source},website:{value:'https://unproven.example',sourceUrl:'https://unproven.example'}})}]}]})});
  const result=await enrichCompany(candidate,fake);assert.equal(result.fields.phone,'02-12345678');assert.equal(result.fields.website,'');assert.equal(result.sources.length,1);
  await assert.rejects(enrichCompany({name:'測試'},fake),/先選擇/);
 }finally{if(before===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=before;}
});
test('CSV export escapes spreadsheet formulas and quoted content',()=>{const csv=csvExport('companies',[{name:'=HYPERLINK("bad")',notes:'多行\n測試'}]);assert.match(csv,/"'=HYPERLINK\(""bad""\)"/);assert.match(csv,/"多行\n測試"/);assert.throws(()=>csvExport('users',[]),/類型錯誤/);});


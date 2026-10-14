import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,seed} from '../db.mjs';
import {list} from '../cloud-db.mjs';
import {loadDemo,clearDemo,schedulePm,checkStockMove,nextQuoteNo,saveSettings,stockOf} from '../service.mjs';
// Cross-department rules: demo data, PM scheduling, part compatibility, stock and quote numbering.
test('service rules',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'microcrm-svc-')),raw=openDatabase(dir);seed(raw);
 const db={client:{async query(q){raw.exec(q);}},prepare(q){const s=raw.prepare(q.replaceAll('ILIKE','LIKE'));return {async get(...v){return s.get(...v);},async all(...v){return s.all(...v);},async run(...v){return s.run(...v);}};}};
 try{
  const user=raw.prepare("SELECT * FROM users WHERE role='admin'").get(),before=(await list(db,'companies')).length;
  await loadDemo(db,user);await assert.rejects(loadDemo(db,user),/已載入/);
  const contract=(await list(db,'contracts')).find(c=>c.name.includes('ProX'));
  assert.equal((await schedulePm(db,contract.id,user.id)).length,4);await assert.rejects(schedulePm(db,contract.id,user.id),/未重複/);
  const products=await list(db,'products'),itx=products.find(p=>p.sku==='PW-1179617'),fil=products.find(p=>p.sku==='CEB6-PH');
  const ticket=(await list(db,'tickets')).find(t=>t.errorCode==='E-VAC-01');
  await assert.rejects(checkStockMove(db,{productId:itx.id,kind:'維修領用',qty:'1',ticketId:ticket.id},null),/不相容/);
  await assert.rejects(checkStockMove(db,{productId:fil.id,kind:'維修領用',qty:String(await stockOf(db,fil.id)+1),ticketId:ticket.id},null),/庫存不足/);
  await checkStockMove(db,{productId:fil.id,kind:'維修領用',qty:'1',ticketId:ticket.id},null);
  await saveSettings(db,{quotePrefix:'KCT'});assert.equal(await nextQuoteNo(db,'2026-01-02'),'KCT-20260102-001');
  await assert.rejects(saveSettings(db,{quotePrefix:'K-T'}),/英數/);
  await clearDemo(db,user);assert.equal((await list(db,'companies')).length,before);assert.equal((await list(db,'tickets')).length,0);
 }finally{raw.close();rmSync(dir,{recursive:true,force:true});}
});

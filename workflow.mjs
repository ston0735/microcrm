import {fail,FIELDS} from './domain.mjs';
import {normalizeName} from './company-lookup.mjs';
export function existingCompany(rows,input,excludeId){
 const matches=rows.filter(r=>r.id!==excludeId);
 const tax=String(input.taxId||'').trim(),name=normalizeName(input.name);
 return matches.find(r=>tax&&r.taxId===tax)||matches.find(r=>name&&normalizeName(r.name)===name);
}
// The caller provides a local or PostgreSQL repository; all related writes share one transaction.
export async function quickOpportunity(db,repo,user,body){
 if(user.role==='viewer')fail('此帳號僅可檢視',403);
 if(!body?.company||!body?.opportunity)fail('請填寫公司與商機資料');
 return repo.transaction(db,async()=>{
  const input=body.company;if(!String(input.name||'').trim())fail('請填寫公司名稱；查到統編後仍須確認公司名稱');
  const found=existingCompany(await repo.list(db,'companies'),input);
  if(found&&input.taxId&&found.taxId&&input.taxId!==found.taxId)fail('相同公司名称已有不同統編，請選擇正確既有公司或檢查名稱',409);
  const company=found||await repo.save(db,'companies',input,user.id);
  const opportunity=await repo.save(db,'opportunities',{...body.opportunity,companyId:company.id},user.id,body.id||null,body.version??null);
  let contact=null;if(body.contact?.name)contact=await repo.save(db,'contacts',{...body.contact,companyId:company.id},user.id);
  return {company,opportunity,contact,reused:!!found};
 });
}
export function csvExport(type,rows){if(!FIELDS[type])fail('類型錯誤');const columns=['id',...Object.keys(FIELDS[type]),'version','createdAt','updatedAt'];const quote=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';return '\ufeff'+[columns.map(k=>FIELDS[type][k]||k),...rows.map(r=>columns.map(k=>r[k]))].map(row=>row.map(quote).join(',')).join('\r\n');}


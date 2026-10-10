import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('HTTP: login, CSRF, permissions, CRUD, file text search, history and sessions',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'game-http-'));const child=spawn(process.execPath,['local-server.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,SEED_DEMO:'1',ADMIN_PASSWORD:'GameDemo!2026',ADMIN_EMAIL:'admin@game.local',OPENAI_API_KEY:'',COOKIE_SECURE:'0'},stdio:['ignore','pipe','pipe']});
 let base;try {
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out')),20000);child.stdout.on('data',b=>{const m=/http:\/\/127.0.0.1:\d+/.exec(String(b));if(m){clearTimeout(timer);resolve(m[0]);}});child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});child.stderr.on('data',()=>{});});
 const request=async(path,{method='GET',body,cookie,csrf,origin}={})=>{const res=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(origin?{Origin:origin}:{})},body:body!==undefined?JSON.stringify(body):undefined});return {res,data:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};};
 assert.equal((await request('/')).res.status,200);assert.equal((await request('/api/data')).res.status,401);
 assert.equal((await request('/api/login',{method:'POST',body:{email:'admin@game.local',password:'wrong'}})).res.status,401);
 const login=await request('/api/login',{method:'POST',body:{email:'admin@game.local',password:'GameDemo!2026'}});assert.equal(login.res.status,200);
 const auth={cookie:login.res.headers.get('set-cookie').split(';')[0],csrf:login.data.csrf};
 const initial=(await request('/api/data',auth)).data;assert.equal(initial.meta.mode,'demo');assert.equal(initial.companies.length,3);
 assert.equal((await request('/api/records/companies',{...auth,csrf:'',method:'POST',body:{name:'blocked'}})).res.status,403);
 assert.equal((await request('/api/records/companies',{...auth,origin:'https://evil.example',method:'POST',body:{name:'blocked'}})).res.status,403);
 const created=await request('/api/records/companies',{...auth,method:'POST',body:{name:'HTTP 測試公司',industry:'測試'}});assert.equal(created.res.status,201);
 const company=created.data;assert.equal((await request('/api/records/companies/'+company.id,{...auth,method:'PATCH',body:{version:1,name:'新名稱'}})).res.status,200);
 const manualProject=await request('/api/records/projects',{...auth,method:'POST',body:{name:'手動 PMS 專案',companyId:company.id,product:'PMS 專案管理',stage:'啟動規劃',ownerId:login.data.user.id}});assert.equal(manualProject.res.status,201);
 const projectData=(await request('/api/data',auth)).data;assert.equal(projectData.milestones.filter(m=>m.projectId===manualProject.data.id).length,6);
 assert.equal((await request('/api/records/companies/'+company.id,{...auth,method:'PATCH',body:{version:1,name:'過期'}})).res.status,409);
 const viewer=await request('/api/login',{method:'POST',body:{email:'viewer@game.local',password:'ViewDemo!2026'}});const viewAuth={cookie:viewer.res.headers.get('set-cookie').split(';')[0],csrf:viewer.data.csrf};
 assert.equal((await request('/api/records/companies',{...viewAuth,method:'POST',body:{name:'bad'}})).res.status,403);
 const viewData=(await request('/api/data',viewAuth)).data;assert.equal(viewData.audit.length,0);
 const upload=await request('/api/uploads',{...auth,method:'POST',body:{name:'notes.txt',companyId:company.id,description:'測試附件',content:Buffer.from('檔案全文搜尋驗收').toString('base64')}});assert.equal(upload.res.status,201);
 assert((await request('/api/search?q='+encodeURIComponent('全文搜尋驗收'),auth)).data.some(r=>r.record.id===upload.data.id));
 const download=await request('/api/files/'+upload.data.id+'/download',auth);assert.equal(download.data,'檔案全文搜尋驗收');
 assert.equal((await request('/api/records/companies/'+company.id,{...auth,method:'DELETE',body:{version:2}})).res.status,409);
 const task={name:'API 草稿測試',ownerId:login.data.user.id,stage:'待辦'};
 const draft=await request('/api/drafts',{...auth,method:'POST',body:{kind:'create_task',data:task}});assert.equal(draft.res.status,201);
 assert.equal((await request('/api/drafts/'+draft.data.id,{...viewAuth,method:'POST',body:{decision:'confirm'}})).res.status,403);
 assert.equal((await request('/api/drafts/'+draft.data.id,{...auth,method:'POST',body:{decision:'confirm'}})).res.status,200);
 assert.equal((await request('/api/drafts/'+draft.data.id,{...auth,method:'POST',body:{decision:'confirm'}})).res.status,409);
 assert.equal((await request('/api/chat',{...auth,method:'POST',body:{message:'GAME'}})).data.mode,'demo');
 const final=(await request('/api/data',auth)).data;assert(final.chats.length>=2);assert(final.audit.some(a=>a.action==='draft_confirm'));
 assert.equal((await request('/api/logout',{...auth,method:'POST',body:{}})).res.status,200);assert.equal((await request('/api/data',auth)).res.status,401);
 }finally {child.kill();await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true,force:true});}
});


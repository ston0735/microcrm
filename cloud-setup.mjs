import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {initialize,postgresAdapter,passwordHash,save,createProject} from './cloud-db.mjs';
if(!process.env.DATABASE_URL)throw new Error('請先連接 microcrm 的 PostgreSQL，設定 DATABASE_URL。');
if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<16||process.env.ADMIN_PASSWORD.length>200||/^(GameDemo|SalesDemo|ViewDemo)/.test(process.env.ADMIN_PASSWORD))throw new Error('請設定 ADMIN_EMAIL 與 16–200 字元的專用 ADMIN_PASSWORD；雲端禁止示例密碼。');
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL))throw new Error('ADMIN_EMAIL 格式錯誤。');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(73142026)');
 await client.query('CREATE SCHEMA IF NOT EXISTS microcrm');await client.query('SET LOCAL search_path TO microcrm');
 await initialize(client);const db=postgresAdapter(client);
 const existing=await db.prepare('SELECT id FROM users LIMIT 1').get();
 if(!existing){
  const id=randomUUID();await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,'系統管理員',process.env.ADMIN_EMAIL.toLowerCase(),'admin',passwordHash(process.env.ADMIN_PASSWORD));
  if(process.env.SEED_DEMO==='1'){
   const c=await save(db,'companies',{name:'星河製造（示例）',industry:'智慧製造',notes:'虛構示例，金額與進度不代表真實業績。'},id);
   await save(db,'contacts',{name:'陳怡安（示例）',companyId:c.id,email:'chen@example.com',title:'需求窗口'},id);
   for(const product of ['GAME 系統','虛擬展間','PMS 專案管理','客製化網站／軟體'])await save(db,'opportunities',{name:product+'導入（示例）',companyId:c.id,ownerId:id,product,stage:'需求洽談',needs:'確認使用場景與驗收範圍',nextStep:'安排需求會議'},id);
   const p=await createProject(db,{name:'企業官網（示例）',companyId:c.id,ownerId:id,product:'客製化網站／軟體',stage:'啟動規劃',description:'全部內容均為虛構示例'},id);
   await save(db,'tasks',{name:'確認驗收範圍（示例）',projectId:p.id,ownerId:id,stage:'待辦',priority:'中'},id);
   await save(db,'visits',{name:'需求拜訪（示例）',companyId:c.id,ownerId:id,date:'2026-10-10',method:'視訊',discussion:'確認導入目標與窗口；內容皆為示例',nextStep:'整理需求清單'},id);
   await save(db,'meetings',{name:'啟動會議（示例）',companyId:c.id,projectId:p.id,ownerId:id,date:'2026-10-10',transcript:'示例窗口：先確認需求。示例 PM：同意。',summary:'確認需求優先',decisions:'安排需求盤點'},id);
  }
 }
 await client.query('COMMIT');console.log('microcrm 雲端資料表已就緒；既有資料與密碼不會被示例種子覆蓋。');
}catch(e){try{await client.query('ROLLBACK');}catch{}console.error('microcrm 資料庫初始化失敗；請檢查專案環境變數與資料庫權限。');process.exitCode=1;}finally{await client.end();}


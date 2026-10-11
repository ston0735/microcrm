import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {initialize,postgresAdapter,passwordHash,save,createProject} from './cloud-db.mjs';
if(!process.env.DATABASE_URL)throw new Error('請先連接 microcrm 的 PostgreSQL，設定 DATABASE_URL。');
if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<16||process.env.ADMIN_PASSWORD.length>200||/^(GameDemo|SalesDemo|ViewDemo)/.test(process.env.ADMIN_PASSWORD))throw new Error('請設定 ADMIN_EMAIL 與 16–200 字元的專用 ADMIN_PASSWORD；雲端禁止使用預設弱密碼。');
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL))throw new Error('ADMIN_EMAIL 格式錯誤。');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(73142026)');
 await client.query('CREATE SCHEMA IF NOT EXISTS microcrm');await client.query('SET LOCAL search_path TO microcrm');
 await initialize(client);const db=postgresAdapter(client);
 const existing=await db.prepare('SELECT id FROM users LIMIT 1').get();
 if(!existing){
  const id=randomUUID();await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,'系統管理員',process.env.ADMIN_EMAIL.toLowerCase(),'admin',passwordHash(process.env.ADMIN_PASSWORD));
 }
 await client.query('COMMIT');console.log('microcrm 雲端資料表已就緒；既有資料與密碼不會被覆蓋。');
}catch(e){try{await client.query('ROLLBACK');}catch{}console.error('microcrm 資料庫初始化失敗；請檢查專案環境變數與資料庫權限。');process.exitCode=1;}finally{await client.end();}


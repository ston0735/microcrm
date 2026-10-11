import pg from 'pg';
import {postgresAdapter} from '../cloud-db.mjs';
import {handle} from '../cloud-handler.mjs';
export const config={maxDuration:60};
// Hold responses until COMMIT succeeds: a failed commit must never look like a saved record.
export function bufferedResponse(){return {statusCode:200,headersSent:false,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},writeHead(s,h={}){this.statusCode=s;Object.assign(this.headers,h);this.headersSent=true;},end(b){this.body=b;}};}
export default async function handler(req,res){
 const result=bufferedResponse();let client;
 try{
  if(!process.env.DATABASE_URL)throw new Error('configuration');
  const url=new URL(req.url,'https://localhost');const route=req.query?.route||url.searchParams.get('route');if(route){url.searchParams.delete('route');const qs=url.searchParams.toString();req.url='/api/'+(Array.isArray(route)?route.join('/'):route)+(qs?'?'+qs:'');}
  client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});await client.connect();
  await client.query('BEGIN');await client.query('SET LOCAL search_path TO microcrm');
  await client.query("SET LOCAL statement_timeout TO '15000'");
  if(!['GET','HEAD'].includes(req.method)&&new URL(req.url,'https://localhost').pathname!=='/api/company-enrich')await client.query('SELECT pg_advisory_xact_lock(73142026)');
  await handle(req,result,postgresAdapter(client));
  // Failed logins persist the rate counter; all other failed writes roll back.
  const keep=result.statusCode<400||(new URL(req.url,'https://localhost').pathname==='/api/login'&&result.statusCode===401);
  await client.query(keep?'COMMIT':'ROLLBACK');
  res.writeHead(result.statusCode,result.headers);res.end(result.body);
 }catch{
  if(client)try{await client.query('ROLLBACK');}catch{}
  if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'雲端資料庫尚未就緒或暫時無法連線，請檢查 DATABASE_URL 與部署的初始化結果。'}));}
 }finally{if(client)await client.end().catch(()=>{});}
}


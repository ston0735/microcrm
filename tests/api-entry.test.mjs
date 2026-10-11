import test from 'node:test';
import assert from 'node:assert/strict';
// Mirrors the URL rewrite in api/index.mjs: Vercel turns /api/company-lookup?q=X into /api/index?route=company-lookup&q=X.
test('route rewrite keeps the original query string',()=>{
 const url=new URL('/api/index?route=company-lookup&q='+encodeURIComponent('冠立機械'),'https://localhost');
 const route=url.searchParams.get('route');url.searchParams.delete('route');const qs=url.searchParams.toString();
 const out='/api/'+route+(qs?'?'+qs:'');
 assert.equal(new URL(out,'http://localhost').searchParams.get('q'),'冠立機械');
 assert.equal(new URL(out,'http://localhost').pathname,'/api/company-lookup');
});

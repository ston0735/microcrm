import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('package.json version matches the newest changelog entry',()=>{
 const ctx={window:{}};vm.runInNewContext(readFileSync(new URL('../public/changelog.js',import.meta.url),'utf8'),ctx);
 const log=ctx.window.CHANGELOG,pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(log[0].version,pkg.version);
 const num=v=>v.split('.').map(Number);
 for(let i=1;i<log.length;i++){const a=num(log[i-1].version),b=num(log[i].version);assert.ok(a[0]>b[0]||a[0]===b[0]&&(a[1]>b[1]||a[1]===b[1]&&a[2]>b[2]),'changelog must be newest first');}
 for(const v of log)assert.ok(/^\d+\.\d+\.\d+$/.test(v.version)&&v.items.length&&v.date&&v.type);
});

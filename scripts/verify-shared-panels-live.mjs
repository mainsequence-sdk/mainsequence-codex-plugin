// Read-only acceptance: independent packaged chat servers, existing shared login.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rpcProcess } from './lib/rpc.mjs';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const count=Number(process.argv[2]||2);
assert.ok(Number.isInteger(count)&&count>=2&&count<=20);
const clients=Array.from({length:count},()=>rpcProcess(process.execPath,['./dist/panel-server.js'],{cwd:path.join(root,'codex')}));
const report={at:new Date().toISOString(),version:pkg.version,devtoolsVersion:pkg.dependencies['@dev-mainsequence/devtools'],chatProcesses:count,remoteWrites:0};
async function call(index,name,args={}){
 const result=await clients[index].request('tools/call',{name,arguments:args,_meta:{threadId:'read-only-sharing-'+index}},125000);
 assert.notEqual(result.isError,true,result.structuredContent?.error?.code||name+' failed');
 return result.structuredContent;
}
try{
 const initial=await call(0,'mainsequence_settings',{action:'get'});
 const contexts=await Promise.all(clients.map((_,i)=>call(i,'mainsequence_open')));
 report.accountFailures=contexts.flatMap((context,index)=>context.contextId&&!context.issue?[]:[{index,checked:context.account?.checked,issue:context.issue}]);
 assert.ok(contexts.every(c=>c.account.checked&&c.account.authenticated&&c.contextId&&!c.issue));
 const scopes=contexts.map(c=>({contextId:c.contextId,environmentUid:c.environments.find(e=>e.name==='Production')?.uid}));
 assert.ok(scopes.every(scope=>scope.environmentUid));
 const pages=await Promise.all(scopes.map((scope,i)=>call(i,'mainsequence_discover',{...scope,catalog:'agents'})));
 assert.ok(pages.every(page=>page.count===pages[0].count&&page.results.length===pages[0].results.length));
 assert.ok(pages[0].results.length>0);
 const assets=await Promise.all(scopes.map((scope,i)=>call(i,'mainsequence_view',{...scope,view:'assets',agentUids:pages[i].results.map(a=>a.uid)})));
 const after=(await call(0,'mainsequence_settings',{action:'get'})).transport;
 const owners=new Set([...contexts,...pages,...assets].map(result=>result.transport.instanceId));assert.equal(owners.size,1);
 assert.ok(after.connections<=2,'These reads target a single backend, bounded to two upstream sockets');
 report.accountVerified=true;report.environments=contexts[0].environments.map(e=>e.name);report.agentCount=pages[0].count;report.iconCount=Object.keys(assets[0].assets).length;
 report.transport={instanceId:after.instanceId,pid:after.pid,clients:after.clients,upstreamRequests:after.requests-initial.transport.requests,cacheHits:after.cacheHits-initial.transport.cacheHits,coalesced:after.coalesced-initial.transport.coalesced,connections:after.connections};
 // Warm reads must not repeat agent discovery. Profile checks can expire after 5s;
 // the combined directory/schema cache lasts 30s and remains account/token scoped.
 const warm=await Promise.all(scopes.map((scope,i)=>call(i,'mainsequence_discover',{...scope,catalog:'agents'})));
 report.warmRequests=warm.at(-1).transport.requests-after.requests;
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;process.exitCode=1;}
finally{clients.forEach(client=>client.close());await fs.writeFile(path.join(root,`artifacts/shared-panels-live-${pkg.version}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}

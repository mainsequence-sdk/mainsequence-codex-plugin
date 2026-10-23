// Existing shared account and saved CRM only. No business mutations or message sends.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rpcProcess } from './lib/rpc.mjs';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const rpc=rpcProcess(process.execPath,['./dist/panel-server.js'],{cwd:path.join(root,'codex')});
const report={at:new Date().toISOString(),version:pkg.version,devtoolsVersion:pkg.dependencies['@dev-mainsequence/devtools'],remoteWrites:0,reads:[]};
async function call(name,args={}) {
 const result=await rpc.request('tools/call',{name,arguments:args,_meta:{threadId:'read-only-crm-acceptance'}},125000);
 assert.notEqual(result.isError,true,JSON.stringify(result.structuredContent?.error));
 const data=result.structuredContent;assert.ok(!data.error,JSON.stringify(data.error));return data;
}
try {
 const opened=await call('mainsequence_open');assert.ok(opened.contextId&&opened.account.checked&&!opened.issue);
 report.backend=opened.account.backend;report.transportInstance=opened.transport.instanceId;
 const scope={contextId:opened.contextId,environmentUid:opened.environments.find(e=>e.name==='Production')?.uid};assert.ok(scope.environmentUid);
 const connections=await call('mainsequence_view',{...scope,view:'connections'});
 const crm=connections.results.find(c=>c.name==='crm');assert.ok(crm,'CRM must already be saved for this backend');
 const selected={...scope,releaseUid:crm.uid};
 const started=Date.now(),catalog=await call('mainsequence_tools',selected);
 report.catalogMs=Date.now()-started;report.toolCount=catalog.tools.length;
 for(const name of ['crm_tasks_list','crm_tasks_get']) assert.ok(catalog.tools.some(t=>t.name===name&&t.annotations.readOnlyHint===true));
 let previous=catalog.transport.requests;
 async function read(tool,args) {
  const start=Date.now(),data=await call('mainsequence_call_tool',{...selected,tool,arguments:args});
  assert.notEqual(data.result?.isError,true);assert.equal(data.result?.structuredContent?.code,'ok');
  report.reads.push({tool,elapsedMs:Date.now()-start,upstreamRequests:data.transport.requests-previous});previous=data.transport.requests;
  return data.result.structuredContent.data;
 }
 const listed=await read('crm_tasks_list',{page_size:1,filters:{}});report.totalTasks=listed.pageInfo.totalItems;
 assert.ok(listed.items.length,'A task must exist for the read-only detail check');
 const detail=await read('crm_tasks_get',{uid:listed.items[0].uid});assert.ok(detail);
 report.passed=true;
}catch(error){report.passed=false;report.failure=error.message;process.exitCode=1;}
finally{rpc.close();await fs.writeFile(path.join(root,`artifacts/crm-read-live-${pkg.version}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}

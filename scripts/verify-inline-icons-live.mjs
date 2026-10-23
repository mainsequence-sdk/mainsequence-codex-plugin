// One read-only live directory request. Concurrency/request-count tests use fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rpcProcess } from './lib/rpc.mjs';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const rpc=rpcProcess(process.execPath,['./dist/panel-server.js'],{cwd:path.join(root,'codex')});
const report={at:new Date().toISOString(),version:pkg.version,devtoolsVersion:pkg.dependencies['@dev-mainsequence/devtools'],chatProcesses:1,remoteWrites:0};
async function call(name,args={}) {
 const result=await rpc.request('tools/call',{name,arguments:args,_meta:{threadId:'inline-icon-read-only-acceptance'}},125000);
 assert.notEqual(result.isError,true,JSON.stringify(result.structuredContent?.error));
 return result.structuredContent;
}
try {
 const opened=await call('mainsequence_open');
 assert.ok(opened.contextId&&opened.account.checked&&!opened.issue,JSON.stringify(opened.issue));
 report.backend=opened.account.backend;
 const scope={contextId:opened.contextId,environmentUid:opened.environments.find(e=>e.name==='Production')?.uid};
 assert.ok(scope.environmentUid);
 const started=Date.now(),page=await call('mainsequence_discover',{...scope,catalog:'agents'});
 report.directoryMs=Date.now()-started;report.agentCount=page.count;
 report.iconCount=page.results.filter(agent=>agent.icon).length;
 assert.ok(report.agentCount>0&&report.iconCount>0);
 for(const agent of page.results.filter(agent=>agent.icon)) {
  assert.match(agent.icon.source,/^data:image\/(png|svg\+xml);base64,/);
  assert.match(agent.icon.stillSource,/^data:image\/(png|svg\+xml);base64,/);
 }
 report.transportInstance=page.transport.instanceId;
 report.directoryUpstreamDelta=page.transport.requests-opened.transport.requests;
 // Old HTML cannot trigger a second directory or icon fan-out on this server.
 const legacy=await call('mainsequence_view',{...scope,view:'assets',agentUids:page.results.map(agent=>agent.uid)});
 assert.deepEqual(legacy.assets,{});
 report.legacyAssetsUpstreamDelta=legacy.transport.requests-page.transport.requests;
 report.passed=true;
} catch(error) { report.passed=false;report.failure=error.message;process.exitCode=1; }
finally { rpc.close();await fs.writeFile(path.join(root,`artifacts/inline-icons-live-${pkg.version}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2)); }

// Uses the real installed Codex executable, but an isolated home and fixture plugin.
// No turn is started and no real model or MainSequence service is contacted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { stage, binary, pluginId } from './stage.mjs';
import { rpcProcess } from './rpc.mjs';

const root = await stage(), testHome = join(root,'codex-home'), logs = join(root,'logs');
await mkdir(testHome); await mkdir(logs);
const initialExtra = process.argv.includes('--initial-extra');
const expectedBuild=JSON.parse(await readFile(join(root,'plugins/mainsequence-host-probe/build-info.json'),'utf8'));
const env = { ...process.env, CODEX_HOME:testHome, MS_HOST_PROBE_DATA_DIR:logs, MS_HOST_PROBE_INITIAL_EXTRA: initialExtra ? '1' : '0' };
const report = { fixtureRoot:root, pluginId, initialExtra, host:execFileSync(binary,['--version'],{encoding:'utf8'}).trim(), checks:[], desktopRenderingTested:false };
const record = (name, data) => { report.checks.push({name,...data}); console.log(JSON.stringify({name,...data})); };
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
let client;
try {
  for (const args of [['plugin','marketplace','add',root,'--json'],['plugin','add',pluginId,'--json']]) execFileSync(binary,args,{env,encoding:'utf8',timeout:20000});
  record('isolated-install',{passed:true});
  client = rpcProcess(binary,['app-server','-c','analytics.enabled=false','-c','features.remote_plugin=false','-c','features.recommended_plugins=false',
    '-c','model_provider="host_probe_offline"',
    '-c','model_providers.host_probe_offline.name="Offline host probe"',
    '-c','model_providers.host_probe_offline.base_url="http://127.0.0.1:9/v1"',
    '-c','model_providers.host_probe_offline.wire_api="responses"',
    '-c','model_providers.host_probe_offline.requires_openai_auth=false'],{env,cwd:root});
  const initialized = await client.request('initialize',{clientInfo:{name:'mainsequence-host-probe-test',version:'0.1.1'},capabilities:{experimentalApi:true}});
  client.notify('initialized');
  report.userAgent=initialized.userAgent;
  const start = () => client.request('thread/start',{cwd:root,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',environments:[]});
  const thread = (await start()).thread.id;
  let server;
  for (let attempt=0;attempt<40;attempt++) {
    const inventory = await client.request('mcpServerStatus/list',{threadId:thread});
    server = inventory.data.find(s=>s.pluginId===pluginId);
    if (server?.runtimeStatus==='failed' || (server && Object.values(server.tools).some(t=>t.name==='probe_open'))) break;
    await delay(250);
  }
  report.discovery = server;
  assert.ok(server, 'Codex must discover the packaged local MCP server.');
  report.serverName=server.name;
  const allTools=Object.values(server.tools);
  assert.ok(allTools.some(t=>t.name==='probe_open'),'Opening tool must be discovered.');
  record('local-mcp-discovery',{passed:true,server:server.name,toolNames:allTools.map(t=>t.name),capabilities:server.serverCapabilities});
  const opener=allTools.find(t=>t.name==='probe_open');
  assert.equal(opener._meta?.ui?.resourceUri, expectedBuild.resourceUri);
  assert.deepEqual(opener._meta?.['openai/ui']?.entrypoints,[{type:'global'},{type:'thread'}]);
  record('ui-metadata',{passed:true,resourceUri:opener._meta.ui.resourceUri,entrypoints:opener._meta['openai/ui'].entrypoints,appOnlyVisibility:allTools.find(t=>t.name==='probe_ui_report')?._meta?.ui?.visibility});
  const call=(name,args={})=>client.request('mcpServer/tool/call',{threadId:thread,server:server.name,tool:name,arguments:args});
  const ping=await call('probe_ping',{source:'runtime-test'});
  assert.equal(ping.structuredContent?.build.buildId,expectedBuild.buildId); assert.equal(ping.structuredContent?.pings,1); assert.equal(ping.structuredContent?.fixture,true);
  record('direct-tool-call',{passed:true,pings:ping.structuredContent.pings});
  const resource=await client.request('mcpServer/resource/read',{threadId:thread,server:server.name,uri:expectedBuild.resourceUri});
  assert.ok(resource.contents?.some(c=>c.mimeType==='text/html;profile=mcp-app'&&c.text.includes('ui/initialize')));
  record('local-ui-resource',{passed:true,mimeTypes:resource.contents.map(c=>c.mimeType),bytes:resource.contents.reduce((n,c)=>n+(c.text?.length||0),0),build:expectedBuild});
  const prepared=(await call('probe_agent',{action:'prepare',agent:'alpha'})).structuredContent;
  const requestId=randomUUID(),message='RUNTIME-RECEIPT-'+randomUUID()+'\n  literal recovery';
  const staged=(await call('probe_request_stage',{requestId,agent:'alpha',sessionUid:prepared.data.sessionUid,message})).structuredContent.request;
  assert.equal(staged.state,'pending');
  await call('probe_request_submission',{requestId,outcome:'acknowledged'});
  assert.equal((await call('probe_comms_snapshot')).structuredContent.sends,0);
  const delivered=(await call('probe_request',{action:'deliver',requestId})).structuredContent;
  const again=(await call('probe_request',{action:'deliver',requestId})).structuredContent;
  assert.equal(delivered.request.state,'delivered');assert.equal(again.reusedReceipt,true);
  assert.equal(again.request.receipt.result.data.message,'Alpha fixture agent: '+message);
  assert.equal((await call('probe_comms_snapshot')).structuredContent.sends,1);
  record('saved-request-and-receipt',{passed:true,requestId,stageSends:0,deliverySends:1,repeatedDeliveryReusedReceipt:true,exactMultilineReply:true});
  const job=await call('probe_start_job'); assert.equal(job.structuredContent.job.status,'running');
  const cancelled=await call('probe_cancel_job'); assert.equal(cancelled.structuredContent.job.status,'cancelled');
  record('fixture-operation-cancel',{passed:true});
  const catalog=async()=>Object.values((await client.request('mcpServerStatus/list',{threadId:thread,serverName:server.name})).data[0].tools).map(t=>t.name);
  assert.equal((await catalog()).includes('probe_dynamic'),initialExtra);
  await call('probe_toggle_tool',{enabled:!initialExtra});
  let refreshed=false;
  for (let attempt=0;attempt<10;attempt++) {
    await delay(500);
    if ((await catalog()).includes('probe_dynamic')===!initialExtra) {refreshed=true;break;}
  }
  record(initialExtra ? 'dynamic-tool-remove' : 'dynamic-tool-add',{supported:refreshed,observationWindowMs:5000});
  if (initialExtra) {
    let staleRejected=false;
    try { const value=await call('probe_dynamic'); staleRejected=value.isError===true; } catch { staleRejected=true; }
    record('removed-tool-denied',{passed:staleRejected});
  } else {
    let callable=false;
    try { callable=(await call('probe_dynamic')).structuredContent?.extraTool===true; } catch { /* Cached host catalog can deny an unknown tool. */ }
    record('new-tool-callable',{supported:callable});
  }
  const second=(await start()).thread.id;
  const secondPing=await client.request('mcpServer/tool/call',{threadId:second,server:server.name,tool:'probe_ping',arguments:{source:'runtime-test'}});
  record('thread-isolation',{separateServerInstance:secondPing.structuredContent.runId!==ping.structuredContent.runId,secondThreadPings:secondPing.structuredContent.pings});
  await client.request('thread/unsubscribe',{threadId:second});
  await client.request('thread/unsubscribe',{threadId:thread});
} catch(error) { report.error=error.message; process.exitCode=1; console.error(error.message); }
finally {
  report.stderr=client?.stderr;
  client?.close(); await delay(200);
  const events=(await Promise.all((await readdir(logs)).filter(f=>f.endsWith('.jsonl')).map(async f=>(await readFile(join(logs,f),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)))).flat();
  report.serverEvents=events;
  await writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:join(root,'result.json'),error:report.error}));
}

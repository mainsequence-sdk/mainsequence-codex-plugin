// Actual Codex backend, isolated profile, local scripted Responses endpoint.
// Measures package adoption separately from installation and UI rendering.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {stage,binary,pluginId} from './stage.mjs';
import {writeBuildManifest} from './plugin/build-info.mjs';
import {rpcProcess} from './rpc.mjs';

const root=await stage(),home=join(root,'isolated-home'),logs=join(root,'fixture-state'),plugin=join(root,'plugins/mainsequence-host-probe');
await mkdir(home);await mkdir(logs);
const env=Object.fromEntries(['PATH','HOME','TMPDIR','TERM'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
Object.assign(env,{CODEX_HOME:home,MS_HOST_PROBE_DATA_DIR:logs});
const report={fixture:true,desktopUiTested:false,host:execFileSync(binary,['--version'],{encoding:'utf8'}).trim(),checks:[]};
const record=(name,data)=>{report.checks.push({name,...data});console.log(JSON.stringify({name,...data}));};
const assertAdopted=value=>{
  assert.equal(value.adoptedExpected,true);
  assert.equal(value.advertisedResourceMatches,true);
  assert.equal(value.resourceMatches,true);
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let client,threadId,modelRequests=0;
const endpoint=http.createServer(async(req,res)=>{
  req.resume();if(!req.url?.includes('/responses')){res.writeHead(404);res.end();return;}
  modelRequests++;
  const id='resp_'+randomUUID(),text='Isolated lifecycle check.',item={type:'message',id:'msg_'+randomUUID(),status:'completed',role:'assistant',phase:'final_answer',content:[{type:'output_text',text,annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const send=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
  send('response.created',{response:{id,object:'response',status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
  send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
  send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});
  send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text});
  send('response.output_item.done',{output_index:0,item});
  send('response.completed',{response:{id,object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
});
const cli=(...args)=>JSON.parse(execFileSync(binary,args,{env,encoding:'utf8',timeout:20000}));
async function boot(){
  const rpc=rpcProcess(binary,['app-server','-c','analytics.enabled=false','-c','features.remote_plugin=false','-c','features.recommended_plugins=false','-c','model_provider="fixture"','-c','model_providers.fixture.name="Offline lifecycle fixture"','-c',`model_providers.fixture.base_url="http://127.0.0.1:${endpoint.address().port}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false','-c','model_providers.fixture.request_max_retries=0','-c','model_providers.fixture.stream_max_retries=0'],{env,cwd:root});
  await rpc.request('initialize',{clientInfo:{name:'probe-update-check',version:'0.5.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');return rpc;
}
async function inventory(id=threadId){
  for(let i=0;i<40;i++){
    const server=(await client.request('mcpServerStatus/list',{threadId:id})).data.find(s=>s.pluginId===pluginId);
    if(server?.runtimeStatus==='failed')throw new Error('Fixture MCP startup failed.');
    if(Object.values(server?.tools||{}).some(t=>t.name==='probe_snapshot'))return server;
    await delay(100);
  }
  throw new Error('Fixture MCP was not discovered.');
}
async function call(tool,args={},id=threadId){const server=await inventory(id);return client.request('mcpServer/tool/call',{threadId:id,server:server.name,tool,arguments:args});}
async function turn(label,overrides={}){
  const cursor=client.notifications.length,started=await client.request('turn/start',{threadId,input:[{type:'text',text:'Offline lifecycle observation: '+label,text_elements:[]}],...overrides});
  for(let i=0;i<400;i++){
    const done=client.notifications.slice(cursor).find(n=>n.method==='turn/completed'&&n.params.turn.id===started.turn.id);
    if(done){assert.equal(done.params.turn.status,'completed',JSON.stringify(done.params.turn.error));return;}
    await delay(50);
  }
  throw new Error('Lifecycle fixture turn did not complete.');
}
async function observe(name,expected,id=threadId){
  const server=await inventory(id),state=(await call('probe_snapshot',{},id)).structuredContent;
  const uri=Object.values(server.tools).find(t=>t.name==='probe_open')._meta.ui.resourceUri;
  let resourceMatches=false,resourceError;
  try{const resource=await client.request('mcpServer/resource/read',{threadId:id,server:server.name,uri});resourceMatches=resource.contents.some(c=>c.text?.includes(state.build.buildId));}catch(error){resourceError=error.message;}
  const value={version:state.build.pluginVersion,buildId:state.build.buildId,runId:state.runId,adoptedExpected:state.build.buildId===expected.buildId,advertisedResourceMatches:uri===state.build.resourceUri,resourceMatches,...(resourceError?{resourceError}:{})};
  record(name,value);return value;
}
try{
  await new Promise((resolve,reject)=>{endpoint.once('error',reject);endpoint.listen(0,'127.0.0.1',resolve);});
  cli('plugin','marketplace','add',root,'--json');cli('plugin','add',pluginId,'--json');
  const first=JSON.parse(await readFile(join(plugin,'build-info.json'),'utf8'));report.initialBuild=first;
  client=await boot();
  const hook=(await client.request('hooks/list',{cwds:[root]})).data.flatMap(d=>d.hooks).find(h=>h.pluginId===pluginId);
  if(hook){client.close();await delay(100);await appendFile(join(home,'config.toml'),`\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`);client=await boot();}
  const start=()=>client.request('thread/start',{cwd:root,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only',environments:[]});
  threadId=(await start()).thread.id;
  assertAdopted(await observe('clean-install',first));
  const prepared=(await call('probe_agent',{action:'prepare',agent:'alpha'})).structuredContent;
  await call('probe_agent',{action:'send',agent:'alpha',sessionUid:prepared.data.sessionUid,message:'UPGRADE-ONCE'});
  const manifestPath=join(plugin,'.codex-plugin/plugin.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.version='0.5.1-lifecycle-fixture';await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  const second=writeBuildManifest(plugin);report.updatedBuild=second;
  const installed=cli('plugin','add',pluginId,'--json');assert.equal(installed.version,second.pluginVersion);
  await observe('existing-chat-after-cli-install',second);
  const fresh=(await start()).thread.id;assertAdopted(await observe('new-chat-same-backend-after-install',second,fresh));await client.request('thread/unsubscribe',{threadId:fresh});
  await turn('next turn after install');await observe('existing-chat-next-turn',second);
  await client.request('config/mcpServer/reload',null);await turn('after MCP reload');assertAdopted(await observe('supported-mcp-reload',second));
  await client.request('config/batchWrite',{edits:[],reloadUserConfig:true});await turn('after user config reload');await observe('supported-user-config-reload',second);
  await turn('plugin disabled',{disabledPluginIds:[pluginId]});await turn('plugin reenabled',{disabledPluginIds:[]});await observe('host-turn-plugin-toggle',second);
  await client.request('thread/unsubscribe',{threadId});await client.request('thread/resume',{threadId});await turn('after thread resume');await observe('unsubscribe-and-resume',second);
  await client.request('thread/unsubscribe',{threadId});client.close();await delay(150);client=await boot();
  await client.request('thread/resume',{threadId,cwd:root,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only'});
  assertAdopted(await observe('fresh-backend-resumed-chat',second));
  const state=(await call('probe_comms_snapshot')).structuredContent;
  assert.equal(state.sends,1);assert.equal(state.bindings.alpha.sessionUid,prepared.data.sessionUid);
  record('session-preserved-without-replay',{passed:true,agentSends:state.sends});
  await client.request('thread/unsubscribe',{threadId});client.close();client=null;
  cli('plugin','remove',pluginId,'--json');client=await boot();const removed=(await start()).thread.id;
  const servers=(await client.request('mcpServerStatus/list',{threadId:removed})).data;
  assert.equal(servers.some(s=>s.pluginId===pluginId),false);record('removal-in-fresh-backend',{passed:true});
  await client.request('thread/unsubscribe',{threadId:removed});
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{
  report.modelFixtureRequests=modelRequests;report.realModelRequests=0;report.stderr=client?.stderr;client?.close();endpoint.closeAllConnections();await new Promise(resolve=>endpoint.close(resolve));
  await writeFile(join(root,'update-result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:join(root,'update-result.json'),error:report.error}));
}

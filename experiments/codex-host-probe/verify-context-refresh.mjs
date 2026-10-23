// Actual Codex runtime; isolated profile and counted local Responses fixture.
// Captures what Codex sends to the model. The fixture model only echoes a hook result
// that actually reached its request; it is not evidence of a real LLM's fidelity.
import assert from 'node:assert/strict';
import {mkdir,readFile,appendFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {stage,binary,pluginId} from './stage.mjs';
import {rpcProcess} from './rpc.mjs';
const root=await stage(),home=join(root,'codex-home'),logs=join(root,'logs');await mkdir(home);await mkdir(logs);
const env=Object.fromEntries(['PATH','HOME','TMPDIR','TERM'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));Object.assign(env,{CODEX_HOME:home,MS_HOST_PROBE_DATA_DIR:logs,MS_HOST_PROBE_CATALOG_FILE:join(logs,'catalog-state.json')});
const report={host:execFileSync(binary,['--version'],{encoding:'utf8'}).trim(),root,checks:[]},requests=[],script=[];
const record=(name,data)=>{report.checks.push({name,...data});console.log(JSON.stringify({name,...data}));};
const delay=ms=>new Promise(r=>setTimeout(r,ms));let client;
const allText=value=>typeof value==='string'?value:Array.isArray(value)?value.map(allText).join('\n'):value&&typeof value==='object'?Object.values(value).map(allText).join('\n'):'';
const endpoint=http.createServer(async(req,res)=>{
 if(!req.url?.includes('/responses')){req.resume();res.writeHead(404);res.end();return;}
 let raw='';for await(const chunk of req)raw+=chunk;
 let body;try{body=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}requests.push(body);
 const texts=allText(body.input),matches=[...texts.matchAll(/<mainsequence_fixture_result>\n([^\n]+)\n<\/mainsequence_fixture_result>/g)];
 const result=matches.length?JSON.parse(matches.at(-1)[1]):null;
 let scripted;try{scripted=script.length?script.shift()(body):null;}catch(error){report.fixtureError=error.stack;res.writeHead(500);res.end('Fixture assertion failed');return;}
 const text=typeof scripted==='string'?scripted:result?`MainSequence fixture · ${result.agent}\n\n${result.message||result.summary}`:'Offline fixture model: no agent result in context.';
 const id='resp_'+randomUUID(),item=scripted&&typeof scripted==='object'?scripted:{type:'message',id:'msg_'+randomUUID(),status:'completed',role:'assistant',phase:'final_answer',content:[{type:'output_text',text,annotations:[]}]};
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const send=(type,fields)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`);
 send('response.created',{response:{id,object:'response',status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:item.type==='message'?{...item,status:'in_progress',content:[]}:{...item,status:'in_progress',arguments:''}});
 if(item.type==='message'){
 send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
 send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});
 send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text});
 }else send('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:item.arguments});
 send('response.output_item.done',{output_index:0,item});
 send('response.completed',{response:{id,object:'response',status:'completed',output:[item],usage:{input_tokens:20,output_tokens:20,total_tokens:40}}});res.end();
});
try{
 await new Promise((resolve,reject)=>{endpoint.once('error',reject);endpoint.listen(0,'127.0.0.1',resolve);});
 for(const args of [['plugin','marketplace','add',root,'--json'],['plugin','add',pluginId,'--json']])execFileSync(binary,args,{env,encoding:'utf8',timeout:20000});
 const boot=async()=>{const c=rpcProcess(binary,['app-server','-c','analytics.enabled=false','-c','features.remote_plugin=false','-c','features.recommended_plugins=false','-c','model_provider="fixture"','-c','model_providers.fixture.name="Offline fixture"','-c',`model_providers.fixture.base_url="http://127.0.0.1:${endpoint.address().port}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false','-c','model_providers.fixture.request_max_retries=0','-c','model_providers.fixture.stream_max_retries=0'],{env,cwd:root});await c.request('initialize',{clientInfo:{name:'ms-probe-context-refresh',version:'0.3.0'},capabilities:{experimentalApi:true}});c.notify('initialized');return c;};
 client=await boot();const hook=(await client.request('hooks/list',{cwds:[root]})).data.flatMap(d=>d.hooks).find(h=>h.pluginId===pluginId&&h.eventName==='userPromptSubmit');assert.ok(hook);
 client.close();await delay(200);await appendFile(join(home,'config.toml'),`\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`);client=await boot();
 const threadId=(await client.request('thread/start',{cwd:root,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only',environments:[]})).thread.id;
 let server;for(let i=0;i<40;i++){server=(await client.request('mcpServerStatus/list',{threadId})).data.find(s=>s.pluginId===pluginId);if(Object.values(server?.tools||{}).some(t=>t.name==='probe_agent'))break;await delay(200);}assert.ok(server);
 const call=(tool,args={})=>client.request('mcpServer/tool/call',{threadId,server:server.name,tool,arguments:args});
 const catalog=async()=>Object.values((await client.request('mcpServerStatus/list',{threadId})).data.find(s=>s.name===server.name)?.tools||{}).map(t=>t.name);
 const turn=async (prompt,overrides={})=>{
  const cursor=client.notifications.length,before=requests.length;const started=await client.request('turn/start',{threadId,input:[{type:'text',text:prompt,text_elements:[]}],...overrides});let completed;
  for(let i=0;i<400;i++){completed=client.notifications.slice(cursor).find(n=>n.method==='turn/completed'&&n.params.turn.id===started.turn.id);if(completed)break;await delay(50);}assert.ok(completed,'Turn completed');assert.equal(completed.params.turn.status,'completed',JSON.stringify(completed.params.turn.error));
  return {requests:requests.slice(before),events:client.notifications.slice(cursor),turnId:started.turn.id};
 };
 await call('probe_agent',{action:'prepare',agent:'alpha'});
 const marker='CONTEXT-REPLY-'+randomUUID();
 const relay=await turn('/ms-probe-chat @alpha '+marker+'\nsecond line');assert.equal(relay.requests.length,1);
 const developer=relay.requests[0].input.filter(i=>i.role==='developer').map(allText).join('\n');assert.ok(developer.includes('Alpha fixture agent: '+marker));
 const messages=relay.events.filter(e=>e.method==='item/completed'&&e.params.item.type==='agentMessage').map(e=>e.params.item.text);assert.ok(messages.some(x=>x.includes('Alpha fixture agent: '+marker)));
 record('hook-result-becomes-native-assistant-item',{passed:true,modelFixtureRequests:1,resultIncludedInModelContext:true,assistantItems:messages,hookStatuses:relay.events.filter(e=>e.method==='hook/completed').map(e=>e.params.run.status)});
 const next=await turn('Use the earlier agent response. Do not call the agent again.');assert.ok(allText(next.requests[0].input).includes('Alpha fixture agent: '+marker));
 assert.equal((await call('probe_comms_snapshot')).structuredContent.sends,1);record('reply-in-next-turn-context',{passed:true,agentSends:1});
 const read=await client.request('thread/read',{threadId,includeTurns:true});const persisted=read.thread.turns.flatMap(t=>t.items).filter(i=>i.type==='agentMessage').map(i=>i.text);assert.ok(persisted.some(x=>x.includes(marker)));record('native-reply-persisted-in-thread-read',{passed:true});
 const toolNames=body=>(body.tools||[]).map(t=>({type:t.type,name:t.name,namespace:t.namespace}));
 record('initial-model-tools',{tools:toolNames(next.requests[0]),dynamicInRequest:JSON.stringify(next.requests[0].tools).includes('probe_dynamic')});
 // Stable tool dispatch uses unchanged devtools discovery. These are actual model
 // function calls in the same Codex thread, not app-server direct invocations.
 const functionCall=args=>({type:'function_call',id:'fc_'+randomUUID(),call_id:'call_'+randomUUID(),name:'probe_mcp',namespace:'mcp__mainsequence_host_probe',arguments:JSON.stringify(args),status:'completed'});
 const lastOutput=body=>allText(body.input.filter(i=>i.type==='function_call_output').at(-1)?.output);
 await call('probe_mcp',{action:'connect'});
 for(const [catalogName,field]of [['expanded','text'],['revised','value']]){
  await call('probe_project_catalog',{catalog:catalogName});
  script.push(()=>functionCall({action:'tools'}),body=>{const out=lastOutput(body);assert.ok(out.includes('uppercase'));assert.ok(out.includes(field));return functionCall({action:'call',tool:'uppercase',arguments:{[field]:'fresh '+catalogName}});},body=>{assert.ok(lastOutput(body).includes('FRESH '+catalogName.toUpperCase()));return 'Project MCP result: FRESH '+catalogName.toUpperCase();});
  const run=await turn('Use current project tools to uppercase the fixture text.');assert.equal(script.length,0);assert.equal(run.requests.length,3);
  record('stable-dispatch-'+catalogName,{passed:true,modelToolCalls:run.events.filter(e=>e.method==='item/completed'&&e.params.item.type==='mcpToolCall').length,modelReceivesNewSchema:true,nativeModelResult:true});
 }
 await call('probe_project_catalog',{catalog:'base'});const callsBefore=(await call('probe_comms_snapshot')).structuredContent.calls.filter(c=>c.method==='project:tools/call').length;
 script.push(()=>functionCall({action:'call',tool:'uppercase',arguments:{value:'removed'}}),body=>{assert.ok(lastOutput(body).includes('absent from the current MCP catalog'));return 'Removed project tool correctly refused.';});
 await turn('Probe the old tool name once to verify its removal.');assert.equal(script.length,0);assert.equal((await call('probe_comms_snapshot')).structuredContent.calls.filter(c=>c.method==='project:tools/call').length,callsBefore);record('stable-dispatch-removal',{passed:true,remoteCalls:0});
 await call('probe_toggle_tool',{enabled:true});await delay(500);const added=await turn('Catalog check after adding the fixture tool.');
 record('notification-followed-by-next-turn',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(added.requests[0].tools).includes('probe_dynamic')});
 const twice=await turn('Catalog check one more turn after notification.');record('second-turn-after-notification',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(twice.requests[0].tools).includes('probe_dynamic')});
 const beforeRun=(await call('probe_snapshot')).structuredContent.runId;await client.request('config/mcpServer/reload',null);const reloaded=await turn('Catalog check after the supported MCP reload.');
 const afterRun=(await call('probe_snapshot')).structuredContent.runId;
 record('explicit-mcp-reload',{serverRestarted:beforeRun!==afterRun,cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(reloaded.requests[0].tools).includes('probe_dynamic')});
 await client.request('config/batchWrite',{edits:[],reloadUserConfig:true});const settings=await turn('Catalog check after hot reloading user configuration.');record('user-config-hot-reload',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(settings.requests[0].tools).includes('probe_dynamic')});
 await turn('Catalog check while fixture plugin is disabled.',{disabledPluginIds:[pluginId]});const enabled=await turn('Catalog check after enabling fixture plugin.',{disabledPluginIds:[]});record('turn-plugin-disable-enable',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(enabled.requests[0].tools).includes('probe_dynamic')});
 await client.request('thread/unsubscribe',{threadId});await delay(200);await client.request('thread/resume',{threadId});const rejoins=await turn('Catalog check after unsubscribe and resume.');record('thread-unsubscribe-resume',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(rejoins.requests[0].tools).includes('probe_dynamic')});
 await client.request('thread/unsubscribe',{threadId});client.close();await delay(200);client=await boot();await client.request('thread/resume',{threadId,cwd:root,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only'});const restartAdded=await turn('Catalog check after restarting the isolated runtime and resuming.');record('runtime-restart-with-added-tool',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(restartAdded.requests[0].tools).includes('probe_dynamic')});
 await call('probe_toggle_tool',{enabled:false});await client.request('config/mcpServer/reload',null);const removed=await turn('Catalog check after removing and reloading the fixture tool.');record('explicit-mcp-removal-reload',{cachedCatalog:(await catalog()).includes('probe_dynamic'),modelRequestContainsTool:JSON.stringify(removed.requests[0].tools).includes('probe_dynamic')});
 await turn('Disable the fixture for removal refresh.',{disabledPluginIds:[pluginId]});const removalRefresh=await turn('Reenable the fixture for removal refresh.',{disabledPluginIds:[]});assert.equal(JSON.stringify(removalRefresh.requests[0].tools).includes('probe_dynamic'),false);record('turn-plugin-toggle-refreshes-removal',{passed:true,modelRequestContainsTool:false});
 await client.request('thread/unsubscribe',{threadId});client.close();await delay(200);client=await boot();await client.request('thread/resume',{threadId,cwd:root,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only'});
 const resumed=await turn('Recall the earlier agent result after resuming.');assert.ok(allText(resumed.requests[0].input).includes('Alpha fixture agent: '+marker));record('reply-survives-runtime-restart-and-resume',{passed:true});
 await client.request('thread/unsubscribe',{threadId});
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}finally{report.stderr=client?.stderr;client?.close();endpoint.closeAllConnections();await new Promise(r=>endpoint.close(r));await writeFile(join(root,'model-requests.json'),JSON.stringify(requests,null,2)+'\n');await writeFile(join(root,'context-refresh-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(root,'context-refresh-result.json'),error:report.error}));}

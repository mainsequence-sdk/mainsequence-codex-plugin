// Real Codex runtime, isolated profile, intercepted MainSequence transports and loopback-only model fixture.
import assert from 'node:assert/strict';
import {mkdir,readFile,appendFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {stage,binary,pluginId} from './stage.mjs';
import {rpcProcess} from './rpc.mjs';
const root=await stage(),home=join(root,'codex-home'),logs=join(root,'logs');await mkdir(home);await mkdir(logs);
const env=Object.fromEntries(['PATH','HOME','TMPDIR','TERM'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));Object.assign(env,{CODEX_HOME:home,MS_HOST_PROBE_DATA_DIR:logs});
const report={host:execFileSync(binary,['--version'],{encoding:'utf8'}).trim(),root,checks:[]};
const record=(name,data)=>{report.checks.push({name,...data});console.log(JSON.stringify({name,...data}));};
const delay=ms=>new Promise(r=>setTimeout(r,ms));let client,modelRequests=0;
const endpoint=http.createServer((req,res)=>{if(req.url.includes('/responses'))modelRequests++;req.resume();res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'invalid_request_error',message:'Fixture inference disabled.'}}));});
try{
 await new Promise((resolve,reject)=>{endpoint.once('error',reject);endpoint.listen(0,'127.0.0.1',resolve);});
 for(const args of [['plugin','marketplace','add',root,'--json'],['plugin','add',pluginId,'--json']])execFileSync(binary,args,{env,encoding:'utf8',timeout:20000});
 const boot=async()=>{const c=rpcProcess(binary,['app-server','-c','analytics.enabled=false','-c','features.remote_plugin=false','-c','features.recommended_plugins=false','-c','model_provider="fixture"','-c','model_providers.fixture.name="Offline fixture"','-c',`model_providers.fixture.base_url="http://127.0.0.1:${endpoint.address().port}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false','-c','model_providers.fixture.request_max_retries=0','-c','model_providers.fixture.stream_max_retries=0'],{env,cwd:root});await c.request('initialize',{clientInfo:{name:'ms-probe-communications',version:'0.2.0'},capabilities:{experimentalApi:true}});c.notify('initialized');return c;};
 client=await boot();const hook=(await client.request('hooks/list',{cwds:[root]})).data.flatMap(d=>d.hooks).find(h=>h.pluginId===pluginId&&h.eventName==='userPromptSubmit');
 assert.ok(hook);report.hook=hook;
 // Trust only the exact fixture hook in this newly created disposable profile.
 client.close();await delay(200);
 await appendFile(join(home,'config.toml'),`\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}\n`);
 client=await boot();const reviewed=(await client.request('hooks/list',{cwds:[root]})).data.flatMap(d=>d.hooks).find(h=>h.key===hook.key);assert.equal(reviewed.trustStatus,'trusted');record('isolated-hook-trust',{passed:true,key:hook.key,hash:hook.currentHash});
 const start=async()=> (await client.request('thread/start',{cwd:root,ephemeral:true,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only',environments:[]})).thread.id;
 const threadId=await start();let server;
 for(let i=0;i<40;i++){server=(await client.request('mcpServerStatus/list',{threadId})).data.find(s=>s.pluginId===pluginId);if(Object.values(server?.tools||{}).some(t=>t.name==='probe_agent'))break;await delay(200);}
 assert.ok(server);const call=(tool,args={})=>client.request('mcpServer/tool/call',{threadId,server:server.name,tool,arguments:args});
 const alpha=(await call('probe_agent',{action:'prepare',agent:'alpha'})).structuredContent;assert.equal(alpha.status,'success');assert.equal(alpha.data.sends,0);record('talk-prepares-without-send',{passed:true,ready:alpha.data.ready});
 const beta=(await call('probe_agent',{action:'prepare',agent:'beta'})).structuredContent;assert.notEqual(beta.data.sessionUid,alpha.data.sessionUid);
 const body='Exact fixture message: "quotes" $() `ticks`\nsecond line\n';
 const message=(await call('probe_agent',{action:'send',agent:'alpha',message:body})).structuredContent;assert.equal(message.data.message,'Alpha fixture agent: '+body);record('model-side-agent-tool',{passed:true,exactMultiline:true,separateAgents:true});
 const command='/ms-probe @alpha Native composer command\nsecond line stays exact';
 for(const prompt of [command,'ordinary fixture prompt']){
   const before=modelRequests,cursor=client.notifications.length;
   const turn=await client.request('turn/start',{threadId,input:[{type:'text',text:prompt,text_elements:[]}]});let done;
   for(let i=0;i<300;i++){done=client.notifications.slice(cursor).find(n=>n.method==='turn/completed'&&n.params.turn.id===turn.turn.id);if(done)break;await delay(50);}assert.ok(done,'Fixture turn must finish.');
   const events=client.notifications.slice(cursor),run=events.find(n=>n.method==='hook/completed'&&n.params.turnId===turn.turn.id)?.params.run;assert.ok(run);
   const text=run.entries.map(e=>e.text).join('\n'),calls=modelRequests-before;
   if(prompt===command){assert.equal(run.status,'blocked');assert.equal(calls,0);assert.ok(text.includes('Alpha fixture agent: '+command.slice('/ms-probe @alpha '.length)));}
   else{assert.equal(run.status,'completed');assert.ok(calls>0);}
   record(prompt===command?'native-command-routing':'ordinary-prompt-pass-through',{passed:true,modelRequests:calls,hookStatus:run.status,...(prompt===command?{reply:text,eventMethods:[...new Set(events.map(n=>n.method))],assistantItems:events.filter(n=>n.method==='item/completed'&&n.params.item?.type==='agentMessage').length}:{})});
 }
 const task=(await call('probe_agent',{action:'send',agent:'alpha',message:'task fixture',responseKind:'task'})).structuredContent;
 const cancelled=(await call('probe_agent',{action:'cancel',agent:'alpha',taskUid:task.data.taskUid})).structuredContent;assert.equal(cancelled.data.status,'cancelled');record('agent-task-cancel',{passed:true});
 const catalog=async()=>Object.values((await client.request('mcpServerStatus/list',{threadId})).data.find(s=>s.name===server.name).tools).map(t=>t.name);
 assert.equal((await catalog()).includes('probe_project_echo'),false);
 const connected=(await call('probe_mcp',{action:'connect'})).structuredContent;assert.equal(connected.status,'success');
 const echo=await call('probe_mcp',{action:'call',tool:'echo',arguments:{text:body}});assert.equal(echo.content[0].text,body);assert.equal(echo.structuredContent.data.structuredContent.echo,body);record('mcp-connect-schema-call',{passed:true,toolNames:connected.data.tools.map(t=>t.name),contentPreserved:true});
 await delay(1500);record('mcp-model-catalog-refresh',{supported:(await catalog()).includes('probe_project_echo'),observationWindowMs:1500});
 const direct=await call('probe_project_echo',{text:'known-name dynamic call'});record('dynamic-tool-direct-call',{supported:direct.structuredContent?.data?.structuredContent?.echo==='known-name dynamic call'});
 await call('probe_mcp',{action:'disconnect'});let refused=false;try{const stale=await call('probe_project_echo',{text:'stale'});refused=stale.isError===true;}catch{refused=true;}assert.ok(refused);record('disconnected-model-tool-refused',{passed:true});
 const other=await start();const otherState=await client.request('mcpServer/tool/call',{threadId:other,server:server.name,tool:'probe_comms_snapshot',arguments:{}});assert.equal(otherState.structuredContent.sends,0);assert.equal(Object.keys(otherState.structuredContent.bindings).length,0);record('chat-isolation',{passed:true});
 const state=(await call('probe_comms_snapshot')).structuredContent;assert.equal(state.sends,3);record('mcp-hook-correlation',{passed:true,preparedAndCommandUsedSameSession:true,sendCount:state.sends});
 await client.request('thread/unsubscribe',{threadId:other});await client.request('thread/unsubscribe',{threadId});
}catch(e){report.error=e.stack;process.exitCode=1;console.error(e.stack);}finally{report.modelFixtureRequests=modelRequests;report.stderr=client?.stderr;client?.close();endpoint.closeAllConnections();await new Promise(r=>endpoint.close(r));await writeFile(join(root,'communications-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(root,'communications-result.json'),error:report.error}));}

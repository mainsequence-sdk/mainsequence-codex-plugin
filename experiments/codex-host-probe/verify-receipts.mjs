// Actual isolated Codex with a local scripted model. Tests saved-request recovery
// after turn/interrupt, receipt reuse and native context; not desktop UI acceptance.
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
 if(scripted?.hold){res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: response.created\ndata: '+JSON.stringify({type:'response.created',response:{id:'resp_held',object:'response',status:'in_progress',output:[]}})+'\n\n');return;}
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
 client=rpcProcess(binary,['app-server','-c','analytics.enabled=false','-c','features.remote_plugin=false','-c','features.recommended_plugins=false','-c','model_provider="fixture"','-c','model_providers.fixture.name="Offline fixture"','-c',`model_providers.fixture.base_url="http://127.0.0.1:${endpoint.address().port}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false','-c','model_providers.fixture.request_max_retries=0','-c','model_providers.fixture.stream_max_retries=0'],{env,cwd:root});
 await client.request('initialize',{clientInfo:{name:'ms-probe-receipts',version:'0.6.0'},capabilities:{experimentalApi:true}});client.notify('initialized');
 const threadId=(await client.request('thread/start',{cwd:root,model:'offline-fixture',modelProvider:'fixture',approvalPolicy:'never',sandbox:'read-only',environments:[]})).thread.id;
 let server;for(let i=0;i<40;i++){server=(await client.request('mcpServerStatus/list',{threadId})).data.find(s=>s.pluginId===pluginId);if(Object.values(server?.tools||{}).some(t=>t.name==='probe_request'))break;await delay(200);}assert.ok(server);
 const call=(tool,args={})=>client.request('mcpServer/tool/call',{threadId,server:server.name,tool,arguments:args});
 const waitTurn=async(id,cursor)=>{for(let i=0;i<400;i++){const n=client.notifications.slice(cursor).find(n=>n.method==='turn/completed'&&n.params.turn.id===id);if(n)return n.params.turn;await delay(50);}throw new Error('Turn completion timed out.');};
 const turn=async prompt=>{const cursor=client.notifications.length,before=requests.length;const start=await client.request('turn/start',{threadId,input:[{type:'text',text:prompt,text_elements:[]}]});const completed=await waitTurn(start.turn.id,cursor);assert.equal(completed.status,'completed',JSON.stringify(completed.error));return {requests:requests.slice(before),events:client.notifications.slice(cursor),turnId:start.turn.id};};
 const sessionUid=(await call('probe_agent',{action:'prepare',agent:'alpha'})).structuredContent.data.sessionUid;
 const requestId=randomUUID(),message='ISOLATED-STOP-RECEIPT-'+randomUUID()+'\n  retain exact reply';
 await call('probe_request_stage',{requestId,agent:'alpha',sessionUid,message});
 await call('probe_request_submission',{requestId,outcome:'acknowledged'});
 const cursor=client.notifications.length,before=requests.length;script.push(()=>({hold:true}));
 const held=await client.request('turn/start',{threadId,input:[{type:'text',text:'Hold this isolated fixture turn for interruption.',text_elements:[]}]});
 for(let i=0;i<100&&requests.length===before;i++)await delay(50);assert.equal(requests.length,before+1);
 await client.request('turn/interrupt',{threadId,turnId:held.turn.id});assert.equal((await waitTurn(held.turn.id,cursor)).status,'interrupted');
 assert.equal((await call('probe_request',{action:'get',requestId})).structuredContent.request.state,'pending');
 assert.equal((await call('probe_comms_snapshot')).structuredContent.sends,0);
 record('saved-request-survives-actual-turn-interrupt',{passed:true,requestId,sends:0,hostQueueTested:false});
 const fc=()=>({type:'function_call',id:'fc_'+randomUUID(),call_id:'call_'+randomUUID(),name:'probe_request',namespace:'mcp__mainsequence_host_probe',arguments:JSON.stringify({action:'deliver',requestId}),status:'completed'});
 const lastOutput=body=>allText(body.input.filter(i=>i.type==='function_call_output').at(-1)?.output);
 const expected='Alpha fixture agent: '+message;
 for(const duplicate of [false,true]){
  script.push(fc,body=>{const output=lastOutput(body);assert.ok(output.includes(message.split('\n')[0]));const decoded=JSON.parse(output.slice(output.indexOf('{')));const actual=decoded.structuredContent||(decoded.request?decoded:JSON.parse(decoded.content.find(c=>c.type==='text').text));assert.equal(actual.request.receipt.result.data.message,expected);assert.equal(actual.reusedReceipt,duplicate);return 'MainSequence fixture · alpha\n\n'+actual.request.receipt.result.data.message;});
  const recovered=await turn('Recover the saved fixture request '+requestId+' using probe_request.');
  assert.equal(script.length,0);assert.equal(recovered.events.filter(e=>e.method==='item/completed'&&e.params.item.type==='mcpToolCall').length,1);
  assert.equal((await call('probe_comms_snapshot')).structuredContent.sends,1);
  record(duplicate?'repeated-native-recovery-reuses-receipt':'native-model-tool-recovery',{passed:true,agentSends:1,turnId:recovered.turnId});
 }
 script.push(body=>{assert.ok(allText(body.input).includes(expected));return expected;});
 const recall=await turn('Quote the previous fixture reply from existing native context without using tools.');
 assert.equal(recall.events.filter(e=>e.method==='item/completed'&&e.params.item.type==='mcpToolCall').length,0);
 const thread=(await client.request('thread/read',{threadId,includeTurns:true})).thread;
 assert.ok(thread.turns.flatMap(t=>t.items).some(i=>i.type==='agentMessage'&&i.text.includes(expected)));
 assert.equal((await call('probe_comms_snapshot')).structuredContent.sends,1);
 record('native-reply-persists-and-recall-needs-no-tool',{passed:true,agentSends:1,recallToolCalls:0,modelFixtureOnly:true});
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{client?.close();endpoint.closeAllConnections();endpoint.close();report.modelFixtureRequests=requests.length;report.fixtureOnly=true;report.desktopUiTested=false;await writeFile(join(root,'receipt-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:join(root,'receipt-result.json'),error:report.error}));}

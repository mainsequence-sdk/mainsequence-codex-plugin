const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {once}=require('node:events'),{spawn}=require('node:child_process'),readline=require('node:readline');
const uid='00000000-0000-0000-0000-000000000001',agentUid='00000000-0000-0000-0000-000000000002';

test('20 packaged Codex chat servers share real HTTP discovery while retaining distinct chat contexts',async t=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ms-panels-')),counts=new Map(),connections=new Set(),children=[];
 let owner;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):null;
  const key=req.method+' '+req.url+(body?' '+body.method+(body.params?.name?' '+body.params.name:''):'');counts.set(key,(counts.get(key)||0)+1);
  await new Promise(resolve=>setTimeout(resolve,20));
  const reply=value=>{res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));};
  if(req.url==='/api/v1/users/me/')return reply({username:'fixture@example.test'});
  if(req.url.startsWith('/api/v1/organization-environments/'))return reply([{uid,name:'Fixture',is_production:false}]);
  assert.ok(!req.url.startsWith('/api/v1/command-center/agents/'),'No separate icon directory or image requests');
  assert.equal(req.url,'/mcp');let result;
  if(body.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}}};
  else if(body.method==='notifications/initialized'){res.writeHead(202).end();return;}
  else if(body.method==='tools/list')result={tools:[{name:'agent.list',inputSchema:{type:'object'}}]};
  else{assert.equal(body.params.name,'agent.list');assert.equal(body.params.arguments.include_icons,true);result={structuredContent:{count:1,results:[{uid:agentUid,name:'Shared Agent',command_center_icon:{rendering:'color',imageRendering:'pixelated',idle:{mime:'image/svg+xml',bytes:Buffer.from('<svg/>').toString('base64')}},organization_environment_uid:uid,organization_environment_name:'Fixture',repository_branch:'main',runtime_release_uid:uid,a2a_profile:{supported_response_kinds:['message']},agent_card:{skills:[]}}]}};}
  reply({jsonrpc:'2.0',id:body.id,result});
 });
 server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{children.forEach(child=>child.kill());if(owner)try{process.kill(owner);}catch{}server.closeAllConnections();server.close();await fs.rm(temporary,{recursive:true,force:true});});
 const backend='http://127.0.0.1:'+server.address().port;
 function client(){
  const child=spawn(process.execPath,[path.resolve('codex/dist/panel-server.js')],{env:{PATH:process.env.PATH,HOME:temporary,MAINSEQUENCE_ENDPOINT:backend,MAINSEQUENCE_ACCESS_TOKEN:'fixture-access'},stdio:['pipe','pipe','pipe']});children.push(child);
  let sequence=0;const pending=new Map();let errors='';child.stderr.on('data',part=>errors+=part);
  readline.createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line),item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);item.resolve(message);}});
  function rpc(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Panel timed out: '+errors)),15000);pending.set(id,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
  return async(name,args={})=>{const output=(await rpc('tools/call',{name,arguments:args,_meta:{threadId:'fixture-'+children.indexOf(child)}})).result;assert.notEqual(output.isError,true,JSON.stringify(output));return output.structuredContent;};
 }
 const clients=Array.from({length:20},client);
 const contexts=await Promise.all(clients.map(call=>call('mainsequence_open')));owner=contexts[0].transport.pid;
 assert.equal(new Set(contexts.map(c=>c.transport.instanceId)).size,1);assert.equal(new Set(contexts.map(c=>c.contextId)).size,20);
 const pages=await Promise.all(clients.map((call,i)=>call('mainsequence_discover',{contextId:contexts[i].contextId,environmentUid:uid,catalog:'agents'})));
 assert.ok(pages.every(page=>page.results[0].name==='Shared Agent'&&page.results[0].icon?.source.startsWith('data:image/svg+xml;base64,')));
 await Promise.all(clients.map((call,i)=>call('mainsequence_view',{contextId:contexts[i].contextId,environmentUid:uid,view:'assets',agentUids:[agentUid]})));
 for(const [key,count]of counts)assert.equal(count,1,'Repeated upstream request: '+key);
 assert.ok(connections.size<=2);
 const warm=await clients[0]('mainsequence_discover',{contextId:contexts[0].contextId,environmentUid:uid,catalog:'agents'});assert.equal(warm.transport.requests,6);
 assert.equal(warm.transport.clients,20);
 const idleRequests=warm.transport.requests;await new Promise(resolve=>setTimeout(resolve,2200));
 assert.equal((await clients[0]('mainsequence_settings',{action:'get'})).transport.requests,idleRequests,'Idle panels make no backend requests');
 await clients[0]('mainsequence_discover',{contextId:contexts[0].contextId,environmentUid:uid,catalog:'agents',refresh:true});
 assert.equal(counts.get('POST /mcp tools/call agent.list'),2,'Explicit Refresh must reach the backend');
 console.log(JSON.stringify({chatProcesses:20,contexts:20,owners:1,requestsForColdDiscovery:6,agentListReads:1,maxConnections:2}));
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkspace}=require('../build/hosts/workspace');
const context={backend:'https://fixture.example',account:'a',conversationId:'chat',projects:new Map([['env',new Set(['project'])]])};
const ok=data=>({schemaVersion:1,action:'fixture',status:'success',summary:'Done',data});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){const calls=[];let release;const workspace=createWorkspace({scoped:async(_,args,fn)=>fn(context,args.environmentUid)},{execute:async(action,input,scope,env,signal,progress)=>{calls.push({action,input,scope,env});if(action==='sync'){progress('Working');await new Promise(r=>{release=r;signal.addEventListener('abort',r);});if(signal.aborted)return {schemaVersion:1,action,status:'cancelled',summary:'Cancelled',effects:{state:'partial-or-uncertain',message:'Inspect changes'}};}return ok({ready:true});}});return {calls,workspace,release:()=>release?.(),call:(name,args,chat='chat',signal=new AbortController().signal)=>workspace.call(name,{contextId:'ctx',environmentUid:'env',...args},()=>{},signal,chat)};}
test('workspace read/mutation boundaries reject unscoped actions and mutable previews',async()=>{const f=fixture();await assert.rejects(f.call('mainsequence_workspace',{action:'sync'}),/Unsupported/);await assert.rejects(f.call('mainsequence_workspace',{action:'update-sdk',input:{root:'/tmp'}}),/dryRun/);await assert.rejects(f.call('mainsequence_action',{action:'setup',input:{backend:'https://other'}}),/arguments/);await assert.rejects(f.call('mainsequence_action',{action:'sync'},'other'),/chat/);await assert.rejects(f.call('mainsequence_action',{action:'organization-project-setup',input:{projectUid:'unseen'}}),/directory/);assert.equal(f.calls.length,0);await f.call('mainsequence_workspace',{action:'update-sdk',input:{root:'/tmp',dryRun:true}});assert.equal(f.calls.length,1);});
test('accepted operation survives native cancellation and exposes explicit cancellation with partial effects',async()=>{const f=fixture(),stop=new AbortController();const {operation}=await f.call('mainsequence_action',{action:'sync',input:{root:'/tmp'}},'chat',stop.signal);stop.abort();assert.equal((await f.call('mainsequence_operations',{action:'get',operationId:operation.id})).operation.status,'running');assert.equal(f.calls.length,1);await f.call('mainsequence_operations',{action:'cancel',operationId:operation.id});await delay(5);const result=(await f.call('mainsequence_operations',{action:'get',operationId:operation.id})).operation;assert.equal(result.status,'cancelled');assert.equal(result.result.effects.state,'partial-or-uncertain');assert.equal(f.calls.length,1);});
const reads=[['deployment-releases',{releaseKind:'harness_agent',search:'risk',days:7,limit:50,offset:0,codeRepositoryBranchUid:'branch'}],['deployment-release',{releaseUid:'release',days:90,limit:100}],['deployment-active',{codeRepositoryBranchUid:'branch'}],['deployment-wait',{runUid:'run',timeoutSeconds:120}]];
test('release reads are workspace reads: allowed with their inputs, routed unchanged, never operations',async()=>{
  const f=fixture();
  for(const [action,input] of reads) assert.equal((await f.call('mainsequence_workspace',{action,input})).result.status,'success');
  assert.deepEqual(f.calls.map(call=>[call.action,call.input,call.env]),reads.map(([action,input])=>[action,input,'env']));
  for(const [action,input] of reads) await assert.rejects(f.call('mainsequence_action',{action,input}),/Unsupported workspace action/);
  await assert.rejects(f.call('mainsequence_workspace',{action:'deployment-releases',input:{environmentUid:'other'}}),/Unsupported workspace arguments/,'the environment comes from the scope, never the input');
  assert.equal(f.calls.length,reads.length);
});
// The default executor with the installed devtools: only backend responses are fixtures.
test('release reads reach devtools as GET requests for the scoped account, and a wait ends with its request',{timeout:15000},async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'ms workspace releases ')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const keys=[...new Set([...Object.keys(process.env).filter(key=>/^MAINSEQUENCE_/.test(key)),'HOME','USERPROFILE','APPDATA'])],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  Object.assign(process.env,{HOME:home,USERPROFILE:home,APPDATA:home,MAINSEQUENCE_ENDPOINT:'https://releases.fixture.test',MAINSEQUENCE_ACCESS_TOKEN:'fixture-releases-access'});
  t.after(()=>{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
  const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,ENV=uid(1),RELEASE=uid(10),RUN=uid(100),requests=[];let runReads=0,read;
  const run={uid:RUN,target_type:'resource_release',target_uid:RELEASE,state:'running',source:'manual',commit_sha:'abc1234def',created_at:new Date().toISOString(),started_at:new Date().toISOString(),target:{uid:RELEASE,resource_release:{uid:RELEASE}},pipeline:{steps:[]}};
  const fetch=async(url,options)=>{
    const u=new URL(url);requests.push({method:options.method,path:u.pathname,query:Object.fromEntries(u.searchParams),authorization:options.headers.Authorization});
    const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    if(u.pathname==='/api/v1/users/me/')return json({username:'fixture-user'});
    if(u.pathname==='/api/v1/resource-releases/')return json({count:1,results:[{uid:RELEASE,name:'pricing-api',release_kind:'fastapi'}]});
    if(u.pathname===`/api/v1/resource-releases/${RELEASE}/`)return json({uid:RELEASE,name:'pricing-api',release_kind:'fastapi'});
    if(u.pathname===`/api/v1/resource-releases/${RELEASE}/revisions/`)return json({count:0,results:[]});
    if(u.pathname==='/api/v1/deployment-runs/')return json({count:1,results:[run]});
    if(u.pathname===`/api/v1/deployment-runs/${RUN}/`){runReads++;read?.();return json(run);}
    return new Response('{}',{status:404});
  };
  const context={backend:'https://releases.fixture.test',account:'fixture-user',conversationId:'chat',projects:new Map()};
  const workspace=createWorkspace({scoped:async(_,args,fn)=>fn(context,args.environmentUid)},{fetch});
  const call=(action,input,signal=new AbortController().signal)=>workspace.call('mainsequence_workspace',{contextId:'ctx',environmentUid:ENV,action,input},()=>assert.fail('no discovery dispatch'),signal,'chat');
  const list=(await call('deployment-releases',{releaseKind:'fastapi'})).result;
  assert.equal(list.status,'success',list.summary);assert.equal(list.data.results[0].activeRun.uid,RUN);assert.equal(list.data.days,7,'the list defaults to a week');
  assert.equal((await call('deployment-release',{releaseUid:RELEASE})).result.data.days,1,'a release history defaults to the last day');
  assert.equal((await call('deployment-release',{releaseUid:RELEASE,days:7})).result.data.release.name,'pricing-api');
  assert.equal((await call('deployment-active',{})).result.data.count,1);
  assert.ok(requests.every(request=>request.method==='GET'&&request.authorization==='Bearer fixture-releases-access'),JSON.stringify(requests));
  assert.ok(requests.filter(request=>request.path!=='/api/v1/users/me/').every(request=>request.path.startsWith('/api/v1/resource-releases/')||request.query.organization_environment_uid===ENV||request.query.target_uid===RELEASE));
  // A wait re-reads its run every ten seconds; stopping the request ends it at once.
  const stop=new AbortController(),firstRead=new Promise(resolve=>{read=resolve;}),started=Date.now();
  const waiting=call('deployment-wait',{runUid:RUN,timeoutSeconds:120},stop.signal).then(value=>({value}),error=>({error}));
  await firstRead;stop.abort();const outcome=await waiting;
  assert.ok(Date.now()-started<5000,'the wait does not outlive its request');assert.equal(runReads,1);
  // The call ends with the request's abort, which the MCP server answers as CANCELLED like any stopped request.
  assert.ok(outcome.error?.name==='AbortError'||outcome.error?.code==='CANCELLED'||outcome.value?.result.status==='cancelled',JSON.stringify(outcome.value||{name:outcome.error.name,code:outcome.error.code}));
});

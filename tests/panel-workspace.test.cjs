const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkspace}=require('../build/hosts/workspace');
const context={backend:'https://fixture.example',account:'a',conversationId:'chat',projects:new Map([['env',new Set(['project'])]])};
const ok=data=>({schemaVersion:1,action:'fixture',status:'success',summary:'Done',data});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){const calls=[];let release;const workspace=createWorkspace({scoped:async(_,args,fn)=>fn(context,args.environmentUid)},{execute:async(action,input,scope,env,signal,progress)=>{calls.push({action,input,scope,env});if(action==='sync'){progress('Working');await new Promise(r=>{release=r;signal.addEventListener('abort',r);});if(signal.aborted)return {schemaVersion:1,action,status:'cancelled',summary:'Cancelled',effects:{state:'partial-or-uncertain',message:'Inspect changes'}};}return ok({ready:true});}});return {calls,workspace,release:()=>release?.(),call:(name,args,chat='chat',signal=new AbortController().signal)=>workspace.call(name,{contextId:'ctx',environmentUid:'env',...args},()=>{},signal,chat)};}
test('workspace read/mutation boundaries reject unscoped actions and mutable previews',async()=>{const f=fixture();await assert.rejects(f.call('mainsequence_workspace',{action:'sync'}),/Unsupported/);await assert.rejects(f.call('mainsequence_workspace',{action:'update-sdk',input:{root:'/tmp'}}),/dryRun/);await assert.rejects(f.call('mainsequence_action',{action:'setup',input:{backend:'https://other'}}),/arguments/);await assert.rejects(f.call('mainsequence_action',{action:'sync'},'other'),/chat/);await assert.rejects(f.call('mainsequence_action',{action:'organization-project-setup',input:{projectUid:'unseen'}}),/directory/);assert.equal(f.calls.length,0);await f.call('mainsequence_workspace',{action:'update-sdk',input:{root:'/tmp',dryRun:true}});assert.equal(f.calls.length,1);});
test('accepted operation survives native cancellation and exposes explicit cancellation with partial effects',async()=>{const f=fixture(),stop=new AbortController();const {operation}=await f.call('mainsequence_action',{action:'sync',input:{root:'/tmp'}},'chat',stop.signal);stop.abort();assert.equal((await f.call('mainsequence_operations',{action:'get',operationId:operation.id})).operation.status,'running');assert.equal(f.calls.length,1);await f.call('mainsequence_operations',{action:'cancel',operationId:operation.id});await delay(5);const result=(await f.call('mainsequence_operations',{action:'get',operationId:operation.id})).operation;assert.equal(result.status,'cancelled');assert.equal(result.result.effects.state,'partial-or-uncertain');assert.equal(f.calls.length,1);});
test('repository setup jobs expose their environment and reject duplicate concurrent setups',async()=>{
 const pending=new Map(),calls=[];
 const workspace=createWorkspace({scoped:async(_,args,fn)=>fn(context,args.environmentUid)},{execute:async(action,input,scope,env,signal,progress)=>{calls.push(input.repositoryUid);progress('Cloning '+input.repositoryUid);await new Promise(resolve=>pending.set(input.repositoryUid,resolve));return ok({root:'/tmp/'+input.repositoryUid});}});
 const call=(name,args)=>workspace.call(name,{environmentUid:'env',...args},()=>{},new AbortController().signal,'chat');
 const one=await call('mainsequence_action',{action:'setup',input:{repositoryUid:'one',branch:'main'}});
 const two=await call('mainsequence_action',{action:'setup',input:{repositoryUid:'two',branch:'main'}});
 assert.equal(one.operation.environmentUid,'env');assert.equal(two.operation.status,'running');
 await assert.rejects(call('mainsequence_action',{action:'setup',input:{repositoryUid:'one',branch:'main'}}),error=>error.code==='PROJECT_BUSY');
 assert.deepEqual(calls,['one','two']);assert.equal((await call('mainsequence_operations',{action:'list'})).operations.length,2);
 pending.get('one')();pending.get('two')();await delay(0);
 assert.ok((await call('mainsequence_operations',{action:'list'})).operations.every(op=>op.status==='success'));
});
test('organization project setup reaches the backend using its expected-account binding',async t=>{
 const project='00000000-0000-4000-8000-000000000001',env='00000000-0000-4000-8000-000000000002',paths=[];
 const previous=Object.fromEntries(['MAINSEQUENCE_ENDPOINT','MAINSEQUENCE_ACCESS_TOKEN','MAINSEQUENCE_REFRESH_TOKEN'].map(key=>[key,process.env[key]]));
 Object.assign(process.env,{MAINSEQUENCE_ENDPOINT:context.backend,MAINSEQUENCE_ACCESS_TOKEN:'fixture-access'});delete process.env.MAINSEQUENCE_REFRESH_TOKEN;
 t.after(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const scope={...context,projects:new Map([[env,new Set([project])]])};
 const workspace=createWorkspace({scoped:async(_,args,fn)=>fn(scope,args.environmentUid)},{fetch:async(url)=>{const path=new URL(url).pathname;paths.push(path);const value=path==='/api/v1/users/me/'?{username:'a'}:path.endsWith('/code-repository-branches/')?[]:{uid:project,organization_environment_uid:env,name:'Empty project',description:'Fixture',code_repository_branch_uids:[]};return new Response(JSON.stringify(value),{status:200});}});
 const call=(name,args)=>workspace.call(name,{environmentUid:env,...args},()=>{},new AbortController().signal,'chat');
 const {operation}=await call('mainsequence_action',{action:'organization-project-setup',input:{projectUid:project,baseDir:'/tmp'}});
 let job;
 for(let i=0;i<100;i++){job=(await call('mainsequence_operations',{action:'get',operationId:operation.id})).operation;if(job.status!=='running')break;await delay(5);}
 assert.equal(job.status,'failure');assert.match(job.result.summary,/no accessible branches/);assert.ok(paths.includes('/api/v1/organization-projects/'+project+'/'),'a real session binding must reach project validation');
});

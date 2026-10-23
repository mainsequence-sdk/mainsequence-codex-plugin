// Host experiment: the unmodified published devtools client with in-memory transports.
// Every destination is .invalid and every request is intercepted; no credentials or network.
import { createRequire } from 'node:module';
import { mkdir, readFile, open, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
let core;
try { core = require('./vendor/devtools'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  core = require('@dev-mainsequence/devtools');
}
const { createDevTools } = core;
export const backend = 'https://platform.probe.invalid';
const projectUrl = 'https://project.probe.invalid/mcp';
const environments = { Research:'10000000-0000-4000-8000-000000000001', Sandbox:'10000000-0000-4000-8000-000000000002' };
const agentIds = { alpha:'20000000-0000-4000-8000-000000000001', beta:'20000000-0000-4000-8000-000000000002' };
const releaseUid = '30000000-0000-4000-8000-000000000001';
const hash = value => createHash('sha256').update(value).digest('hex');
export function contextKey(meta = {}) {
  const id = meta.threadId || meta.thread_id || meta.sessionId || meta.session_id;
  if (typeof id !== 'string' || !id) throw new Error('No host chat identity; refusing to share an agent session across chats.');
  return hash(id);
}
const fresh = () => ({ environment:'Research', bindings:{}, sessions:{}, tasks:{}, calls:[], sent:[], active:null, connected:false, nextFault:null, projectCatalog:'base' });
export async function communicationAction(key, kind, input = {}, progress = () => {}) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid fixture chat key.');
  const dir = join(process.env.MS_HOST_PROBE_DATA_DIR || join(tmpdir(),'mainsequence-codex-host-probe-v2'), 'communications');
  await mkdir(dir,{recursive:true,mode:0o700});
  const file = join(dir,key+'.json'), lock = file+'.lock';
  let guard;
  // Locks from older builds have no owner record: fail closed rather than guess.
  // A unique reclamation claim prevents two callers removing a replacement lock.
  try { guard = await open(lock,'wx',0o600); } catch (error) {
    if(error.code!=='EEXIST')throw error;
    let owner;try{owner=JSON.parse(await readFile(lock,'utf8'));}catch{}
    let dead=false;
    if(Number.isSafeInteger(owner?.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(e){dead=e.code==='ESRCH';}}
    if(!dead||!/^[-a-f0-9]{36}$/.test(owner?.token||''))throw new Error('Another fixture operation is running for this chat.');
    let claim;try{claim=await open(lock+'.reclaim-'+owner.token,'wx',0o600);}catch{throw new Error('Fixture lock recovery already claimed; retry status later.');}
    await claim.close(); // Keep the tombstone: this dead owner can be reclaimed only once.
    if(await readFile(lock,'utf8')!==JSON.stringify(owner))throw new Error('Fixture lock changed; retry status later.');
    await unlink(lock);
    try{guard=await open(lock,'wx',0o600);}catch{throw new Error('Another fixture operation is running for this chat.');}
  }
  await guard.writeFile(JSON.stringify({pid:process.pid,token:randomUUID()}));
  let state;
  const persist=async()=>{
    const temporary=file+'.'+randomUUID()+'.tmp';
    const out=await open(temporary,'wx',0o600);
    try{await out.writeFile(JSON.stringify(state,null,2)+'\n');await out.sync();}finally{await out.close();}
    await rename(temporary,file);
  };
  try {
    try { state = JSON.parse(await readFile(file,'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = fresh(); }
    state.requests ||= {};
    // A prior dispatch without its receipt is never replayed, even after restart.
    for(const request of Object.values(state.requests))if(request.state==='dispatching'){
      request.state='uncertain';request.reason='Dispatch ended without a durable receipt. No automatic replay is allowed.';
    }
    let deliveryRequestId;
    const env = environments[state.environment];
    const record = (method,args={}) => {
      state.calls.push({method,keys:Object.keys(args),...(typeof args.message==='string'?{messageHash:hash(args.message),messageBytes:Buffer.byteLength(args.message)}:{})});
      state.calls = state.calls.slice(-200);
    };
    const row = uid => ({uid,name:uid===agentIds.alpha?'Alpha fixture agent':'Beta fixture agent',organization_environment_uid:env,
      organization_environment_name:state.environment,runtime_release_uid:releaseUid,runtime_update:{state:'ready'},a2a_profile:{supported_response_kinds:['message','task']}});
    const connection = () => ({uid:releaseUid,resource_release_uid:releaseUid,name:'Fixture project MCP',mcp_connection:{
      url:projectUrl,transport:'streamable-http',resource_metadata_url:backend+'/.well-known/oauth-protected-resource/mcp?resource_release_uid='+releaseUid,
      organization_environment_uid:environments.Research,organization_environment_name:'Research',active_revision_uid:'40000000-0000-4000-8000-000000000001'}});
    const projectTools = [{name:'echo',description:'Echo fixture text unchanged.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}},
      {name:'fail',description:'Return a fixture MCP error.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
    if(['expanded','revised'].includes(state.projectCatalog)) {
      const field=state.projectCatalog==='revised'?'value':'text';
      projectTools.push({name:'uppercase',description:'Uppercase the fixture string.',inputSchema:{type:'object',properties:{[field]:{type:'string'}},required:[field],additionalProperties:false}});
    }
    const reply = (message,result) => ({jsonrpc:'2.0',id:message.id,result});
    const handshake = message => message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture-only',version:'1'}}:null;
    async function platformRpc(message) {
      const init = handshake(message); if (init) return reply(message,init);
      if (message.method==='notifications/initialized') return;
      if (message.method==='tools/list') return reply(message,{tools:['agent.list','agent.search','agent.get','agent.get_or_create_session','agent_session.resolve_runtime_access','a2a.send_message','a2a.get_task','a2a.wait_task','a2a.cancel_task','resource_release.mcp_endpoints'].map(name=>({name,inputSchema:{type:'object'}}))});
      if (message.method!=='tools/call') throw new Error('Unexpected fixture protocol method.');
      const {name,arguments:a={}}=message.params; record(name,a); let data;
      if (name==='agent.list'||name==='agent.search') data={count:2,results:Object.values(agentIds).map(row)};
      else if (name==='agent.get') { if (!Object.values(agentIds).includes(a.agent_uid)) throw new Error('Unknown fixture agent.'); data=row(a.agent_uid); }
      else if (name==='agent.get_or_create_session') {
        let s=a.session_uid?state.sessions[a.session_uid]:Object.values(state.sessions).find(x=>x.agent_uid===a.agent_uid&&x.bound_handle.handle_unique_id===a.handle_unique_id);
        if (!s&&a.session_uid) throw new Error('Unknown fixture session.');
        if (!s) { s={uid:randomUUID(),agent_uid:a.agent_uid,organization_environment_uid:env,bound_handle:{handle_unique_id:a.handle_unique_id}};state.sessions[s.uid]=s; }
        data=s;
      } else if (name==='agent_session.resolve_runtime_access') {
        if (!state.sessions[a.agent_session_uid]) throw new Error('Unknown fixture session.');
        data={mode:'token',token:'fixture-runtime-secret-never-output',rpc_url:'https://runtime.probe.invalid',runtime_interaction:{can_submit:true,state:'ready'}};
      } else if (name==='a2a.send_message') {
        const s=state.sessions[a.agent_session_uid] || state.sessions[state.tasks[a.task_uid]?.agent_session_uid];
        if (!s||s.agent_uid!==(a.agent_uid||s.agent_uid)) throw new Error('Wrong fixture conversation.');
        state.sent.push({agent:s.agent_uid,session:s.uid,message:a.message,kind:a.response_kind,...(deliveryRequestId?{requestId:deliveryRequestId}:{})});
        if (state.nextFault==='uncertain') { state.nextFault=null;throw new Error('Simulated transport loss after dispatch.'); }
        data={agent_uid:s.agent_uid,agent_session_uid:s.uid,response_kind:a.response_kind};
        if (a.response_kind==='message') data.message=`${row(s.agent_uid).name}: ${a.message}`;
        else { Object.assign(data,{task_uid:randomUUID(),status:'working',terminal:false,event_cursor:1,outputs:[],events:[]});state.tasks[data.task_uid]=data; }
      } else if (['a2a.get_task','a2a.wait_task','a2a.cancel_task'].includes(name)) {
        data=state.tasks[a.task_uid];if (!data) throw new Error('Unknown fixture task.');
        if (name==='a2a.wait_task') Object.assign(data,{status:'completed',terminal:true,event_cursor:2,outputs:[{text:'Fixture task completed.'}]});
        if (name==='a2a.cancel_task') Object.assign(data,{status:'cancelled',terminal:true,cancellation_requested:true,event_cursor:2});
      } else if (name==='resource_release.mcp_endpoints') data={count:1,results:[connection()]};
      else throw new Error('Unknown fixture platform tool.');
      return reply(message,{content:[],structuredContent:data});
    }
    const session={
      status:async requested=>{if(requested!==backend)throw new Error('Non-fixture backend denied.');return{backend,authenticated:true,source:'host',persistence:'unavailable',store:null,username:'fixture-user'};},
      request:async (requested,method,path,body)=>{
        if(requested!==backend)throw new Error('Non-fixture backend denied.');
        if(path==='/mcp'&&method==='POST')return platformRpc(body);
        if(path===`/api/v1/resource-releases/${releaseUid}/exchange-launch/`)return{mode:'token',release_kind:'fastapi',token:'fixture-release-secret-never-output',rpc_url:'https://project.probe.invalid/'};
        if(path===`/api/v1/resource-releases/${releaseUid}/`)return connection();
        throw new Error('Non-fixture API path denied.');
      }
    };
    const fixtureFetch=async (url,options)=>{
      if(url!==projectUrl||options.headers.Authorization!=='Bearer fixture-release-secret-never-output')throw new Error('Non-fixture transport denied.');
      const message=JSON.parse(options.body);record('project:'+message.method,message.params?.arguments);
      if(message.method==='notifications/initialized')return new Response(null,{status:202});
      let result=handshake(message);
      if(message.method==='tools/list')result={tools:projectTools};
      if(message.method==='tools/call') {
        const {name,arguments:a={}}=message.params;
        if(name==='echo'&&typeof a.text==='string')result={content:[{type:'text',text:a.text}],structuredContent:{echo:a.text,fixture:true}};
        else if(name==='uppercase'&&projectTools.some(t=>t.name===name)&&typeof a[state.projectCatalog==='revised'?'value':'text']==='string') {
          const text=a[state.projectCatalog==='revised'?'value':'text'].toUpperCase();result={content:[{type:'text',text}],structuredContent:{uppercase:text,fixture:true}};
        }
        else result={isError:true,content:[{type:'text',text:'Fixture tool refused the request.'}],structuredContent:{code:'FIXTURE_ERROR'}};
      }
      return new Response(JSON.stringify(reply(message,result)),{headers:{'Content-Type':'application/json'}});
    };
    const tooling=createDevTools({session,fetch:fixtureFetch,env:{},mcpConnectionsPath:join(dir,key+'-mcp.json'),host:{
      progress,openBrowser:async()=>{throw new Error('Browser access disabled.');},runProcess:async()=>{throw new Error('Process execution disabled.');}}});
    const dispatch=values=>tooling.dispatch({backend,environmentUid:env,...values});
    const view=()=>({fixture:true,environment:state.environment,active:state.active,
      bindings:state.bindings,connected:state.connected,projectCatalog:state.projectCatalog||'base',sends:state.sent.length,calls:state.calls,agents:Object.entries(agentIds).map(([alias,uid])=>({alias,...row(uid)}))});
    const validateRoute=request=>{
      const binding=state.bindings[request.agent];
      if(!binding||binding.sessionUid!==request.sessionUid||binding.environment!==request.environment||state.environment!==request.environment)throw new Error('Stale or ended request route; prepare a new request in the current conversation.');
      return binding;
    };
    const requestView=request=>({...request,fixtureDispatches:state.sent.filter(x=>x.requestId===request.requestId).length});
    let answer;
    if(kind==='snapshot') answer=view();
    else if(kind==='request') {
      const {action,requestId}=input;
      if(action==='list')return {requests:Object.values(state.requests).map(requestView)};
      if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new Error('A valid fixture request ID is required.');
      let request=state.requests[requestId];
      if(action==='stage') {
        if(!Object.hasOwn(agentIds,input.agent)||typeof input.message!=='string'||!input.message.trim()||input.message.length>64000)throw new Error('Enter a nonempty fixture message of at most 64000 characters.');
        const target={agent:input.agent,sessionUid:input.sessionUid,environment:state.environment,message:input.message,responseKind:'message'};
        validateRoute(target);
        if(request){if(Object.entries(target).some(([key,value])=>request[key]!==value))throw new Error('Request ID already belongs to different immutable input.');}
        else {
          if(Object.keys(state.requests).length>=1000)throw new Error('Fixture request limit reached.');
          // Multiple panel instances staging identical pending input share one ID.
          request=Object.values(state.requests).find(r=>r.state==='pending'&&Date.parse(r.expiresAt)>Date.now()&&Object.entries(target).every(([key,value])=>r[key]===value));
          if(!request){request={schemaVersion:1,requestId,source:'panel',...target,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),state:'pending',submission:{attempts:0,lastOutcome:'not-submitted'},dispatchAttempts:0,receipt:null};state.requests[requestId]=request;}
        }
      } else {
        if(!request)throw new Error('Unknown request in this chat.');
        if(action==='submission') {
          if(!['attempted','acknowledged','unknown'].includes(input.outcome))throw new Error('Unknown submission outcome.');
          request.submission.lastOutcome=input.outcome;request.submission.updatedAt=new Date().toISOString();
          if(input.outcome==='attempted')request.submission.attempts++;
        } else if(action==='deliver') {
          validateRoute(request);
          if(request.state==='delivered')return {request:requestView(request),reusedReceipt:true};
          if(request.state!=='pending')throw new Error(request.reason||'Request is not eligible for dispatch. No replay is allowed.');
          if(Date.parse(request.expiresAt)<=Date.now()){request.state='expired';throw new Error('Pending request expired without dispatch.');}
          const binding=validateRoute(request);
          if(binding.uncertain)throw new Error('Previous agent delivery is uncertain. No automatic replay is allowed.');
          request.state='dispatching';request.dispatchAttempts++;binding.uncertain=true;
          await persist();
          deliveryRequestId=request.requestId;
          try {
            const response=await dispatch({action:'agent-send',agentUid:binding.agentUid,sessionUid:request.sessionUid,expectedAccount:'fixture-user',message:request.message,responseKind:request.responseKind,waitForReady:true});
            binding.uncertain=!!response.effects;
            request.state=response.status==='success'?'delivered':response.effects?'uncertain':'rejected';
            request.receipt={completedAt:new Date().toISOString(),result:response};
            if(request.state!=='delivered')request.reason=(response.summary||'Delivery not confirmed.')+' No automatic replay is allowed.';
            await persist();
          } catch(error){request.state='uncertain';request.reason='Dispatch did not produce a durable receipt. No automatic replay is allowed.';throw error;}
        } else if(action!=='get')throw new Error('Unknown request action.');
      }
      answer={request:requestView(request),reusedReceipt:false};
    }
    else if(kind==='catalog') {
      if(!['base','expanded','revised'].includes(input.catalog))throw new Error('Unknown fixture catalog.');
      state.projectCatalog=input.catalog;answer=view();
    } else if(kind==='context') {
      if(!Object.hasOwn(environments,input.environment))throw new Error('Unknown fixture environment.');
      if(state.connected){const removed=await dispatch({action:'mcp-remove',releaseUid});if(removed.status!=='success')return removed;}
      state.environment=input.environment;state.active=null;state.bindings={};state.connected=false;answer=view();
    } else if(kind==='agent') {
      const alias=input.agent||'alpha';if(!Object.hasOwn(agentIds,alias))throw new Error('Unknown fixture agent.');
      const agentUid=agentIds[alias];let binding=state.bindings[alias];
      if(input.action==='prepare') {
        const opened=await dispatch({action:'agent-session',agentUid,expectedAccount:'fixture-user',...(binding?{sessionUid:binding.sessionUid}:{handleId:`codex_${key}_${agentUid}_${env}`})});
        if(opened.status!=='success')return opened;
        binding=state.bindings[alias]={...binding,sessionUid:opened.data.sessionUid,agentUid,environment:state.environment,uncertain:binding?.uncertain||false,taskUids:binding?.taskUids||[]};
        const ready=await dispatch({action:'agent-readiness',agentUid,sessionUid:binding.sessionUid,expectedAccount:'fixture-user',timeoutMs:3000});
        if(ready.status==='success')state.active=alias;
        answer={...ready,data:{...ready.data,prefix:`/ms-probe @${alias} `,sends:state.sent.length}};
      } else {
        if(!binding||binding.environment!==state.environment)throw new Error('Prepare this agent in the current environment first.');
        if(input.sessionUid&&input.sessionUid!==binding.sessionUid)throw new Error('Stale fixture conversation.');
        if(input.action==='end'){if(state.active===alias)state.active=null;delete state.bindings[alias];answer={ended:true};}
        else if(input.action==='allow-send'){binding.uncertain=false;answer={allowed:true,resent:false};}
        else if(input.action==='send') {
          if(binding.uncertain)throw new Error('Previous delivery is uncertain. No automatic replay is allowed.');
          if(typeof input.message!=='string'||!input.message.trim()||input.message.length>64000)throw new Error('Enter a nonempty message.');
          binding.uncertain=true;
          // Persist before dispatch, matching the reference's crash/uncertainty guard.
          await persist();
          if(input.simulateUncertain===true)state.nextFault='uncertain';
          answer=await dispatch({action:'agent-send',agentUid,sessionUid:binding.sessionUid,expectedAccount:'fixture-user',message:input.message,responseKind:input.responseKind||'message',waitForReady:true});
          binding.uncertain=!!answer.effects;
          if(answer.data?.taskUid&&!binding.taskUids.includes(answer.data.taskUid))binding.taskUids.push(answer.data.taskUid);
        } else if(['get','wait','cancel'].includes(input.action)) {
          if(!binding.taskUids.includes(input.taskUid))throw new Error('That task belongs to another conversation.');
          answer=await dispatch({action:'agent-task-'+input.action,agentUid,taskUid:input.taskUid,expectedAccount:'fixture-user'});
        } else throw new Error('Unknown fixture agent action.');
      }
    } else if(kind==='mcp') {
      if(!['discover','list','connect','tools','call','disconnect'].includes(input.action))throw new Error('Unknown fixture MCP action.');
      const action='mcp-'+({connect:'add',disconnect:'remove'}[input.action]||input.action);
      answer=await dispatch({action,releaseUid,...(input.action==='call'?{tool:input.tool,arguments:input.arguments||{}}:{})});
      if(answer.status==='success'&&['connect','disconnect'].includes(input.action))state.connected=input.action==='connect';
    } else throw new Error('Unknown communications experiment.');
    return answer;
  } finally {
    try { if(state)await persist(); }
    finally { await guard.close();await unlink(lock); }
  }
}

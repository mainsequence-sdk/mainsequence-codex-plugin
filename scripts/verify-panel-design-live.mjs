// Read-only acceptance and screenshot data. Never stages, sends, connects or invokes tools.
import fs from 'node:fs/promises';
import {rpcProcess} from './lib/rpc.mjs';
const rpc=rpcProcess(process.execPath,['./dist/panel-server.js'],{cwd:new URL('../codex/',import.meta.url).pathname});
const results={}, report={version:'0.7.0',at:new Date().toISOString(),checks:[]};
try {
 await rpc.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'design-read-only',version:'1'}});
 const tools=(await rpc.request('tools/list')).tools;
 const call=async(name,args={})=>{console.log('Reading',name,args.view||args.catalog||'status');const r=await rpc.request('tools/call',{name,arguments:args,_meta:{threadId:'design-read-only-acceptance'}},120000);if(r.isError)throw Error(r.structuredContent?.error?.message);return r.structuredContent;};
 const state=await call('mainsequence_open');results.status=state;results.settings=await call('mainsequence_settings',{action:'get'});report.account={authenticated:state.account.authenticated,checked:state.account.checked};
 if(!state.contextId)throw Error('Verified shared session unavailable');
 results.environments={};
 for(const env of state.environments){
  const selection={contextId:state.contextId,environmentUid:env.uid},data={};results.environments[env.uid]=data;
  const read=async(key,name,args)=>{try{data[key]=await call(name,{...selection,...args});report.checks.push({environment:env.name,view:key,ok:true});}catch(e){data[key]={error:e.message};report.checks.push({environment:env.name,view:key,ok:false,message:e.message});}};
  await read('agents','mainsequence_discover',{catalog:'agents'});
  await read('connections','mainsequence_view',{view:'connections'});
  await read('mcps','mainsequence_discover',{catalog:'tools'});
  await read('projects','mainsequence_view',{view:'projects'});
  await read('repositories','mainsequence_view',{view:'repositories'});
  await read('preferences','mainsequence_view',{view:'preferences'});
  await read('localContext','mainsequence_workspace',{action:'local-context'});
  await read('deployments','mainsequence_workspace',{action:'deployment-history',input:{limit:25,offset:0}});
  data.runs={};data.logs={};for(const run of (data.deployments.result?.data?.results||[]).slice(0,2)){data.runs[run.uid]=await call('mainsequence_workspace',{...selection,action:'deployment-run',input:{runUid:run.uid,kind:run.kind}});if(run.kind==='deployment_run')data.logs[run.uid]=await call('mainsequence_workspace',{...selection,action:'deployment-logs',input:{runUid:run.uid}});}
  if(data.agents.results?.length){await read('assets','mainsequence_view',{view:'assets',agentUids:data.agents.results.map(a=>a.uid)});data.agentDetails={};for(const agent of data.agents.results.slice(0,2)){const detail=await call('mainsequence_view',{...selection,view:'agent',agentUid:agent.uid});data.agentDetails[agent.uid]=detail;}}
  data.projectDetails={};for(const project of (data.projects.results||[]).slice(0,1))data.projectDetails[project.uid]=await call('mainsequence_view',{...selection,view:'project',projectUid:project.uid});
  await fs.writeFile('artifacts/design-snapshot.json',JSON.stringify(results));
  data.catalogs={};for(const mcp of (data.connections.results||[]).slice(0,1))data.catalogs[mcp.uid]=await call('mainsequence_tools',{...selection,releaseUid:mcp.uid});
 }
 const resource=(await rpc.request('resources/read',{uri:tools.find(t=>t.name==='mainsequence_open')._meta.ui.resourceUri})).contents[0];
 await fs.writeFile('artifacts/design-panel.html',resource.text);
 await fs.writeFile('artifacts/design-snapshot.json',JSON.stringify(results));
 await fs.writeFile('artifacts/design-live-acceptance-0.7.0.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} finally {rpc.close();}

// Read-only verification of canonical local/remote repository matching.
import fs from 'node:fs/promises';
import {rpcProcess} from './lib/rpc.mjs';
const rpc=rpcProcess(process.execPath,['./dist/panel-server.js'],{cwd:new URL('../codex/',import.meta.url).pathname});
try {
 await rpc.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'workspace-read-only',version:'1'}});
 const call=async(name,args={})=>{const r=await rpc.request('tools/call',{name,arguments:args,_meta:{threadId:'workspace-read-only'}},120000);if(r.isError)throw Error(r.structuredContent?.error?.message);return r.structuredContent;};
 const status=await call('mainsequence_open');if(!status.contextId)throw Error('Shared login unavailable');
 const local=await call('mainsequence_workspace',{contextId:status.contextId,environmentUid:status.environments[0].uid,action:'local-context'});
 if(local.local.status!=='success')throw Error(local.local.summary);
 const items=local.local.data.items,report={version:status.build.version,at:new Date().toISOString(),accountVerified:status.account.checked,localRepositories:items.length,matchedRemoteRepositories:items.filter(x=>x.repositoryUid).length,build:status.build};
 if(!report.matchedRemoteRepositories)throw Error('Canonical repositories did not match the remote directory');
 const snapshot=JSON.parse(await fs.readFile('artifacts/design-snapshot.json','utf8'));for(const data of Object.values(snapshot.environments))data.localContext=local;
 await fs.writeFile('artifacts/design-snapshot.json',JSON.stringify(snapshot));await fs.writeFile('artifacts/parity-local-discovery-0.7.0.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{rpc.close();}

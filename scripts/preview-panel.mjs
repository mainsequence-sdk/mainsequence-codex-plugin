// Local visual acceptance harness. No backend writes or native message delivery.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const snapshot=JSON.parse(await fs.readFile('artifacts/design-snapshot.json','utf8'));
const brand='data:image/svg+xml;base64,'+(await fs.readFile('manifests/codex/assets/mainsequence-mark.svg')).toString('base64');
const html=(await fs.readFile('src/hosts/panel/panel.html','utf8')).replace('/* MAINSEQUENCE_PANEL_BUILD */ null',JSON.stringify(snapshot.status.build)).replace('--brand-image: none','--brand-image: url("'+brand+'")');
const wrapper=`<!doctype html><html><head><meta charset="utf-8"><title>MainSequence design preview</title><style>html,body{margin:0;height:100%;background:#181818;font:11px system-ui;color:#aaa}header span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}header button{white-space:nowrap}header{height:28px;gap:8px;padding:5px 12px;box-sizing:border-box;display:flex;justify-content:space-between}button{background:transparent;color:inherit;border:0;cursor:pointer}iframe{display:block;width:100%;height:calc(100% - 28px);border:0}</style></head><body><header><span>Design preview · read-only account snapshot</span><button id="theme">Light theme</button></header><iframe id="panel" title="MainSequence" src="/panel"></iframe><script>
const snapshot=${JSON.stringify(snapshot).replaceAll('<','\\u003c')};
let theme='dark';const frame=document.getElementById('panel');
const context=()=>({theme,styles:{variables:{'--color-background-primary':theme==='dark'?'#181818':'#ffffff','--color-background-secondary':theme==='dark'?'#242424':'#f5f5f5','--color-text-primary':theme==='dark'?'#eeeeee':'#242424','--color-text-secondary':theme==='dark'?'#aaaaaa':'#666666','--color-border-secondary':theme==='dark'?'#353535':'#e5e5e5','--font-sans':'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'}}});
document.getElementById('theme').onclick=()=>{theme=theme==='dark'?'light':'dark';document.getElementById('theme').textContent=theme==='dark'?'Light theme':'Dark theme';frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:context()},location.origin);};
addEventListener('message',e=>{if(e.source!==frame.contentWindow||!e.data.id)return;const msg=e.data;let result;
if(msg.method==='ui/initialize')result={hostContext:context()};
else if(msg.method==='tools/call'){
 const a=msg.params.arguments||{}, data=snapshot.environments[a.environmentUid]||{};let value;
 if(msg.params.name==='mainsequence_open')value=snapshot.status;
 else if(msg.params.name==='mainsequence_agent_status')value={requests:[]};
 else if(msg.params.name==='mainsequence_discover')value=a.catalog==='agents'?data.agents:data.mcps;
 else if(msg.params.name==='mainsequence_view')value=a.view==='agent'?data.agentDetails?.[a.agentUid]:a.view==='project'?data.projectDetails?.[a.projectUid]:data[a.view];
 else if(msg.params.name==='mainsequence_settings')value=snapshot.settings||{preferences:{backend:snapshot.status.account.backend,baseDir:'/Users/jose/mainsequence',commandCenterUrl:''},runtime:{nodeVersion:'22',platform:'darwin arm64',capabilities:{}}};
 else if(msg.params.name==='mainsequence_operations')value={operations:[]};
 else if(msg.params.name==='mainsequence_workspace')value=a.action==='local-context'?data.localContext:a.action==='deployment-history'?data.deployments:a.action==='deployment-run'?data.runs?.[a.input.runUid]:a.action==='deployment-logs'?data.logs?.[a.input.runUid]:{result:{status:'success',summary:'Preview',data:{}}};
 else if(msg.params.name==='mainsequence_tools')value=data.catalogs?.[a.releaseUid];
 else value={error:{message:'Actions are disabled in this read-only visual preview.'}};
 if(value?.results&&a.search){const results=value.results.filter(r=>(r.name||r.code_repository_name||'').toLowerCase().includes(a.search.toLowerCase()));value={...value,results,count:results.length};}
 if(value?.error&&typeof value.error==='string')value={error:{message:value.error}};
 result={structuredContent:{...value,build:snapshot.status.build}};
}else result={isError:true};frame.contentWindow.postMessage({jsonrpc:'2.0',id:msg.id,result},location.origin);
});</script></body></html>`;
const server=http.createServer((req,res)=>{if(!['/','/panel'].includes(req.url)){res.writeHead(404).end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(req.url==='/panel'?html:wrapper);});
server.listen(4329,'127.0.0.1',()=>console.log('Read-only design preview: http://127.0.0.1:4329'));

// Execute the shipped panel script against a simulated public MCP App bridge.
// This checks dispatch boundaries; it is not evidence of desktop rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import { stage } from './stage.mjs';
import { captureBuild } from './plugin/build-info.mjs';

function element(attributes={}) {
  return {
    attributes, disabled:false, textContent:'', value:'', hidden:false, children:[],
    dataset:Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5),value])),
    hasAttribute(key){return key in this.attributes;},
    setAttribute(key,value){this.attributes[key]=value;},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;}
  };
}

async function openPanel(artifact, saved = {}) {
  const elements=[...artifact.html.matchAll(/<[a-z][^>]*>/g)].map(([tag])=>element(Object.fromEntries(
    [...tag.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,value??''])
  )));
  const byId=new Map(elements.filter(el=>el.attributes.id).map(el=>[el.attributes.id,el]));
  const properties=new Map(),listeners=new Map(),requests=[];
  const host={build:artifact.build,failSubmission:false,...saved};host.savedRequests ||= [];host.bindings ||= {};
  const receive=data=>listeners.get('message')({source:parent,data:{jsonrpc:'2.0',...data}});
  const parent={postMessage(message){
    requests.push(message);
    if(message.id===undefined)return;
    queueMicrotask(()=>{
      let result;
      if(message.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'test-host'},hostContext:{theme:'dark',styles:{variables:{'--color-background-primary':'#212121'}}}};
      else if(message.method==='ui/message'){
        if(host.failSubmission){receive({id:message.id,error:{message:'Host submission interrupted; delivery unknown.'}});return;}
        result={};
      }else if(message.method==='tools/call'){
        const {name,arguments:args}=message.params;
        if(name==='probe_snapshot')result={structuredContent:{build:host.build,runId:'fixture-run'}};
        else if(name==='probe_comms_snapshot')result={structuredContent:{environment:'Research',bindings:host.bindings,active:host.bindings.alpha?'alpha':null}};
        else if(name==='probe_agent'&&args.action==='prepare'){host.bindings.alpha={sessionUid:'fixture-session',taskUids:[]};result={structuredContent:{data:{sessionUid:'fixture-session'}}};}
        else if(name==='probe_request_stage') {let r=host.savedRequests.find(r=>r.requestId===args.requestId);if(!r){r={...args,environment:'Research',state:'pending',submission:{attempts:0}};host.savedRequests.push(r);}result={structuredContent:{request:r}};}
        else if(name==='probe_request_submission'){const r=host.savedRequests.find(r=>r.requestId===args.requestId);r.submission.lastOutcome=args.outcome;if(args.outcome==='attempted')r.submission.attempts++;result={structuredContent:{request:r}};}
        else if(name==='probe_request')result={structuredContent:args.action==='list'?{requests:host.savedRequests}:{request:host.savedRequests.find(r=>r.requestId===args.requestId)}};
        else if(name==='probe_ui_report')result={structuredContent:{accepted:true}};
        else {receive({id:message.id,error:{message:'Unexpected fixture tool: '+name}});return;}
      }else {receive({id:message.id,error:{message:'Unexpected bridge method: '+message.method}});return;}
      receive({id:message.id,result});
    });
  }};
  const document={
    getElementById:id=>{assert.ok(byId.has(id),'Known element: '+id);return byId.get(id);},
    querySelectorAll:selector=>elements.filter(el=>selector.split(',').some(part=>el.hasAttribute(part.slice(1,-1)))),
    createElement:()=>element(),createTextNode:text=>({textContent:text}),
    documentElement:{style:{setProperty:(name,value)=>properties.set(name,value)}}
  };
  const script=artifact.html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
  await vm.runInNewContext('(async()=>{'+script+'})()',{
    document,parent,window:{},addEventListener:(name,fn)=>listeners.set(name,fn),
    setTimeout,clearTimeout,setInterval,clearInterval,crypto:{randomUUID}
  });
  return {host,requests,properties,receive,el:id=>byId.get(id),click:id=>byId.get(id).onclick()};
}

test('panel refuses mismatched builds, recovers without replay, and preserves exact native requests',async t=>{
  const root=await stage();t.after(()=>rm(root,{recursive:true,force:true}));
  const artifact=captureBuild(join(root,'plugins/mainsequence-host-probe'));
  const panel=await openPanel(artifact);
  assert.match(panel.el('probe-version').textContent,/0\.6\.0/);
  assert.equal(panel.el('talk-alpha').disabled,false);
  assert.equal(panel.properties.get('--color-background-primary'),'#212121');
  await panel.click('talk-alpha');
  const literal='Exact fixture input\n  second line <untrusted> $()';
  panel.el('message').value=literal;
  const native=()=>panel.requests.filter(r=>r.method==='ui/message');
  const agentSends=()=>panel.requests.filter(r=>r.method==='tools/call'&&r.params.name==='probe_agent'&&r.params.arguments.action==='send');
  await panel.click('send-native');
  assert.equal(native().length,1);assert.equal(agentSends().length,0);
  const submitted=native()[0].params;
  assert.equal(submitted._meta['openai/message'].send,true);
  const requestId=JSON.parse(submitted.content[0].text.split('\n\n').at(-1)).requestId;
  assert.equal(panel.host.savedRequests[0].message,literal);
  assert.equal(panel.host.savedRequests[0].submission.lastOutcome,'acknowledged');
  assert.equal(panel.host.savedRequests[0].state,'pending');
  assert.match(panel.el('status').textContent,/reply is not confirmed/);

  // A server/resource change between clicks must stop the second submission.
  panel.host.build={...artifact.build,buildId:'different-server'};
  await panel.click('send-native');
  assert.equal(native().length,1);assert.equal(agentSends().length,0);
  assert.equal(panel.el('send-native').disabled,true);
  assert.equal(panel.el('message').value,literal);
  assert.match(panel.el('status').textContent,/build mismatch/);
  panel.host.build={...artifact.build,resourceUri:'ui://other-resource'};
  await panel.click('check-build');assert.equal(panel.el('send-native').disabled,true);

  panel.host.build=artifact.build;
  await panel.click('check-build');
  assert.equal(panel.el('send-native').disabled,false);
  assert.equal(native().length,1); // Recovery never dispatches the blocked action.
  panel.host.failSubmission=true;
  await panel.click('send-native');
  assert.equal(native().length,2);assert.equal(agentSends().length,0);
  assert.match(panel.el('status').textContent,/delivery unknown/);
  panel.host.failSubmission=false;
  await panel.click('check-build');assert.equal(native().length,2);

  await panel.receive({method:'ui/notifications/host-context-changed',params:{theme:'light',styles:{variables:{'--color-background-primary':'#ffffff'}}}});
  assert.equal(panel.properties.get('--color-background-primary'),'#ffffff');
  await panel.click('draft');
  assert.equal(native().at(-1).params._meta['openai/message'].send,false);
  assert.equal(JSON.parse(native().at(-1).params.content[0].text.split('\n\n').at(-1)).requestId,requestId);
  assert.equal(panel.host.savedRequests.length,1);
  const reopened=await openPanel(artifact,panel.host);
  assert.equal(reopened.requests.filter(r=>r.method==='ui/message').length,0);
  assert.match(reopened.el('receipt-state').textContent,/awaiting agent dispatch/);
  await reopened.click('recover');
  const recovery=reopened.requests.find(r=>r.method==='ui/message');
  assert.equal(JSON.parse(recovery.params.content[0].text.split('\n\n').at(-1)).requestId,requestId);
  assert.equal(reopened.requests.filter(r=>r.method==='tools/call'&&r.params.name==='probe_agent'&&r.params.arguments.action==='send').length,0);
  panel.host.savedRequests[0].state='delivered';
  await reopened.click('receipts');assert.match(reopened.el('receipt-state').textContent,/Agent reply recorded/);
  panel.host.savedRequests[0].state='uncertain';
  await reopened.click('receipts');assert.equal(reopened.el('recover').disabled,true);
});

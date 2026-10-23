import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {communicationAction,contextKey} from './plugin/communications.mjs';

// All transport is the existing devtools client with counted .invalid fixtures.
test('saved requests survive an undelivered host message and recover without duplicate dispatch',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ms-requests-'));process.env.MS_HOST_PROBE_DATA_DIR=dir;t.after(()=>rm(dir,{recursive:true,force:true}));
 const key=contextKey({threadId:'receipt-chat'}),file=join(dir,'communications',key+'.json');
 const run=(kind,input={})=>communicationAction(key,kind,input),request=(action,input={})=>run('request',{action,...input});
 const prepared=await run('agent',{action:'prepare',agent:'alpha'}),sessionUid=prepared.data.sessionUid;
 const message='NEW-STOP-RECOVERY-UNIT\n  immutable "quotes" $() </data>',requestId=randomUUID();
 const input={requestId,agent:'alpha',sessionUid,message};
 assert.equal((await request('stage',input)).request.state,'pending');
 await request('submission',{requestId,outcome:'attempted'});await request('submission',{requestId,outcome:'acknowledged'});
 assert.equal((await run('snapshot')).sends,0);
 await assert.rejects(()=>request('stage',{...input,message:'rewritten'}),/immutable/);
 assert.equal((await request('stage',{...input,requestId:randomUUID()})).request.requestId,requestId);
 const child=(action)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {communicationAction} from ${JSON.stringify(new URL('./plugin/communications.mjs',import.meta.url).href)};console.log(JSON.stringify(await communicationAction(${JSON.stringify(key)},'request',${JSON.stringify({action,requestId})})));`],{encoding:'utf8',env:process.env}));
 // No native delivery: reopen in a fresh process, then explicitly recover the same ID.
 assert.equal(child('get').request.state,'pending');assert.equal((await run('snapshot')).sends,0);
 const results=await Promise.allSettled([request('deliver',{requestId}),request('deliver',{requestId})]);
 assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.request.state==='delivered'));
 assert.equal((await run('snapshot')).sends,1);
 const receipt=child('deliver');assert.equal(receipt.reusedReceipt,true);assert.equal(receipt.request.fixtureDispatches,1);
 assert.equal(receipt.request.receipt.result.data.message,'Alpha fixture agent: '+message);
 assert.equal((await run('snapshot')).sends,1);
 assert.equal((await readFile(file,'utf8')).includes('fixture-runtime-secret'),false);
 await assert.rejects(()=>communicationAction(contextKey({threadId:'wrong-chat'}),'request',{action:'deliver',requestId}),/Unknown request/);
 await t.test('expired and stale routes cannot dispatch',async()=>{
  const freshId=randomUUID();await request('stage',{...input,requestId:freshId,message:'expire'});
  let state=JSON.parse(await readFile(file));state.requests[freshId].expiresAt='2000-01-01T00:00:00Z';await writeFile(file,JSON.stringify(state));
  await assert.rejects(()=>request('deliver',{requestId:freshId}),/expired/);
  const stale=randomUUID();await request('stage',{...input,requestId:stale,message:'ended'});await run('agent',{action:'end',agent:'alpha'});
  await assert.rejects(()=>request('deliver',{requestId:stale}),/Stale or ended/);assert.equal((await run('snapshot')).sends,1);
 });
 await t.test('uncertain dispatch cannot be retried even after clearing the old agent guard',async()=>{
  const session=(await run('agent',{action:'prepare',agent:'alpha'})).data.sessionUid;
  const id=randomUUID();await request('stage',{requestId:id,agent:'alpha',sessionUid:session,message:'uncertain new fixture'});
  const state=JSON.parse(await readFile(file));state.nextFault='uncertain';await writeFile(file,JSON.stringify(state));
  const uncertain=await request('deliver',{requestId:id});assert.equal(uncertain.request.state,'uncertain');assert.equal(uncertain.request.fixtureDispatches,1);
  const count=(await run('snapshot')).sends;await run('agent',{action:'allow-send',agent:'alpha'});
  await assert.rejects(()=>request('deliver',{requestId:id}),/No automatic replay|uncertain/i);assert.equal((await run('snapshot')).sends,count);
 });
 await t.test('process death during dispatch fails closed and stale lock recovery is exclusive',async()=>{
  const session=(await run('agent',{action:'prepare',agent:'alpha'})).data.sessionUid;
  const id=randomUUID();await request('stage',{requestId:id,agent:'alpha',sessionUid:session,message:'crash boundary new fixture'});
  const child=spawn(process.execPath,['--input-type=module','-e',`import {readFileSync,writeFileSync} from 'node:fs'; const p=${JSON.stringify(file)};let s=JSON.parse(readFileSync(p));s.requests[${JSON.stringify(id)}].state='dispatching';s.bindings.alpha.uncertain=true;writeFileSync(p,JSON.stringify(s));writeFileSync(p+'.lock',JSON.stringify({pid:process.pid,token:${JSON.stringify(randomUUID())}}));process.stdout.write('ready');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
  await once(child.stdout,'data');child.kill('SIGKILL');await once(child,'exit');
  const count=JSON.parse(await readFile(file)).sent.length;
  const reads=await Promise.allSettled([request('get',{requestId:id}),request('get',{requestId:id})]);
  assert.ok(reads.some(r=>r.status==='fulfilled'&&r.value.request.state==='uncertain'));
  await assert.rejects(()=>request('deliver',{requestId:id}),/No automatic replay/);assert.equal((await run('snapshot')).sends,count);
 });
});

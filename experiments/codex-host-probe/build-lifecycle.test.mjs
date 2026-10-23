import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stage } from './stage.mjs';
import { captureBuild, writeBuildManifest, assertImmutableVersion } from './plugin/build-info.mjs';
import { rpcProcess } from './rpc.mjs';

async function connect(root, dataDir) {
  const client = rpcProcess(process.execPath, [join(root,'server.mjs')], {env:{...process.env,MS_HOST_PROBE_DATA_DIR:dataDir}});
  const initialized = await client.request('initialize',{protocolVersion:'2026-01-26',clientInfo:{name:'probe-lifecycle-test',version:'1'},capabilities:{}});
  client.notify('notifications/initialized');
  return {client, initialized, call:(name,args={})=>client.request('tools/call',{name,arguments:args,_meta:{threadId:'fixture-upgrade-chat'}})};
}

test('packaged build identity is deterministic and includes server and panel contents',async t=>{
  const root=await stage();t.after(()=>rm(root,{recursive:true,force:true}));
  const plugin=join(root,'plugins/mainsequence-host-probe');
  const first=captureBuild(plugin);
  assert.deepEqual(captureBuild(plugin).build,first.build);
  assert.equal(first.packaged,true);
  assert.equal(first.resourceSha256,createHash('sha256').update(first.html).digest('hex'));
  assert.ok(first.html.includes(first.build.buildId));
  assert.ok(!first.html.includes('/* MAINSEQUENCE_PANEL_BUILD */ null'));
  execFileSync(process.execPath,['--input-type=module','--check'],{input:first.html.match(/<script type="module">([\s\S]*)<\/script>/)[1]});
  await writeFile(join(plugin,'server.mjs'),(await readFile(join(plugin,'server.mjs'),'utf8'))+'\n// fixture revision\n');
  assert.throws(()=>captureBuild(plugin),/differs from its recorded build/);
  const changed=writeBuildManifest(plugin);
  assert.notEqual(changed.buildId,first.build.buildId);
  assert.notEqual(changed.resourceUri,first.build.resourceUri);
  assert.throws(()=>assertImmutableVersion(first.build,changed),/Increment the fixture version/);
  assert.doesNotThrow(()=>assertImmutableVersion(first.build,{...changed,pluginVersion:'99.0.0-fixture'}));
  assert.doesNotThrow(()=>assertImmutableVersion(first.build,first.build));
});

test('staging removes obsolete files and refuses changed versions before altering the registered source',async t=>{
  const root=await stage();t.after(()=>rm(root,{recursive:true,force:true}));
  const plugin=join(root,'plugins/mainsequence-host-probe'),first=captureBuild(plugin);
  const receipt=join(root,'installation-receipt.json');
  await writeFile(receipt,JSON.stringify({build:first.build}));
  await writeFile(join(plugin,'obsolete-fixture-file'),'not part of the next package');
  await stage(root);
  assert.deepEqual(captureBuild(plugin).build,first.build);
  await assert.rejects(()=>readFile(join(plugin,'obsolete-fixture-file')),error=>error.code==='ENOENT');
  await writeFile(receipt,JSON.stringify({build:{...first.build,buildId:'different-installed-build'}}));
  await assert.rejects(()=>stage(root),/Increment the fixture version/);
  assert.deepEqual(captureBuild(plugin).build,first.build);
});

test('running server retains its exact resource after cache removal; next build preserves sessions without replay',async t=>{
  const root=await stage(),nextRoot=await mkdtemp(join(tmpdir(),'ms-probe-next-'));
  t.after(()=>Promise.all([rm(root,{recursive:true,force:true}),rm(nextRoot,{recursive:true,force:true})]));
  const oldPlugin=join(root,'plugins/mainsequence-host-probe'),newPlugin=join(nextRoot,'plugin'),dataDir=join(root,'fixture-state');
  await mkdir(dataDir);await cp(oldPlugin,newPlugin,{recursive:true});
  const manifestPath=join(newPlugin,'.codex-plugin/plugin.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.version='99.0.0-fixture';await writeFile(manifestPath,JSON.stringify(manifest));
  await writeFile(join(newPlugin,'panel.html'),(await readFile(join(newPlugin,'panel.html'),'utf8'))+'\n<!-- next fixture build -->\n');
  const nextBuild=writeBuildManifest(newPlugin);
  const old=await connect(oldPlugin,dataDir);t.after(()=>old.client.close());
  const before=(await old.call('probe_snapshot')).structuredContent;
  assert.equal(old.initialized.serverInfo.version,before.build.pluginVersion);
  const prepared=(await old.call('probe_agent',{action:'prepare',agent:'alpha'})).structuredContent;
  await old.call('probe_agent',{action:'send',agent:'alpha',sessionUid:prepared.data.sessionUid,message:'one literal\n  upgrade message'});
  const firstResource=await old.client.request('resources/read',{uri:before.build.resourceUri});
  await rm(oldPlugin,{recursive:true,force:true}); // The CLI can remove an old package cache.
  assert.deepEqual(await old.client.request('resources/read',{uri:before.build.resourceUri}),firstResource);
  assert.equal((await old.call('probe_snapshot')).structuredContent.build.buildId,before.build.buildId);
  assert.equal((await old.call('probe_comms_snapshot')).structuredContent.sends,1);
  const next=await connect(newPlugin,dataDir);t.after(()=>next.client.close());
  const after=(await next.call('probe_snapshot')).structuredContent;
  assert.equal(after.build.buildId,nextBuild.buildId);assert.notEqual(after.runId,before.runId);
  assert.notEqual(after.build.resourceUri,before.build.resourceUri);
  await assert.rejects(()=>next.client.request('resources/read',{uri:before.build.resourceUri}),/Unknown fixture resource/);
  const restored=(await next.call('probe_comms_snapshot')).structuredContent;
  assert.equal(restored.sends,1);assert.equal(restored.bindings.alpha.sessionUid,prepared.data.sessionUid);
  assert.ok(!JSON.stringify(after.build).includes(root));
});

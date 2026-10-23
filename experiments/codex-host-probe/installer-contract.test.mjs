import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stage } from './stage.mjs';
import { captureBuild } from './plugin/build-info.mjs';

test('desktop installer verifies its cache and refuses a changed version in an isolated Codex profile',async t=>{
  const root=await stage();t.after(()=>rm(root,{recursive:true,force:true}));
  const home=join(root,'isolated-codex-home');await mkdir(home);
  const env=Object.fromEntries(['PATH','HOME','TMPDIR','TERM','MS_HOST_PROBE_CODEX'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  env.CODEX_HOME=home;
  const install=()=>execFileSync(process.execPath,[fileURLToPath(new URL('./install-desktop.mjs',import.meta.url)),root],{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  const output=install(),receiptPath=join(root,'installation-receipt.json');
  const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
  const installed=captureBuild(receipt.installedPath).build;
  assert.equal(installed.buildId,receipt.build.buildId);
  assert.ok((await realpath(receipt.installedPath)).startsWith((await realpath(home))+'/'));
  assert.match(output,/"status": "not-observed"/);
  install(); // Identical content is a safe reinstall.
  await writeFile(receiptPath,JSON.stringify({...receipt,build:{...receipt.build,buildId:'previously-installed-different-content'}}));
  assert.throws(install,error=>error.status!==0&&error.stderr.includes('Increment the fixture version'));
  assert.equal(captureBuild(receipt.installedPath).build.buildId,installed.buildId);
  assert.equal(captureBuild(join(root,'plugins/mainsequence-host-probe')).build.buildId,installed.buildId);
});

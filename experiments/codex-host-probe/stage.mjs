import { mkdtemp, mkdir, cp, writeFile, readFile, realpath, rm, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeBuildManifest, assertImmutableVersion } from './plugin/build-info.mjs';

export const pluginId = 'mainsequence-host-probe@mainsequence-host-probe';
export const binary = process.env.MS_HOST_PROBE_CODEX || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
export async function stage(existingRoot, { createNew = false } = {}) {
  let created = false;
  if (existingRoot && createNew) {
    try { await mkdir(existingRoot); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const root = existingRoot ? await realpath(existingRoot) : await mkdtemp(join(tmpdir(),'mainsequence-host-probe-'));
  if (existingRoot && !created) {
    const manifest = JSON.parse(await readFile(join(root,'.agents','plugins','marketplace.json'),'utf8'));
    if (manifest.name !== 'mainsequence-host-probe' || manifest.plugins?.length !== 1 || manifest.plugins[0].name !== 'mainsequence-host-probe') throw new Error('Refusing to update a marketplace other than the disposable probe.');
  }
  await mkdir(join(root,'.agents','plugins'),{recursive:true});
  // Copy the already installed, unmodified published dependency into the disposable package.
  // No production dependency, devtools source or Claude code is edited.
  const devtools=join(dirname(fileURLToPath(import.meta.url)),'../../node_modules/@dev-mainsequence/devtools');
  const version=JSON.parse(await readFile(join(devtools,'package.json'),'utf8')).version;
  if(!['0.3.0','0.3.1'].includes(version))throw new Error('Qualify this fixture against the installed devtools version before packaging it.');
  // Build separately: a refused version must not alter the registered source,
  // and files removed from the source must not survive an incremental copy.
  const candidate = await mkdtemp(join(root,'.probe-stage-'));
  try {
    await cp(join(dirname(fileURLToPath(import.meta.url)),'plugin'),candidate,{recursive:true});
    await cp(devtools,join(candidate,'vendor','devtools'),{recursive:true});
    const build = writeBuildManifest(candidate);
    let receipt;
    try { receipt = JSON.parse(await readFile(join(root,'installation-receipt.json'),'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assertImmutableVersion(receipt?.build,build);
    await mkdir(join(root,'plugins'),{recursive:true});
    await rm(join(root,'plugins','mainsequence-host-probe'),{recursive:true,force:true});
    await rename(candidate,join(root,'plugins','mainsequence-host-probe'));
  } finally { await rm(candidate,{recursive:true,force:true}); }
  await writeFile(join(root,'.agents','plugins','marketplace.json'), JSON.stringify({
    name:'mainsequence-host-probe',interface:{displayName:'MainSequence Host Probe (local test)'},plugins:[{
      name:'mainsequence-host-probe',source:{source:'local',path:'./plugins/mainsequence-host-probe'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'
    }]
  },null,2)+'\n');
  return root;
}

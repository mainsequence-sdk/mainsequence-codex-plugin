// Explicit opt-in installer for the one disposable probe. No real plugin is changed.
import { execFileSync } from 'node:child_process';
import { realpath, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, binary, pluginId } from './stage.mjs';
import { assertImmutableVersion, captureBuild } from './plugin/build-info.mjs';
// Desktop installs must survive temporary-directory cleanup. Isolated test runners
// still use stage() without a path and keep their profiles disposable.
// Pass the previously printed marketplaceRoot to update a different existing source.
const root = await stage(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)),'.local-marketplace'), {createNew: !process.argv[2]});
const expected = captureBuild(join(root,'plugins','mainsequence-host-probe')).build;
const receiptPath = join(root,'installation-receipt.json');
let previous;
try { previous = JSON.parse(await readFile(receiptPath,'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assertImmutableVersion(previous?.build, expected);
let installation;
for (const args of [['plugin','marketplace','add',root,'--json'],['plugin','add',pluginId,'--json']]) {
  const result = execFileSync(binary,args,{encoding:'utf8',timeout:30000});
  process.stdout.write(result);
  if (args[1] === 'add') installation = JSON.parse(result);
}
if (!installation?.installedPath) throw new Error('Codex did not return an installed probe path.');
const installed = captureBuild(installation.installedPath).build;
if (installed.buildId !== expected.buildId) throw new Error('Installed probe does not match the staged build.');
await writeFile(receiptPath,JSON.stringify({pluginId,build:installed,installedPath:installation.installedPath},null,2)+'\n');
const marketplacePath = await realpath(join(root,'.agents','plugins','marketplace.json'));
const detailLink = `codex://plugins/mainsequence-host-probe?marketplacePath=${encodeURIComponent(marketplacePath)}`;
console.log(JSON.stringify({marketplaceRoot:root,pluginId,detailLink,localOnly:true,installation:{verified:true,...installed},activation:{status:'not-observed',check:'Compare probe_snapshot.build with the panel Running build section. Installation alone does not prove activation.'},cleanup:[`codex plugin remove ${pluginId}`,'codex plugin marketplace remove mainsequence-host-probe']},null,2));

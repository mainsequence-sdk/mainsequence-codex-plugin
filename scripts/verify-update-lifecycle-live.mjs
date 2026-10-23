// Read-only acceptance using the shared machine session. Delete only a disposable
// copy of the package while its server is running; never touch the installed cache.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rpcProcess } from './lib/rpc.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const temporary = await fs.mkdtemp(path.join(tmpdir(), 'ms-update-lifecycle-'));
const installed = path.join(temporary, 'plugin');
const report = { at: new Date().toISOString(), version: pkg.version, devtoolsVersion: pkg.dependencies['@dev-mainsequence/devtools'], checks: [], remoteWrites: 0 };
let rpc;
async function call(name, args = {}) {
  const started = performance.now();
  const result = await rpc.request('tools/call', { name, arguments: args, _meta: { threadId: 'read-only-update-lifecycle' } }, 125000);
  const data = result.structuredContent;
  const check = { tool: name, action: args.action || args.view || args.catalog, ok: !result.isError, elapsedMs: Math.round(performance.now() - started) };
  report.checks.push(check);
  console.log(JSON.stringify(check));
  assert.notEqual(result.isError, true, data?.error?.code || name + ' failed');
  return data;
}
try {
  await fs.cp(path.join(root, 'codex'), installed, { recursive: true });
  rpc = rpcProcess(process.execPath, ['./dist/panel-server.js'], { cwd: installed });
  await rpc.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'update-lifecycle-acceptance', version: pkg.version } });
  const tools = (await rpc.request('tools/list')).tools;
  const uri = tools.find(t => t.name === 'mainsequence_open')._meta.ui.resourceUri;
  const original = (await rpc.request('resources/read', { uri })).contents[0].text;
  await fs.rm(installed, { recursive: true, force: true });
  report.packageRemovedWhileRunning = true;
  const state = await call('mainsequence_open');
  assert.equal(state.build.version, pkg.version);
  assert.equal(state.build.devtoolsVersion, report.devtoolsVersion);
  assert.equal(state.account.checked, true);
  assert.equal(state.account.authenticated, true);
  assert.ok(state.contextId, state.issue?.code);
  assert.ok(!state.issue, state.issue?.code);
  assert.ok(state.environments.length > 0);
  report.accountVerified = true;
  report.environments = state.environments.map(e => e.name);
  const environment = state.environments.find(e => e.name === 'Production');
  assert.ok(environment, 'Choose the known Production environment without guessing a different one');
  const scope = { contextId: state.contextId, environmentUid: environment.uid };
  const agents = await call('mainsequence_discover', { ...scope, catalog: 'agents' });
  report.agentCount = agents.count;
  const saved = await call('mainsequence_view', { ...scope, view: 'connections' });
  report.savedConnectionCount = saved.results.length;
  const crm = saved.results.find(r => r.uid === '2de75e21-bfe1-4b77-b668-6916488ed317');
  assert.ok(crm, 'Existing saved CRM connection is readable');
  const catalog = await call('mainsequence_tools', { ...scope, releaseUid: crm.uid });
  report.crmToolCount = catalog.tools.length;
  assert.ok(catalog.tools.some(t => t.name === 'crm_contacts_get'));
  const settings = await call('mainsequence_settings', { action: 'get' });
  assert.equal(settings.runtime.pluginWorkspace, null);
  assert.ok(!settings.runtime.workingDirectory.startsWith(temporary));
  assert.equal((await fs.stat(settings.runtime.workingDirectory)).isDirectory(), true);
  const workspace = await call('mainsequence_workspace', { ...scope, action: 'local-context' });
  assert.equal(workspace.pluginWorkspace, null);
  assert.equal(workspace.local.status, 'success');
  report.localRepositoryCount = workspace.local.data.items.length;
  assert.equal((await rpc.request('resources/read', { uri })).contents[0].text, original);
  report.immutablePanelSurvived = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  rpc?.close();
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.writeFile(path.join(root, `artifacts/update-lifecycle-live-${pkg.version}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { CODEX_CATALOG_URL, compareVersions, updateStatus, createPluginUpdate } = require('../build/hosts/pluginUpdate.js');

const signal = new AbortController().signal;
const catalog = version => ({ name: 'mainsequence', plugins: [{ name: 'mainsequence', source: { source: 'npm', package: '@dev-mainsequence/codex-plugin', version } }] });
const listed = version => ({ installed: version ? [{ pluginId: 'mainsequence@mainsequence', name: 'mainsequence', marketplaceName: 'mainsequence', version, enabled: true }]
  : [{ pluginId: 'mainsequence@mainsequence-local', name: 'mainsequence', marketplaceName: 'mainsequence-local', version: '0.7.11', enabled: true }], available: [] });
async function executable(t, name = 'codex') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, name); await fs.writeFile(file, ''); return file;
}
/** A fake Codex: `plugin list --json` answers from `installed`, and every command is recorded. */
function harness(parent, { installed = '0.7.11', afterAdd, latest = '0.7.12', exit = () => 0 } = {}) {
  const runs = [], fetched = [];
  let clock = 0, current = installed;
  const host = { openBrowser: async () => false, runProcess: async spec => {
    runs.push(spec);
    const code = exit(spec.args);
    if (spec.args[1] === 'add' && code === 0 && afterAdd) current = afterAdd;
    return { exitCode: code, stdout: spec.args[1] === 'list' ? JSON.stringify(listed(current)) : '', stderr: '' };
  } };
  const fetch = async url => { fetched.push(url); return latest instanceof Error ? Promise.reject(latest) : { ok: true, text: async () => JSON.stringify(catalog(latest)) }; };
  return { runs, fetched, advance: ms => { clock += ms; }, plugin: createPluginUpdate({ version: '0.7.11', host, fetch, now: () => clock, parentExecutable: async () => parent }) };
}

test('versions order by release, with a prerelease before its release', () => {
  assert.equal(compareVersions('0.7.12', '0.7.11'), 1);
  assert.equal(compareVersions('0.7.9', '0.7.10'), -1);
  assert.equal(compareVersions('0.7.12-rc.1', '0.7.12'), -1);
  assert.equal(updateStatus('0.7.11', '0.7.12', '0.7.12'), 'restart_required');
  assert.equal(updateStatus('0.7.11', '0.7.11', null), 'unknown');
});

test("the version check reads Codex's installed copy and the published catalog, and one check serves a while", async t => {
  const h = harness(await executable(t));
  const data = await h.plugin.call({ action: 'version' }, signal);
  assert.deepEqual(data, { running: '0.7.11', installed: '0.7.11', latest: '0.7.12', status: 'update_available', updateSupported: true });
  assert.deepEqual(h.runs.map(run => run.args.join(' ')), ['plugin list --json']); assert.deepEqual(h.fetched, [CODEX_CATALOG_URL]);
  await h.plugin.call({ action: 'version' }, signal);
  assert.equal(h.fetched.length, 1, 'a panel reopened soon after reuses the check');
  await h.plugin.call({ action: 'version', recheck: true }, signal);
  h.advance(31 * 60_000); await h.plugin.call({ action: 'version' }, signal);
  assert.equal(h.fetched.length, 3);
});

test('a dev install, a missing Codex or an unreachable catalog still reports the running version', async t => {
  const local = harness(await executable(t), { installed: null });
  const data = await local.plugin.call({ action: 'version' }, signal);
  assert.deepEqual([data.status, data.installed, data.updateSupported], ['update_available', null, false]);
  await assert.rejects(local.plugin.call({ action: 'update' }, signal), { code: 'UNSUPPORTED_ACTION' });
  assert.equal(local.runs.some(run => run.args[1] !== 'list'), false);
  for (const parent of [await executable(t, 'node'), 'relative/codex', path.join(os.tmpdir(), 'missing-codex', 'codex')]) {
    const h = harness(parent);
    assert.equal((await h.plugin.call({ action: 'version' }, signal)).updateSupported, false, parent);
    assert.equal(h.runs.length, 0, 'only the Codex that started the server is ever run');
  }
  const offline = harness(await executable(t), { latest: new Error('offline') });
  const answer = await offline.plugin.call({ action: 'version' }, signal);
  assert.equal(answer.status, 'unknown'); assert.match(answer.catalogError, /could not be reached/);
  await offline.plugin.call({ action: 'version' }, signal);
  assert.equal(offline.fetched.length, 2, 'a failed check is never reused');
});

test("updating refreshes the marketplace, then reinstalls with Codex's own commands", async t => {
  const h = harness(await executable(t), { afterAdd: '0.7.12' });
  await h.plugin.call({ action: 'version' }, signal);
  const data = await h.plugin.call({ action: 'update' }, signal);
  assert.deepEqual(data, { running: '0.7.11', previous: '0.7.11', installed: '0.7.12', status: 'restart_required' });
  assert.deepEqual(h.runs.map(run => run.args.join(' ')), ['plugin list --json', 'plugin list --json', 'plugin marketplace upgrade mainsequence', 'plugin add mainsequence@mainsequence', 'plugin list --json']);
  assert.equal((await h.plugin.call({ action: 'version' }, signal)).status, 'restart_required', 'the update invalidates the cached check');
});

test('a failed refresh or install is reported and nothing else runs', async t => {
  const refresh = harness(await executable(t), { exit: args => args[1] === 'marketplace' ? 1 : 0 });
  await assert.rejects(refresh.plugin.call({ action: 'update' }, signal), { code: 'PROCESS_FAILED', message: /could not refresh the mainsequence marketplace/ });
  assert.equal(refresh.runs.some(run => run.args[1] === 'add'), false);
  const install = harness(await executable(t), { exit: args => args[1] === 'add' ? 1 : 0 });
  await assert.rejects(install.plugin.call({ action: 'update' }, signal), { code: 'PROCESS_FAILED', message: 'Codex could not install the MainSequence update.' });
  await assert.rejects(install.plugin.call({ action: 'remove' }, signal), { code: 'INVALID_REQUEST' });
});

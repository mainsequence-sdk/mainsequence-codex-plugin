const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { toolName, readCatalog, registration, createToolCatalog, isRegisteredToolName } = require('../build/hosts/toolCatalog');

const backend = 'https://backend.example.test';
const environmentUid = '10000000-0000-4000-8000-000000000001';
const releaseUid = '30000000-0000-4000-8000-000000000001';
const row = { backend, resource_release_uid: releaseUid, name: 'Metrics', display_name: 'Research project',
  mcp_connection: { url: 'https://project.example.test/mcp', transport: 'streamable-http', resource_metadata_url: 'https://project.example.test/.well-known/oauth-protected-resource?resource_release_uid=' + releaseUid,
    organization_environment_uid: environmentUid, organization_environment_name: 'Research', active_revision_uid: '20000000-0000-4000-8000-000000000001' } };
const metrics = { name: 'metrics', description: 'Inspect metrics', inputSchema: { type: 'object', properties: { window: { type: 'string' } } }, annotations: { readOnlyHint: true, title: 'ignored' }, _meta: { 'mainsequence.ai/timeout-seconds/v1': 60 } };
const ok = (action, data) => ({ schemaVersion: 1, action, status: 'success', summary: 'ok', data });

async function fixture(t, respond) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-catalog-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'nested', 'codex-tool-catalog.json');
  const actions = []; let notified = 0;
  const dispatch = () => async request => { actions.push(request); return respond(request, actions); };
  const catalog = createToolCatalog({ file, dispatch, notify: () => { notified++; } });
  return { root, file, actions, catalog, notified: () => notified };
}
const healthy = (tools = [metrics], rows = [row]) => request => request.action === 'auth-status' ? ok(request.action, { backend, authenticated: true, source: 'machine' })
  : request.action === 'mcp-list' ? ok(request.action, rows)
  : request.action === 'mcp-tools' ? ok(request.action, { connection: row, tools })
  : { schemaVersion: 1, action: request.action, status: 'failure', summary: 'unexpected ' + request.action, error: { code: 'INVALID_REQUEST', message: 'unexpected' } };

test('tool names match the Claude Desktop plugin, so one remote tool has one name in both hosts', () => {
  // The name Claude registered for the CRM contacts list on the reference workstation.
  assert.equal(toolName('http://127.0.0.1:8000', '18595d12-f92a-4960-84cd-0c6798a1ad25', '2de75e21-bfe1-4b77-b668-6916488ed317', 'crm_contacts_list'), 'ms_crm_contacts_list_183f8138');
  assert.notEqual(toolName('http://local-backend:8000', '18595d12-f92a-4960-84cd-0c6798a1ad25', '2de75e21-bfe1-4b77-b668-6916488ed317', 'crm_contacts_list'), 'ms_crm_contacts_list_183f8138', 'the backend string is part of the identity');
  const long = toolName(backend, environmentUid, releaseUid, 'crm.prospecting/profiles-create-with-a-very-long-name');
  assert.match(long, /^ms_crm_prospecting_profiles-create-_[0-9a-f]{1,8}$/); assert.ok(long.length <= 44);
  assert.ok(isRegisteredToolName('ms_metrics_1')); assert.equal(isRegisteredToolName('mainsequence_open'), false);
});

test('a damaged cache is an empty catalog; valid rows become definitions with the remote schema and bindings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-catalog-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'catalog.json');
  assert.equal(readCatalog(file), null);
  await fs.writeFile(file, '{not json'); assert.equal(readCatalog(file), null);
  await fs.writeFile(file, JSON.stringify({ version: 2, connections: [] })); assert.equal(readCatalog(file), null);
  await fs.writeFile(file, JSON.stringify({ version: 1, updatedAt: 'x', connections: [
    { backend, releaseUid: releaseUid.toUpperCase(), environmentUid, environmentName: 'Research', name: 'Metrics', tools: [metrics, { name: 7 }, { name: 'noschema' }, { name: 'bare', inputSchema: { properties: {} } }] },
    { backend, releaseUid: 'not-a-uuid', environmentUid, tools: [] }, 'junk'] }));
  const catalog = readCatalog(file);
  assert.equal(catalog.connections.length, 1); assert.equal(catalog.connections[0].releaseUid, releaseUid);
  assert.deepEqual(catalog.connections[0].tools.map(tool => tool.name), ['metrics', 'bare']);
  assert.deepEqual(catalog.connections[0].tools[0].annotations, { readOnlyHint: true }, 'only the four boolean hints survive');
  assert.equal('_meta' in catalog.connections[0].tools[0], false);
  const { definitions, bindings } = registration(catalog);
  assert.equal(definitions[0].name, toolName(backend, environmentUid, releaseUid, 'metrics'));
  assert.equal(definitions[0].description, 'MainSequence Metrics [Research]: Inspect metrics');
  assert.deepEqual(definitions[0].inputSchema, metrics.inputSchema);
  assert.deepEqual(definitions[0].annotations, { openWorldHint: true, readOnlyHint: true });
  assert.deepEqual(definitions[1].inputSchema, { type: 'object', properties: {} }, 'a schema without a type is an object schema');
  assert.deepEqual(bindings.get(definitions[0].name), { backend, environmentUid, environmentName: 'Research', releaseUid, connection: 'Metrics', tool: 'metrics' });
});

test('refresh reads every saved connection once, writes the cache without secrets and announces the change', async t => {
  const f = await fixture(t, healthy());
  assert.deepEqual(f.catalog.list(), []); assert.equal(f.catalog.state().count, 0);
  await f.catalog.refresh(true);
  assert.deepEqual(f.actions.map(a => a.action), ['auth-status', 'mcp-list', 'mcp-tools']);
  assert.equal(f.actions[1].readOnly, true); assert.equal(f.actions[2].backend, backend); assert.equal(f.actions[2].releaseUid, releaseUid);
  assert.equal(f.actions[2].expectedAccount, undefined, 'registered tools bind to the saved connection, not to an account snapshot');
  const [definition] = f.catalog.list();
  assert.equal(definition.name, toolName(backend, environmentUid, releaseUid, 'metrics'));
  assert.deepEqual(f.catalog.binding(definition.name), { backend, environmentUid, environmentName: 'Research', releaseUid, connection: 'Metrics', tool: 'metrics' });
  assert.equal(f.notified(), 1);
  const written = JSON.parse(await fs.readFile(f.file, 'utf8'));
  assert.equal(written.version, 1); assert.equal(written.connections[0].tools[0].name, 'metrics');
  assert.doesNotMatch(JSON.stringify(written), /mcp_connection|resource_metadata_url|token/);
  assert.equal(((await fs.stat(f.file)).mode & 0o777).toString(8), process.platform === 'win32' ? ((await fs.stat(f.file)).mode & 0o777).toString(8) : '600');
  const state = f.catalog.state();
  assert.equal(state.count, 1); assert.deepEqual(state.connections, [{ name: 'Metrics', environmentName: 'Research', tools: 1 }]); assert.equal(state.error, null); assert.equal(state.refreshing, false);
  // A fresh cache is not read again without force; a forced refresh with the same catalog announces nothing.
  await f.catalog.refresh(); assert.equal(f.actions.length, 3);
  await f.catalog.refresh(true); assert.equal(f.actions.length, 6); assert.equal(f.notified(), 1);
});

test('an unreadable connection keeps its earlier tools; a removed connection loses them', async t => {
  let mode = 'healthy';
  const f = await fixture(t, request => mode === 'healthy' || request.action !== 'mcp-tools' ? healthy(undefined, mode === 'removed' ? [] : [row])(request)
    : { schemaVersion: 1, action: request.action, status: 'failure', summary: 'The MCP request failed or timed out. It was not retried.', error: { code: 'BACKEND_UNREACHABLE', message: 'timed out' } });
  await f.catalog.refresh(true); const before = f.catalog.list();
  mode = 'failing'; await f.catalog.refresh(true);
  assert.deepEqual(f.catalog.list(), before); assert.deepEqual(f.catalog.state().unavailable, ['Metrics']); assert.equal(f.catalog.state().error, null);
  mode = 'removed'; await f.catalog.refresh(true);
  assert.deepEqual(f.catalog.list(), []); assert.deepEqual(f.catalog.state().unavailable, []); assert.equal(f.notified(), 2);
});

test('without a session nothing is read and the state says so; a signed-out refresh keeps the cached tools', async t => {
  let authenticated = true;
  const f = await fixture(t, request => request.action === 'auth-status' ? ok(request.action, { backend, authenticated, source: authenticated ? 'machine' : 'none' }) : healthy()(request));
  await f.catalog.refresh(true); authenticated = false; const count = f.actions.length;
  await f.catalog.refresh(true);
  assert.equal(f.actions.length, count + 1); assert.equal(f.catalog.state().error.code, 'NOT_AUTHENTICATED'); assert.equal(f.catalog.list().length, 1);
});

test('one chat process refreshes at a time; the others reuse its file, and a stale lock is cleared', async t => {
  const f = await fixture(t, healthy());
  await fs.mkdir(path.dirname(f.file), { recursive: true });
  await fs.writeFile(f.file + '.lock', '{"pid":1}');
  await f.catalog.refresh(true); assert.deepEqual(f.actions, [], 'a live lock means another process is already refreshing');
  const old = new Date(Date.now() - 11 * 60_000); await fs.utimes(f.file + '.lock', old, old);
  await f.catalog.refresh(true); assert.equal(f.actions.length, 3); assert.equal(await fs.stat(f.file + '.lock').catch(e => e.code), 'ENOENT');
  const other = createToolCatalog({ file: f.file, dispatch: () => async () => { throw new Error('the other process must not read'); } });
  assert.equal(other.list().length, 1, 'a second server process reads the shared cache');
  await new Promise(resolve => setTimeout(resolve, 20));
  await f.catalog.update(releaseUid, [metrics, { name: 'export', inputSchema: { type: 'object' } }]);
  assert.equal(other.list().length, 2, 'a change written by one process is visible to the next list of another');
  assert.equal(other.binding(toolName(backend, environmentUid, releaseUid, 'export')).tool, 'export');
  await other.refresh(); assert.equal(other.state().count, 2, 'a fresh shared cache is not refreshed again');
});

test('disposing a server mid-refresh aborts it and frees the shared lock immediately', async t => {
  let release;
  const f = await fixture(t, request => request.action === 'mcp-tools' ? new Promise(resolve => { release = () => resolve(healthy()(request)); }) : healthy()(request));
  const refresh = f.catalog.refresh(true);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await fs.stat(f.file + '.lock').then(() => true, () => false), true, 'the refresh holds the lock');
  f.catalog.dispose();
  assert.equal(await fs.stat(f.file + '.lock').then(() => true, e => e.code), 'ENOENT', 'the lock is freed synchronously');
  release(); await refresh;
  const other = createToolCatalog({ file: f.file, dispatch: () => healthy() });
  await other.refresh(true); assert.equal(other.list().length, 1, 'the next server refreshes without waiting for the stale-lock timeout');
});

test('a disabled catalog still serves the cache but never reads or writes on its own', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-catalog-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'catalog.json');
  await fs.writeFile(file, JSON.stringify({ version: 1, updatedAt: '2020-01-01T00:00:00.000Z', connections: [{ backend, releaseUid, environmentUid, environmentName: 'Research', name: 'Metrics', tools: [metrics] }] }));
  const catalog = createToolCatalog({ file, disabled: true, dispatch: () => async () => { throw new Error('disabled catalogs do not dispatch'); } });
  assert.equal(catalog.list().length, 1);
  await catalog.refresh(true); await catalog.update(releaseUid, []);
  assert.equal(catalog.list().length, 1);
});

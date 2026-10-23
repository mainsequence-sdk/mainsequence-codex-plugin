const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDevTools, createNodeHost, createSessionService } = require('@dev-mainsequence/devtools');
const { createDiscovery } = require('../build/hosts/discovery');
const environmentUid = '10000000-0000-4000-8000-000000000001';
const otherEnvironmentUid = '10000000-0000-4000-8000-000000000002';
const agentUid = '20000000-0000-4000-8000-000000000001';
const releaseUid = '30000000-0000-4000-8000-000000000001';
const backend = 'https://backend.example.test';
const connection = { backend, resource_release_uid: releaseUid, name: 'Metrics', display_name: 'Research project',
  mcp_connection: { url: 'https://project.example.test/mcp', transport: 'streamable-http',
    resource_metadata_url: `https://project.example.test/.well-known/oauth-protected-resource?resource_release_uid=${releaseUid}`,
    organization_environment_uid: environmentUid, organization_environment_name: 'Research', active_revision_uid: agentUid } };

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-panel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const connections = path.join(root, 'connections.json');
  await fs.writeFile(connections, JSON.stringify([connection]));
  const before = await fs.readFile(connections, 'utf8');
  const calls = [], writes = []; let username = 'fixture-user', authenticated = true;
  const fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: String(url), method: options.method, rpc: body?.method, tool: body?.params?.name });
    let result;
    if (String(url) === backend + '/api/v1/users/me/') result = { username };
    else if (String(url).includes('/organization-environments/')) result = { count: 2, results: [{ uid: environmentUid, name: 'Research', is_production: false }, { uid: otherEnvironmentUid, name: 'Staging', is_production: false }] };
    else if (String(url) === backend + `/api/v1/resource-releases/${releaseUid}/`) result = connection;
    else if (String(url).endsWith('/exchange-launch/')) result = { mode: 'token', release_kind: 'fastapi', token: 'private-release-token', rpc_url: 'https://project.example.test/mcp' };
    else if (String(url).endsWith('/mcp')) {
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} } };
      else if (body.method === 'tools/list') result = { tools: String(url).includes('project.example')
        ? [{ name: 'metrics', description: 'Inspect metrics private-release-token', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]
        : ['agent.list', 'agent.search'].map(name => ({ name, inputSchema: { type: 'object' } })) };
      else if (body.method === 'tools/call' && ['agent.list', 'agent.search'].includes(body.params.name)) result = { structuredContent: { count: 1, results: [{ uid: agentUid, name: 'Analyst', description: 'private-machine-access', organization_environment_uid: environmentUid, organization_environment_name: 'Research', response_kinds: ['message'], runtime_state: 'ready' }] } };
      else if (body.method === 'tools/call' && body.params.name === 'resource_release.mcp_endpoints') result = { structuredContent: { count: 1, results: [connection] } };
      else if (body.method === 'tools/call' && body.params.name === 'metrics') result = { isError:true, content:[{type:'text',text:'Record unavailable private-release-token'}], structuredContent:{code:'not_found',message:'Record unavailable',details:{token:'private-release-token'}} };
      else throw new Error('Unexpected RPC: ' + JSON.stringify(body));
      result = { jsonrpc: '2.0', id: body.id, result };
    } else throw new Error('Unexpected URL: ' + url);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  };
  const persistence = { name: 'fixture store', mode: 'machine',
    read: async () => authenticated ? { username: overrides.savedUsername ?? username, access: 'private-machine-access', refresh: 'private-machine-refresh' } : null,
    write: async () => writes.push('credential-write'), remove: async () => writes.push('credential-remove') };
  const session = createSessionService(createNodeHost(), { persistence, fetch, env: {} });
  const devtools = createDevTools({ host: createNodeHost(), session, env: { MAINSEQUENCE_ENDPOINT: backend }, fetch, mcpConnectionsPath: connections });
  const actions = [];
  const dispatch = async request => { actions.push(request); if (overrides.before) await overrides.before(request); return devtools.dispatch(request); };
  return { dispatch, actions, calls, writes, connections, before, setAccount: value => { username = value; }, signOut: () => { authenticated = false; } };
}

test('public devtools session, real directory parsing and fresh saved schemas; no sends or settings writes', async t => {
  const f = await fixture(t), service = createDiscovery();
  const status = await service.status(f.dispatch);
  assert.equal(status.account.username, 'fixture-user'); assert.equal(status.account.checked, true); assert.equal(status.account.source, 'machine');
  assert.equal(status.environments[0].uid, environmentUid);
  const selection = { contextId: status.contextId, environmentUid };
  const agents = await service.discover(f.dispatch, { ...selection, catalog: 'agents' });
  assert.equal(agents.results[0].name, 'Analyst');
  const search = await service.discover(f.dispatch, { ...selection, catalog: 'agents', search: 'analysis' });
  assert.equal(search.semantic, true);
  const mcps = await service.discover(f.dispatch, { ...selection, catalog: 'tools' });
  assert.equal(mcps.results[0].name, 'Metrics');
  assert.equal(mcps.results[0].saved, true);
  const tools = await service.tools(f.dispatch, { ...selection, releaseUid });
  assert.equal(tools.tools[0].name, 'metrics'); assert.equal(tools.tools[0].annotations.readOnlyHint, true);
  assert.doesNotMatch(JSON.stringify([status, agents, mcps, tools]), /private-machine|private-release|mcp_connection|resource_metadata_url/);
  assert.deepEqual([...new Set(f.actions.map(a => a.action))].sort(), ['agents-list', 'auth-status', 'mcp-discover', 'mcp-environments', 'mcp-list', 'mcp-tools']);
  assert.ok(f.actions.filter(a => a.action !== 'auth-status').every(a => a.expectedAccount === 'fixture-user'));
  assert.ok(f.actions.filter(a => a.action === 'mcp-list').every(a => a.readOnly === true));
  assert.ok(f.actions.filter(a => a.action === 'mcp-discover').every(a => a.enrichNames === true));
  assert.ok(f.calls.every(c => !c.tool || ['agent.list', 'agent.search', 'resource_release.mcp_endpoints'].includes(c.tool)));
  assert.equal(await fs.readFile(f.connections, 'utf8'), f.before); assert.deepEqual(f.writes, []);
});

test('opening a panel restores the environment used by native tools, scoped to the verified account',async t=>{
  const f=await fixture(t),service=createDiscovery(),initial=await service.status(f.dispatch);
  assert.equal(initial.selectedEnvironmentUid,null);
  await service.view(f.dispatch,{contextId:initial.contextId,environmentUid,view:'connections'});
  assert.equal((await service.status(f.dispatch)).selectedEnvironmentUid,environmentUid);
  f.setAccount('another-user');assert.equal((await service.status(f.dispatch)).selectedEnvironmentUid,null);
});

test('project tool errors reach native chat with their original details and effects, with no replay or credential leak', async t => {
  const f = await fixture(t), service = createDiscovery(), status = await service.status(f.dispatch);
  const selected = { contextId:status.contextId, environmentUid };
  await service.view(f.dispatch, {...selected,view:'connections'});
  const result = await service.invoke(f.dispatch, {...selected,releaseUid,tool:'metrics',arguments:{}});
  assert.equal(result.error.code, 'MCP_TOOL_ERROR');
  assert.equal(result.result.isError,true);
  assert.equal(result.result.structuredContent.code,'not_found');
  assert.equal(result.effects.state,'partial-or-uncertain');
  assert.equal(f.calls.filter(c=>c.tool==='metrics').length,1);
  assert.doesNotMatch(JSON.stringify(result),/private-release-token|private-machine-access/);
});

test('a changed account refuses an old directory context before discovery', async t => {
  const f = await fixture(t), service = createDiscovery(); const status = await service.status(f.dispatch);
  f.setAccount('another-user'); const count = f.calls.length;
  await assert.rejects(service.discover(f.dispatch, { contextId: status.contextId, environmentUid, catalog: 'agents' }), { code: 'CONTEXT_CHANGED' });
  assert.ok(f.calls.slice(count).every(c => c.url.endsWith('/users/me/')));
});

test('a changed account while loading discards the completed page', async t => {
  let f;
  f = await fixture(t, { before: async request => { if (request.action === 'mcp-discover') f.setAccount('changed-during-read'); } });
  const service = createDiscovery(), status = await service.status(f.dispatch);
  await assert.rejects(service.discover(f.dispatch, { contextId: status.contextId, environmentUid, catalog: 'tools' }), { code: 'CONTEXT_CHANGED' });
});

test('signed-out sessions do not perform discovery or sign in', async t => {
  const f = await fixture(t); f.signOut(); const output = await createDiscovery().status(f.dispatch);
  assert.equal(output.contextId, null); assert.equal(output.account.authenticated, false); assert.deepEqual(output.environments, []);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.actions.map(a => a.action), ['auth-status']);
});

test('scope and pagination validation; unknown releases cannot acquire credentials', async t => {
  const f = await fixture(t), service = createDiscovery(), status = await service.status(f.dispatch);
  const base = { contextId: status.contextId, environmentUid }; const before = f.calls.length;
  // Each refusal names the argument and what is accepted; one generic sentence hid five different mistakes.
  await assert.rejects(service.discover(f.dispatch, { ...base, catalog: 'send' }), { code: 'INVALID_REQUEST', message: /catalog must be "agents" or "tools", not "send"/ });
  await assert.rejects(service.discover(f.dispatch, { ...base, catalog: 'agents', offset: -1 }), { code: 'INVALID_REQUEST', message: /offset must be a non-negative integer/ });
  await assert.rejects(service.discover(f.dispatch, { ...base, catalog: 'agents', search: 'x', offset: 20 }), { code: 'INVALID_REQUEST', message: /omit offset when search is set/ });
  await assert.rejects(service.discover(f.dispatch, { ...base, environmentUid: agentUid, catalog: 'tools' }), { code: 'INVALID_REQUEST', message: new RegExp(`environmentUid "${agentUid}" is not one of this account's environments: Research = ${environmentUid}; Staging = ${otherEnvironmentUid}`) });
  await assert.rejects(service.tools(f.dispatch, { ...base, releaseUid }), { code: 'INVALID_REQUEST', message: /not a saved or discovered MCP of Research .* mainsequence_view with view "connections"/ });
  await assert.rejects(service.tools(f.dispatch, { ...base, releaseUid: 'crm' }), { code: 'INVALID_REQUEST', message: /releaseUid must be a release UUID/ });
  await assert.rejects(service.tools(f.dispatch, { contextId: 'stale', environmentUid, releaseUid }), { code: 'CONTEXT_CHANGED', message: /contextId "stale" is unknown .* mainsequence_open/ });
  assert.ok(f.calls.slice(before).every(c => c.url.endsWith('/users/me/')));
  await service.discover(f.dispatch, { ...base, catalog: 'tools' });
  await assert.rejects(service.tools(f.dispatch, { ...base, environmentUid: otherEnvironmentUid, releaseUid }), { code: 'INVALID_REQUEST', message: new RegExp(`belongs to Research \\(${environmentUid}\\); pass environmentUid "${environmentUid}"`) });
  await fs.writeFile(f.connections, '[]');
  await assert.rejects(service.tools(f.dispatch, { ...base, releaseUid }), /Add this MCP connection/);
  assert.equal(await fs.readFile(f.connections, 'utf8'), '[]');
  assert.equal(f.calls.some(c => c.url.endsWith('/exchange-launch/')), false);
});

test('backend failure retains public session status but does not enable discovery', async t => {
  const f = await fixture(t), service = createDiscovery();
  const status = await service.status(async request => request.check ? { status: 'failure', summary: 'Backend unavailable.', error: { code: 'BACKEND_UNREACHABLE' } } : f.dispatch(request));
  assert.equal(status.account.authenticated, true); assert.equal(status.account.checked, false); assert.equal(status.contextId, null); assert.equal(status.issue.code, 'BACKEND_UNREACHABLE');
});

test('discovery distinguishes saved and unsaved MCPs without backfilling legacy records', async t => {
  const f = await fixture(t), service = createDiscovery();
  const legacy = { ...connection }; delete legacy.display_name; delete legacy.name;
  const bytes = JSON.stringify([legacy], null, 4) + '\n\n'; await fs.writeFile(f.connections, bytes);
  const status = await service.status(f.dispatch), selection = { contextId: status.contextId, environmentUid, catalog: 'tools' };
  assert.equal((await service.discover(f.dispatch, selection)).results[0].saved, true);
  assert.equal(await fs.readFile(f.connections, 'utf8'), bytes);
  assert.equal(f.calls.some(call => call.url.includes('/resource-releases/?')), false, 'saved listing never backfills names');
  await fs.writeFile(f.connections, '[]');
  assert.equal((await service.discover(f.dispatch, selection)).results[0].saved, false);
  assert.equal(await fs.readFile(f.connections, 'utf8'), '[]');
  assert.equal(f.calls.some(call => call.url.endsWith('/exchange-launch/')), false);
});

test('a configured backend change invalidates the host view before domain discovery', async t => {
  const f = await fixture(t), service = createDiscovery(), status = await service.status(f.dispatch);
  const calls = f.calls.length;
  const dispatch = async request => request.action === 'auth-status'
    ? { status: 'success', data: { authenticated: true, username: 'fixture-user', backend: 'https://other.test', source: 'machine' } } : f.dispatch(request);
  await assert.rejects(service.discover(dispatch, { contextId: status.contextId, environmentUid, catalog: 'tools' }), { code: 'CONTEXT_CHANGED' });
  assert.equal(f.calls.length, calls);
});

test('verified account identity takes precedence over stale saved account metadata', async t => {
  const f = await fixture(t, { savedUsername: 'outdated-label' }), service = createDiscovery();
  const status = await service.status(f.dispatch);
  assert.equal(status.account.username, 'fixture-user'); assert.ok(status.contextId);
  const result = await service.discover(f.dispatch, { contextId: status.contextId, environmentUid, catalog: 'tools' });
  assert.equal(result.results[0].saved, true); assert.deepEqual(f.writes, []);
});

test('details and assets require discovered agents; connections require scoped explicit mutations',async t=>{
 const f=await fixture(t);let assets=0;const service=createDiscovery({assets:async input=>{assets++;assert.equal(input.expectedAccount,'fixture-user');return {};},repositories:async()=>[],preferences:async()=>({backend,baseDir:'/fixture'})});
 const state=await service.status(f.dispatch),selected={contextId:state.contextId,environmentUid};
 await assert.rejects(service.view(f.dispatch,{...selected,view:'assets',agentUids:[agentUid]}),{code:'INVALID_REQUEST'});
 await assert.rejects(service.connection(f.dispatch,{...selected,action:'connect',releaseUid}),{code:'INVALID_REQUEST'});
 await service.discover(f.dispatch,{...selected,catalog:'agents'});
 await service.view(f.dispatch,{...selected,view:'assets',agentUids:[agentUid]});assert.equal(assets,0);
 const connected=await service.view(f.dispatch,{...selected,view:'connections'});assert.equal(connected.results[0].uid,releaseUid);
 const before=f.actions.length;await service.connection(f.dispatch,{...selected,action:'disconnect',releaseUid});
 const mutation=f.actions.slice(before).find(a=>a.action==='mcp-remove');assert.equal(mutation.expectedAccount,'fixture-user');assert.equal(mutation.environmentUid,environmentUid);assert.deepEqual(JSON.parse(await fs.readFile(f.connections,'utf8')),[]);
 await assert.rejects(service.connection(f.dispatch,{...selected,environmentUid:agentUid,action:'connect',releaseUid}),{code:'INVALID_REQUEST'});
});
test('project details and tool invocation reject unselected IDs and malformed arguments',async t=>{
 const f=await fixture(t), service=createDiscovery(),state=await service.status(f.dispatch),selected={contextId:state.contextId,environmentUid};
 await assert.rejects(service.view(f.dispatch,{...selected,view:'project',projectUid:agentUid}),{code:'INVALID_REQUEST',message:/projectUid .* view "projects" first/});
 await assert.rejects(service.invoke(f.dispatch,{...selected,releaseUid,tool:'metrics',arguments:{}}),{code:'INVALID_REQUEST',message:/not a saved or discovered MCP/});
 await service.view(f.dispatch,{...selected,view:'connections'});
 for(const args of [null,[],42])await assert.rejects(service.invoke(f.dispatch,{...selected,releaseUid,tool:'metrics',arguments:args}),{code:'INVALID_REQUEST',message:/arguments must be a JSON object/});
 await assert.rejects(service.invoke(f.dispatch,{...selected,releaseUid,tool:'',arguments:{}}),{code:'INVALID_REQUEST',message:/tool must be a tool name from mainsequence_tools/});
 assert.equal(f.actions.some(a=>a.action==='mcp-call'),false);
 // The schema marks arguments optional; omitting it is an empty argument object, as for any tool.
 const result=await service.invoke(f.dispatch,{...selected,releaseUid:releaseUid.toUpperCase(),tool:'metrics'});
 assert.equal(result.error.code,'MCP_TOOL_ERROR');
 const call=f.actions.find(a=>a.action==='mcp-call');assert.deepEqual(call.arguments,{});assert.equal(call.releaseUid,releaseUid);
});

test('an authentication failure during a scoped call keeps its cause in the refreshed-context message',async t=>{
 const f=await fixture(t), service=createDiscovery(),state=await service.status(f.dispatch),selected={contextId:state.contextId,environmentUid};
 await service.view(f.dispatch,{...selected,view:'connections'});
 const dispatch=async request=>request.action==='mcp-call'?{schemaVersion:1,action:'mcp-call',status:'failure',summary:'The MCP endpoint returned HTTP 401.',error:{code:'AUTH_REJECTED',message:'The MCP endpoint returned HTTP 401.'}}:f.dispatch(request);
 await assert.rejects(service.invoke(dispatch,{...selected,releaseUid,tool:'metrics'}),{code:'CONTEXT_CHANGED',message:/\(AUTH_REJECTED: The MCP endpoint returned HTTP 401\.\)/});
 await assert.rejects(service.view(f.dispatch,{...selected,view:'connections'}),{code:'CONTEXT_CHANGED'},'the context is dropped after an authentication failure');
});

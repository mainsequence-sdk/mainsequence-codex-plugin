const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

test('detached packaged MCP server: tools, immutable UI, validation, no startup requests', async t => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'ms detached panel '));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const installed = path.join(temporary, 'plugin'); await fsp.cp(path.resolve('codex'), installed, { recursive: true });
  const mcp = JSON.parse(fs.readFileSync(path.join(installed, '.mcp.json'))).mcpServers.mainsequence;
  assert.deepEqual(mcp.args, ['./dist/panel-server.js']);
  assert.ok(mcp.tool_timeout_sec >= 120, 'cold project MCP calls exceed the host default of 60 s');
  // A catalog written by an earlier chat's server, beside the shared CLI state of this HOME.
  const { toolName } = require('../build/hosts/toolCatalog');
  const stateDir = process.platform === 'darwin' ? path.join(temporary, 'Library', 'Application Support', 'MainSequenceCLI') : process.platform === 'win32' ? path.join(temporary, 'MainSequenceCLI') : path.join(temporary, '.config', 'mainsequence');
  const cached = { backend: 'https://backend.example.test', releaseUid: '30000000-0000-4000-8000-000000000001', environmentUid: '10000000-0000-4000-8000-000000000001', environmentName: 'Research', name: 'Metrics',
    tools: [{ name: 'metrics', description: 'Inspect metrics', inputSchema: { type: 'object', properties: { window: { type: 'string' } } }, annotations: { readOnlyHint: true } }] };
  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.writeFile(path.join(stateDir, 'codex-tool-catalog.json'), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), connections: [cached] }));
  const registered = toolName(cached.backend, cached.environmentUid, cached.releaseUid, 'metrics');
  const child = spawn(process.execPath, mcp.args, { cwd: installed, env: { PATH: process.env.PATH, HOME: temporary, APPDATA: temporary, MAINSEQUENCE_CODEX_TOOL_CATALOG: 'off' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const pending = new Map(); let seq = 0, stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  readline.createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); const wait = pending.get(message.id); if (wait) { pending.delete(message.id); clearTimeout(wait.timer); wait.resolve(message); } });
  function rpc(method, params = {}) { const id = ++seq; return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('MCP timeout')), 3000); pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'test', version: '1' }, capabilities: {} });
  assert.equal(init.result.serverInfo.version, require('../package.json').version);
  assert.equal(init.result.capabilities.tools.listChanged, true);
  assert.match(init.result.instructions, /ms_\* tools/);
  const listed = (await rpc('tools/list')).result.tools;
  assert.deepEqual(listed.map(tool => tool.name), ['mainsequence_open', 'mainsequence_discover', 'mainsequence_tools', 'mainsequence_stage_message', 'mainsequence_agent_request', 'mainsequence_agent_status', 'mainsequence_submission', 'mainsequence_view', 'mainsequence_connection', 'mainsequence_call_tool','mainsequence_agent_task','mainsequence_workspace','mainsequence_action','mainsequence_operations','mainsequence_settings','mainsequence_agent_prepare', registered]);
  assert.ok(listed.slice(0, 3).every(tool => tool.annotations.readOnlyHint));
  // The saved project's tool is a first-class tool with the remote schema, as in Claude Desktop.
  const project = listed.at(-1);
  assert.deepEqual(project.inputSchema, cached.tools[0].inputSchema);
  assert.equal(project.description, 'MainSequence Metrics [Research]: Inspect metrics');
  assert.deepEqual(project.annotations, { openWorldHint: true, readOnlyHint: true });
  const unknownTool = (await rpc('tools/call', { name: 'ms_metrics_0', arguments: {} })).result;
  assert.equal(unknownTool.isError, true); assert.match(unknownTool.structuredContent.error.message, /not a registered MainSequence tool.*mainsequence_open/);
  const badArguments = (await rpc('tools/call', { name: registered, arguments: [] })).result;
  assert.equal(badArguments.structuredContent.error.code, 'INVALID_REQUEST'); assert.match(badArguments.structuredContent.error.message, /JSON object/);
  // Without a session for that backend the call fails before any project request, with the devtools reason.
  const unauthenticated = (await rpc('tools/call', { name: registered, arguments: { window: '7d' } })).result;
  assert.equal(unauthenticated.isError, true);
  assert.ok(['NOT_AUTHENTICATED', 'STORE_UNAVAILABLE', 'STORE_ERROR'].includes(unauthenticated.structuredContent.error.code), JSON.stringify(unauthenticated));
  assert.equal(unauthenticated.content[0].type, 'text'); assert.equal(JSON.parse(unauthenticated.content[0].text).error.code, unauthenticated.structuredContent.error.code);
  const unknownArgument = (await rpc('tools/call', { name: 'mainsequence_view', arguments: { contextId: 'x', environmentUid: 'y', view: 'connections', nonsense: 1 } })).result;
  assert.match(unknownArgument.structuredContent.error.message, /does not accept "nonsense"\. Accepted: contextId, environmentUid, view/);
  const uri = listed[0]._meta.ui.resourceUri;
  const before = (await rpc('resources/read', { uri })).result.contents[0];
  assert.equal(before.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(before._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.match(before.text, /--color-background-primary/); assert.match(before.text, /"panelId":"[a-f0-9]{64}"/);
  await fsp.appendFile(path.join(installed, 'dist/hosts/panel/panel.html'), '<!-- changed after startup -->');
  assert.equal((await rpc('resources/read', { uri })).result.contents[0].text, before.text);
  assert.equal((await rpc('resources/read', { uri: 'ui://old.html' })).error.code, -32602);
  for (const [name, args] of [['agent-send', {}], ['mainsequence_open', { backend: 'https://unselected.example.test' }], ['mainsequence_discover', { action: 'agent-send' }], ['mainsequence_tools', { contextId: 'unknown', environmentUid: 'bad', releaseUid: 'bad' }]]) {
    const output = (await rpc('tools/call', { name, arguments: args })).result;
    assert.equal(output.isError, true);
  }
  assert.equal((await rpc('tools/call', { name: 'mainsequence_open', arguments: JSON.parse('{"__proto__":"bad"}') })).result.isError, true);
  for (const meta of [undefined, { threadId: 'a', thread_id: 'b' }]) {
    const result = (await rpc('tools/call', { name: 'mainsequence_agent_status', arguments: { action: 'list' }, _meta: meta })).result;
    assert.equal(result.structuredContent.error.code, 'CONVERSATION_REQUIRED');
  }
  assert.equal(listed[4].annotations.readOnlyHint, false);
  assert.deepEqual(listed[4].inputSchema.required, ['action', 'requestId']);
  const missingId = (await rpc('tools/call', { name: 'mainsequence_agent_request', arguments: { action: 'deliver' }, _meta: { threadId: 'chat' } })).result;
  assert.equal(missingId.structuredContent.error.code, 'INVALID_REQUEST');
  assert.equal(listed[5].annotations.readOnlyHint, true);
  assert.deepEqual(listed[6]._meta.ui.visibility, ['app']);
  assert.equal(stderr, '');
  assert.equal(fs.existsSync(path.join(installed, 'node_modules')), false);
  // Reproduce Codex's update cleanup while the old server still serves a chat.
  await fsp.rm(installed, {recursive:true,force:true});
  assert.equal((await rpc('resources/read', {uri})).result.contents[0].text, before.text);
  assert.equal((await rpc('tools/list')).result.tools.length, listed.length);
  const settings = (await rpc('tools/call', {name:'mainsequence_settings',arguments:{action:'get'}})).result;
  assert.equal(settings.isError, undefined, JSON.stringify(settings));
  assert.equal(fs.realpathSync(settings.structuredContent.runtime.workingDirectory), fs.realpathSync(temporary));
  assert.equal(settings.structuredContent.runtime.pluginWorkspace, null, 'The package directory is not a user workspace');
  assert.equal(stderr, '');
});

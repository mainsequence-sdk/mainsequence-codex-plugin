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
  const child = spawn(process.execPath, mcp.args, { cwd: installed, env: { PATH: process.env.PATH, HOME: temporary }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const pending = new Map(); let seq = 0, stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  readline.createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); const wait = pending.get(message.id); if (wait) { pending.delete(message.id); clearTimeout(wait.timer); wait.resolve(message); } });
  function rpc(method, params = {}) { const id = ++seq; return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('MCP timeout')), 3000); pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'test', version: '1' }, capabilities: {} });
  assert.equal(init.result.serverInfo.version, require('../package.json').version);
  const listed = (await rpc('tools/list')).result.tools;
  assert.deepEqual(listed.map(tool => tool.name), ['mainsequence_open', 'mainsequence_discover', 'mainsequence_tools', 'mainsequence_stage_message', 'mainsequence_agent_request', 'mainsequence_agent_status', 'mainsequence_submission', 'mainsequence_view', 'mainsequence_connection', 'mainsequence_call_tool','mainsequence_agent_task','mainsequence_workspace','mainsequence_action','mainsequence_operations','mainsequence_settings','mainsequence_agent_prepare']);
  assert.ok(listed.slice(0, 3).every(tool => tool.annotations.readOnlyHint));
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

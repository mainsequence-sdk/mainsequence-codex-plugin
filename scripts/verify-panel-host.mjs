// Actual Codex backend, isolated profile, no model turn and no MainSequence requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { rpcProcess } from './lib/rpc.mjs';
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const binary = process.env.MAINSEQUENCE_CODEX_BINARY || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const temporary = await mkdtemp(join(tmpdir(), 'ms-readonly-host-'));
const env = { PATH: process.env.PATH, HOME: temporary, CODEX_HOME: join(temporary, 'codex-home'), MAINSEQUENCE_ENDPOINT: 'http://127.0.0.1:9' };
const pluginId = 'mainsequence@mainsequence-local';
let client;
try {
  await mkdir(env.CODEX_HOME);
  const host = execFileSync(binary, ['--version'], { env, encoding: 'utf8' }).trim();
  for (const args of [['plugin', 'marketplace', 'add', join(root, 'artifacts/local-marketplace'), '--json'], ['plugin', 'add', pluginId, '--json']]) execFileSync(binary, args, { env, encoding: 'utf8', timeout: 20000 });
  client = rpcProcess(binary, ['app-server', '-c', 'analytics.enabled=false', '-c', 'features.remote_plugin=false', '-c', 'features.recommended_plugins=false',
    '-c', 'model_provider="panel_offline"', '-c', 'model_providers.panel_offline.name="Offline validation"', '-c', 'model_providers.panel_offline.base_url="http://127.0.0.1:9/v1"', '-c', 'model_providers.panel_offline.wire_api="responses"', '-c', 'model_providers.panel_offline.requires_openai_auth=false'], { env, cwd: temporary });
  await client.request('initialize', { clientInfo: { name: 'mainsequence-readonly-validation', version }, capabilities: { experimentalApi: true } }); client.notify('initialized');
  const thread = (await client.request('thread/start', { cwd: temporary, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', environments: [] })).thread.id;
  let server;
  for (let i = 0; i < 40; i++) {
    server = (await client.request('mcpServerStatus/list', { threadId: thread })).data.find(s => s.pluginId === pluginId);
    if (server && Object.values(server.tools).some(t => t.name === 'mainsequence_open')) break;
    if (server?.runtimeStatus === 'failed') throw new Error('MCP server failed to start');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(server, 'Codex discovers the packaged server');
  const tools = Object.values(server.tools);
  assert.deepEqual(tools.map(t => t.name).sort(), ['mainsequence_agent_request', 'mainsequence_agent_status', 'mainsequence_call_tool', 'mainsequence_connection', 'mainsequence_discover', 'mainsequence_open', 'mainsequence_stage_message', 'mainsequence_submission', 'mainsequence_tools', 'mainsequence_view','mainsequence_agent_task','mainsequence_workspace','mainsequence_action','mainsequence_operations','mainsequence_settings','mainsequence_agent_prepare'].sort());
  assert.equal(tools.find(t => t.name === 'mainsequence_agent_request').annotations.readOnlyHint, false);
  assert.equal(tools.find(t => t.name === 'mainsequence_agent_status').annotations.readOnlyHint, true);
  const opener = tools.find(t => t.name === 'mainsequence_open');
  assert.ok(opener._meta.ui.resourceUri.startsWith(`ui://mainsequence/panel-${version}-`));
  assert.match(opener._meta.ui.resourceUri, /-[a-f0-9]{16}\.html$/);
  const rejected = await client.request('mcpServer/tool/call', { threadId: thread, server: server.name, tool: 'mainsequence_discover', arguments: { contextId: 'expired', environmentUid: '10000000-0000-4000-8000-000000000001', catalog: 'agents' } });
  assert.equal(rejected.isError, true); assert.equal(rejected.structuredContent.error.code, 'CONTEXT_CHANGED');
  await client.request('thread/unsubscribe', { threadId: thread });
  const report = { host, pluginId, passed: true, tools: tools.map(t => t.name), resourceUri: opener._meta.ui.resourceUri, staleContextRefused: true, modelTurns: 0, mainsequenceRequests: 0, desktopRenderingTested: false };
  await writeFile(join(root, 'artifacts/panel-host-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { client?.close(); await rm(temporary, { recursive: true, force: true }); }

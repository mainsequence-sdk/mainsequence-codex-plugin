// Opt-in live MainSequence acceptance in an isolated, unmodified Codex app-server.
// The native model transport is deterministic: it asserts tool receipts are in
// Codex's next-turn context. Only the selected MainSequence agent runs real inference.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { rpcProcess } from './lib/rpc.mjs';
import { agentFixture } from './lib/agent-fixture.mjs';

const fixture = process.argv[2] === '--fixture' ? await agentFixture() : null;
const [environmentUid, agentUid, resumePath] = fixture ? [fixture.environmentUid, fixture.agentUid] : process.argv.slice(2);
const resume = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : null;
assert.ok(environmentUid && agentUid, 'Pass the explicitly selected environment and agent UUIDs. This test sends ONE harmless agent message.');
const root = resolve(import.meta.dirname, '..'), temporary = resume?.temporary || await mkdtemp(join(tmpdir(), 'mainsequence-message-acceptance-'));
const binary = process.env.MAINSEQUENCE_CODEX_BINARY || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TERM'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
if (fixture) Object.assign(env, { HOME: temporary, MAINSEQUENCE_ENDPOINT: fixture.backend, MAINSEQUENCE_ACCESS_TOKEN: 'isolated-acceptance-only' });
env.CODEX_HOME = join(temporary, 'codex-home'); await mkdir(env.CODEX_HOME, { recursive: true });
const pluginId = 'mainsequence@mainsequence-local', requestId = resume?.requestId || randomUUID(); let marker = resume?.marker || 'MAINSEQUENCE-CODEX-' + randomUUID();
const report = { version, requestId, temporary, marker, nativeModel: 'deterministic local transport', liveAgent: !fixture, desktopUiTested: false, checks: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const allText = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(allText).join('\n') : value && typeof value === 'object' ? Object.values(value).map(allText).join('\n') : '';
let client, phase = 'interrupt', phaseCalls = 0, preparationRecoveries = 0, nativeReadRetries = 0, receipt, agentName, modelError, modelRequests = 0;
const record = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log(JSON.stringify(report.checks.at(-1))); };
function toolCall(action) { return { type: 'function_call', id: 'fc_' + randomUUID(), call_id: 'call_' + randomUUID(), name: ['get', 'wait', 'list'].includes(action) ? 'mainsequence_agent_status' : 'mainsequence_agent_request', namespace: 'mcp__mainsequence', arguments: JSON.stringify({ action, requestId }), status: 'completed' }; }
function outputRequest(body) {
  const output = body.input.filter(i => i.type === 'function_call_output').at(-1)?.output;
  const text = allText(output), decoded = JSON.parse(text.slice(text.indexOf('{')));
  const data = decoded.structuredContent || (decoded.request || decoded.error ? decoded : JSON.parse(decoded.content.find(c => c.type === 'text').text));
  if (data.error && ['API_ERROR', 'BACKEND_UNREACHABLE', 'NOT_AUTHENTICATED'].includes(data.error.code) && nativeReadRetries++ < 4) return { readError: data.error.code };
  assert.ok(!data.error, JSON.stringify(data.error)); return data.request;
}
const endpoint = http.createServer(async (req, res) => {
  if (!req.url?.includes('/responses')) { req.resume(); res.writeHead(404); res.end(); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); modelRequests++; let item, text;
    if (phase === 'setup') text = 'Verification chat ready.';
    else if (phase === 'interrupt') {
      if (phaseCalls++ === 0) item = toolCall('deliver');
      else { outputRequest(body); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: response.created\ndata: ' + JSON.stringify({ type: 'response.created', response: { id: 'held', object: 'response', status: 'in_progress', output: [] } }) + '\n\n'); return; }
    } else if (phase === 'recover') {
      if (phaseCalls++ === 0) item = toolCall('deliver');
      else {
        const saved = outputRequest(body);
        if (saved.readError) item = toolCall('get');
        else if ((saved.state === 'pending' || saved.state === 'failed' && saved.sendAttempts === 0) && preparationRecoveries++ < 3) item = toolCall('deliver');
        else if (['preparing', 'sending'].includes(saved.state)) item = toolCall('wait');
        else {
          assert.equal(saved.state, 'delivered', saved.reason); assert.equal(saved.sendAttempts, 1);
          if (receipt) assert.deepEqual(saved.receipt, receipt);
          receipt = saved.receipt; agentName = saved.agentName; text = agentName + ':\n\n' + receipt.message;
        }
      }
    } else {
      assert.ok(receipt && allText(body.input).includes(receipt.message), 'Saved reply must be present in next-turn native context before returning a recall answer');
      text = agentName + ':\n\n' + receipt.message;
    }
    if (!item) item = { type: 'message', id: 'msg_' + randomUUID(), status: 'completed', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text, annotations: [] }] };
    const id = 'resp_' + randomUUID(); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    send('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
    send('response.output_item.added', { output_index: 0, item: item.type === 'message' ? { ...item, status: 'in_progress', content: [] } : { ...item, status: 'in_progress', arguments: '' } });
    if (item.type === 'message') {
      send('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      send('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text });
      send('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text });
    } else send('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40 } } }); res.end();
  } catch (error) { modelError = error.message; res.writeHead(500); res.end('Acceptance assertion failed'); }
});
try {
  await new Promise((resolve, reject) => { endpoint.once('error', reject); endpoint.listen(0, '127.0.0.1', resolve); });
  for (const args of [['plugin', 'marketplace', 'add', join(root, 'artifacts/local-marketplace'), '--json'], ['plugin', 'add', pluginId, '--json']]) execFileSync(binary, args, { env, encoding: 'utf8', timeout: 20000 });
  client = rpcProcess(binary, ['app-server', '-c', 'analytics.enabled=false', '-c', 'features.remote_plugin=false', '-c', 'features.recommended_plugins=false',
    '-c', 'model_provider="acceptance"', '-c', 'model_providers.acceptance.name="Local acceptance"', '-c', `model_providers.acceptance.base_url="http://127.0.0.1:${endpoint.address().port}/v1"`,
    '-c', 'model_providers.acceptance.wire_api="responses"', '-c', 'model_providers.acceptance.requires_openai_auth=false', '-c', 'model_providers.acceptance.request_max_retries=0', '-c', 'model_providers.acceptance.stream_max_retries=0'], { env, cwd: temporary, onServerRequest: async message => {
      const p = message.params, meta = p?._meta, args = meta?.tool_params;
      if (message.method !== 'mcpServer/elicitation/request' || p.serverName !== 'mainsequence' || meta?.codex_approval_kind !== 'mcp_tool_call'
        || !p.message.includes('"mainsequence_agent_request"') || args?.requestId !== requestId || !['deliver', 'wait', 'get'].includes(args.action)) {
        modelError = 'Unexpected approval request outside this authorized acceptance test'; return { action: 'decline' };
      }
      // The user authorized this one harmless agent test. Approve only its exact
      // request and tool call, never session-wide/always permissions or other tools.
      (report.approvals ||= []).push({ action: args.action, requestId });
      return { action: 'accept', content: {} };
    } });
  await client.request('initialize', { clientInfo: { name: 'mainsequence-agent-acceptance', version }, capabilities: { experimentalApi: true } }); client.notify('initialized');
  const threadId = (await client.request(resume?.threadId ? 'thread/resume' : 'thread/start', { ...(resume?.threadId ? { threadId: resume.threadId } : {}), cwd: temporary, model: 'acceptance', modelProvider: 'acceptance', approvalPolicy: 'on-request', sandbox: 'read-only', environments: [] })).thread.id;
  report.threadId = threadId;
  if (!resume?.threadId) {
    phase = 'setup'; const cursor = client.notifications.length;
    const setup = await client.request('turn/start', { threadId, input: [{ type: 'text', text: 'Initialize this integration-test chat. Do not call tools.', text_elements: [] }] });
    for (let i = 0; i < 300 && !client.notifications.slice(cursor).some(n => n.method === 'turn/completed' && n.params.turn.id === setup.turn.id); i++) await delay(100);
    assert.ok(client.notifications.slice(cursor).some(n => n.method === 'turn/completed' && n.params.turn.id === setup.turn.id && n.params.turn.status === 'completed'));
    phase = 'interrupt'; phaseCalls = 0;
  }
  let server;
  for (let i = 0; i < 60; i++) { server = (await client.request('mcpServerStatus/list', { threadId })).data.find(s => s.pluginId === pluginId); if (Object.values(server?.tools || {}).some(t => t.name === 'mainsequence_agent_request')) break; await delay(250); }
  assert.ok(server); report.host = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  const call = async (tool, args = {}) => {
    let result;
    for (let attempt = 0; attempt < 4; attempt++) {
      result = await client.request('mcpServer/tool/call', { threadId, server: server.name, tool, arguments: args }, 120000);
      if (!result.isError || !['mainsequence_open', 'mainsequence_discover', 'mainsequence_agent_status', 'mainsequence_stage_message'].includes(tool) || !['API_ERROR', 'BACKEND_UNREACHABLE'].includes(result.structuredContent?.error?.code)) break;
      (report.readRetries ||= []).push({ tool, code: result.structuredContent.error.code }); await delay(2000);
    }
    assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent?.error)); return result.structuredContent;
  };
  let status;
  for (let attempt = 0; attempt < 4; attempt++) {
    status = await call('mainsequence_open'); if (status.contextId) break;
    console.log(JSON.stringify({ readOnlyStatusRetry: attempt + 1, issue: status.issue })); await delay(3000);
  }
  assert.equal(status.messagingAvailable, true); assert.equal(status.account.authenticated, true); assert.ok(status.contextId, JSON.stringify(status.issue));
  report.account = status.account.username; report.backend = status.account.backend;
  const agents = await call('mainsequence_discover', { contextId: status.contextId, environmentUid, catalog: 'agents' });
  assert.ok(agents.results.some(a => a.uid === agentUid));
  const staged = resume?.agent ? await call('mainsequence_agent_status', { action: 'get', requestId }) : await call('mainsequence_stage_message', { contextId: status.contextId, environmentUid, agentUid, requestId,
    message: 'This is a delivery integration test. Do not use tools or modify anything. Reply with exactly this text and nothing else: ' + marker });
  assert.equal(staged.request.agentUid, agentUid); assert.equal(staged.request.environmentUid, environmentUid);
  if (resume) { marker = staged.request.message.split('nothing else: ')[1]; assert.ok(marker); report.marker = marker; }
  assert.equal(staged.request.sendAttempts, 0); report.agent = staged.request.agentName;
  await call('mainsequence_submission', { requestId, outcome: 'acknowledged' });
  record('session-and-staged-message', { sendAttempts: 0 });
  await writeFile(join(root, 'artifacts', 'agent-messaging-live-' + requestId + '.json'), JSON.stringify(report, null, 2));
  const waitTurn = async (id, cursor, timeout = 720000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (modelError) throw new Error(modelError); const n = client.notifications.slice(cursor).find(n => n.method === 'turn/completed' && n.params.turn.id === id); if (n) return n.params.turn; await delay(100); }
    throw new Error('Turn timed out');
  };
  const cursor = client.notifications.length;
  const first = await client.request('turn/start', { threadId, input: [{ type: 'text', text: 'Deliver the saved request ' + requestId + ' through mainsequence_agent_request.', text_elements: [] }] });
  let accepted;
  for (let i = 0; i < 100; i++) { if (modelError) throw new Error(modelError); accepted = (await call('mainsequence_agent_status', { action: 'get', requestId })).request; if (['preparing', 'sending', 'delivered', 'uncertain', 'expired', 'cancelled'].includes(accepted.state) || accepted.sendAttempts > 0) break; await delay(200); }
  assert.ok(['preparing', 'sending'].includes(accepted.state), 'Interrupt must occur while real work is active: ' + accepted.state);
  await client.request('turn/interrupt', { threadId, turnId: first.turn.id }); assert.equal((await waitTurn(first.turn.id, cursor)).status, 'interrupted');
  record('actual-native-stop-during-accepted-work', { stateAtStop: accepted.state });
  for (const repeated of [false, true]) {
    phase = 'recover'; phaseCalls = 0; const cursor = client.notifications.length;
    const turn = await client.request('turn/start', { threadId, input: [{ type: 'text', text: 'Recover the original saved request ' + requestId + '. Do not stage another message.', text_elements: [] }] });
    const done = await waitTurn(turn.turn.id, cursor); assert.equal(done.status, 'completed', JSON.stringify(done.error));
    assert.ok(receipt.message.includes(marker), 'Real agent must echo the one test marker');
    const saved = (await call('mainsequence_agent_status', { action: 'get', requestId })).request;
    assert.equal(saved.sendAttempts, 1); assert.deepEqual(saved.receipt, receipt);
    record(repeated ? 'repeated-native-recovery-reuses-exact-receipt' : 'agent-reply-in-native-chat', { sendAttempts: saved.sendAttempts, turnId: turn.turn.id });
  }
  phase = 'recall'; phaseCalls = 0; const recallCursor = client.notifications.length;
  const recall = await client.request('turn/start', { threadId, input: [{ type: 'text', text: 'Quote the previous MainSequence reply from this conversation. Do not call any tools.', text_elements: [] }] });
  assert.equal((await waitTurn(recall.turn.id, recallCursor)).status, 'completed');
  assert.equal(client.notifications.slice(recallCursor).filter(n => n.method === 'item/completed' && n.params.item.type === 'mcpToolCall').length, 0);
  const thread = (await client.request('thread/read', { threadId, includeTurns: true })).thread;
  assert.ok(thread.turns.flatMap(t => t.items).some(i => i.type === 'agentMessage' && i.text.includes(receipt.message)));
  record('reply-in-next-turn-model-context-and-native-transcript', { recallToolCalls: 0, sendAttempts: 1 });
  if (fixture) { assert.deepEqual(fixture.sends, [requestId]); record('platform-recorded-exactly-one-send', { sends: fixture.sends.length }); }
  report.receipt = receipt; report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error.stack); }
finally {
  client?.close(); fixture?.close(); endpoint.closeAllConnections(); endpoint.close(); report.modelRequests = modelRequests;
  const file = join(root, 'artifacts', 'agent-messaging-live-' + requestId + '.json'); await writeFile(file, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ report: file, passed: report.passed === true }));
}

// In-memory platform contract for stock-Codex integration tests. Never writes login data.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
export async function agentFixture() {
  const environmentUid = randomUUID(), agentUid = randomUUID(), sessionUid = randomUUID(), sends = [];
  const agent = { uid: agentUid, name: 'Acceptance agent', organization_environment_uid: environmentUid,
    organization_environment_name: 'Acceptance', runtime_release_uid: randomUUID(), runtime_update: { state: 'current' },
    a2a_profile: { supported_response_kinds: ['message'] }, llm_provider: 'fixture' };
  const names = ['agent.list', 'agent.get', 'agent.get_or_create_session', 'agent_session.resolve_runtime_access', 'a2a.send_message'];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer isolated-acceptance-only');
      let result, status = 200;
      if (req.url === '/api/v1/users/me/') result = { username: 'acceptance@example.test' };
      else if (req.url.startsWith('/api/v1/organization-environments/')) result = { count: 1, results: [{ uid: environmentUid, name: 'Acceptance', is_production: false }] };
      else if (req.url === '/mcp') {
        let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw);
        if (body.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} } };
        else if (body.method === 'notifications/initialized') status = 202;
        else if (body.method === 'tools/list') result = { tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) };
        else {
          const { name, arguments: args } = body.params; let data;
          if (name === 'agent.list') data = { count: 1, results: [agent] };
          else if (name === 'agent.get') { assert.equal(args.agent_uid, agentUid); data = agent; }
          else if (name === 'agent.get_or_create_session') data = { uid: sessionUid, agent_uid: agentUid, organization_environment_uid: environmentUid, bound_handle: { handle_unique_id: args.handle_unique_id } };
          else if (name === 'agent_session.resolve_runtime_access') {
            await new Promise(resolve => setTimeout(resolve, 500)); data = { mode: 'token', token: 'unused-runtime-fixture', rpc_url: 'https://unused.invalid', runtime_interaction: { state: 'ready', can_submit: true } };
          } else if (name === 'a2a.send_message') {
            sends.push(args.message_id); await new Promise(resolve => setTimeout(resolve, 1000));
            data = { agent_uid: agentUid, agent_session_uid: sessionUid, response_kind: 'message', message: args.message.split('nothing else: ')[1] };
          } else throw new Error('Unexpected fixture tool');
          result = { structuredContent: data };
        }
        if (status === 200) result = { jsonrpc: '2.0', id: body.id, result };
      } else throw new Error('Unexpected fixture path');
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(result === undefined ? '' : JSON.stringify(result));
    } catch { res.writeHead(400); res.end('Fixture contract failed'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { environmentUid, agentUid, sends, backend: 'http://127.0.0.1:' + server.address().port,
    close() { server.closeAllConnections(); server.close(); } };
}

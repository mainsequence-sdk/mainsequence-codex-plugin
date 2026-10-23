const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createDiscovery } = require('../build/hosts/discovery');
const { createMessaging, conversationIdentity } = require('../build/hosts/messaging');

test('host identity is required and cannot be substituted with a session or conflicting metadata', () => {
  for (const meta of [null, {}, { sessionId: 'unrelated' }, { threadId: '' }, { threadId: 'a', thread_id: 'b' }, { threadId: 2 }]) assert.equal(conversationIdentity(meta), undefined);
  assert.equal(conversationIdentity({ threadId: 'chat' }), 'chat');
  assert.equal(conversationIdentity({ thread_id: 'chat' }), 'chat');
});
test('production adapter binds discovery, shared identity and receipts to the host chat, including Stop', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-delivery-adapter-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const environmentUid = randomUUID(), agentUid = randomUUID(), sessionUid = randomUUID(), requestId = randomUUID();
  let account = 'shared-user', sends = 0, finish;
  const backend = 'https://backend.example.test', agent = { uid: agentUid, name: 'Analyst', responseKinds: ['message'], defaults: {} };
  const dispatch = async request => {
    if (request.expectedAccount) assert.equal(request.expectedAccount, account);
    let data;
    switch (request.action) {
      case 'auth-status': data = { backend, authenticated: true, username: account, checked: true }; break;
      case 'mcp-environments': data = [{ uid: environmentUid, name: 'Research' }]; break;
      case 'agents-list': data = { results: [agent], count: 1 }; break;
      case 'agent-get': data = { agent }; break;
      case 'agent-session': data = { sessionUid }; break;
      case 'agent-readiness': data = {}; break;
      case 'agent-send': sends++; assert.equal(request.messageId, requestId); await new Promise(resolve => { finish = resolve; }); data = { sessionUid, responseKind: 'message', message: 'Exact agent reply\nwith two lines' }; break;
      default: throw new Error('Unexpected action');
    }
    return { status: 'success', data };
  };
  const discovery = createDiscovery(), service = createMessaging(discovery, () => dispatch, { directory });
  const signal = new AbortController().signal, call = (args, chat = 'chat-a', s = signal) => service.call(['deliver','cancel'].includes(args.action) ? 'mainsequence_agent_request' : 'mainsequence_agent_status', args, dispatch, chat, s);
  await assert.rejects(service.call('mainsequence_agent_status', { action: 'list' }, dispatch, undefined, signal), { code: 'CONVERSATION_REQUIRED' });
  const { contextId } = await discovery.status(dispatch, 'chat-a'), selection = { contextId, environmentUid, agentUid, requestId, message: 'Question' };
  await assert.rejects(service.call('mainsequence_stage_message', selection, dispatch, 'chat-a', signal), { code: 'INVALID_REQUEST' });
  await discovery.discover(dispatch, { contextId, environmentUid, catalog: 'agents' });
  await assert.rejects(service.call('mainsequence_stage_message', selection, dispatch, 'chat-b', signal), { code: 'INVALID_REQUEST' });
  await service.call('mainsequence_stage_message', selection, dispatch, 'chat-a', signal);
  await assert.rejects(service.call('mainsequence_agent_status', { action: 'deliver', requestId }, dispatch, 'chat-a', signal), { code: 'INVALID_REQUEST' });
  assert.equal(sends, 0);
  await assert.rejects(call({ action: 'deliver', requestId }, 'chat-b'), { code: 'INVALID_REQUEST' });
  const stopped = new AbortController(), waiting = call({ action: 'deliver', requestId }, 'chat-a', stopped.signal);
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  stopped.abort(); await rejected; finish();
  const reply = await call({ action: 'wait', requestId }); assert.equal(reply.request.state, 'delivered');
  const freshAdapter = createMessaging(createDiscovery(), () => dispatch, { directory });
  const recovered = await freshAdapter.call('mainsequence_agent_request', { action: 'deliver', requestId }, dispatch, 'chat-a', signal);
  assert.deepEqual(recovered.request.receipt, reply.request.receipt); assert.equal(sends, 1);
  account = 'different-user'; await assert.rejects(call({ action: 'get', requestId }), { code: 'INVALID_REQUEST' });
});

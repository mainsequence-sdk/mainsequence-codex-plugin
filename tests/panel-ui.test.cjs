const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('src/hosts/panel/panel.html', 'utf8').replace('/* MAINSEQUENCE_PANEL_BUILD */ null', JSON.stringify({ version: 'test', panelId: 'test-build' }));
function element() { return { value: '', disabled: false, textContent: '', hidden: false, children: [], attributes: {}, style: {setProperty(){}},
  setAttribute(key, value) { this.attributes[key] = value; }, append(...nodes) { for (const n of nodes) n.parentNode = this; this.children.push(...nodes); }, replaceChildren(...nodes) { for (const n of nodes) n.parentNode = this; this.children = nodes; },
  replaceWith(next) { const p = this.parentNode, i = p ? p.children.indexOf(this) : -1; if (i >= 0) { p.children[i] = next; next.parentNode = p; } }, focus() {} }; }
async function panel(handler, storage = new Map(), globals = {}) {
  // Timers of ten seconds or more (deployment and release checks, the icon re-check, login notices) are captured for
  // the test to fire, and a fired one is no longer pending; shorter ones run for real.
  const scheduled = [];
  const schedule = (fn, ms) => { if (ms >= 10000) { const t = { ms, cleared: false }; t.fn = (...args) => { t.cleared = true; return fn(...args); }; scheduled.push(t); return t; } return setTimeout(fn, ms); };
  const cancel = t => { if (t && typeof t === 'object' && 'fn' in t) t.cleared = true; else clearTimeout(t); };
  const els = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const listeners = new Map(), requests = [], styles = new Map();
  const receive = data => listeners.get('message')({ source: parent, data: { jsonrpc: '2.0', ...data } });
  const parent = { postMessage(message) {
    requests.push(message); if (!message.id) return;
    void (async () => {
      try {
        const result = message.method === 'ui/initialize' ? { hostContext: { theme: 'dark', styles: { variables: { '--color-background-primary': '#212121' } } } }
          : { structuredContent: { ...await handler(message.params.name, message.params.arguments), build: { panelId: 'test-build' } } };
        receive({ id: message.id, result });
      } catch (error) { receive({ id: message.id, result: { isError: true, structuredContent: { error: { code: error.code, message: error.message } } } }); }
    })();
  } };
  const documentListeners = new Map();
  const document = { getElementById: id => els.get(id), createElement: () => element(), documentElement: { style: { setProperty: (k, v) => styles.set(k, v) } },
    visibilityState: 'visible', addEventListener: (name, fn) => documentListeners.set(name, fn) };
  const localStorage = {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  await vm.runInNewContext('(async()=>{' + html.match(/<script type="module">([\s\S]*?)<\/script>/)[1] + '})()', { document, window: {}, parent, localStorage, addEventListener: (name, fn) => listeners.set(name, fn), setTimeout: schedule, clearTimeout: cancel, crypto: require('node:crypto'), ...globals });
  const visibility = state => { document.visibilityState = state; documentListeners.get('visibilitychange')?.(); };
  return { el: id => els.get(id), requests, receive, document, styles, scheduled, visibility, pendingRechecks: () => scheduled.filter(t => !t.cleared) };
}
const account = { authenticated: true, username: 'Analyst', source: 'machine', checked: true, backend: 'https://example.test' };
const status = { account, contextId: 'context', environments: [{ uid: 'env-a', name: 'Research' }, { uid: 'env-b', name: 'Sandbox' }] };
const page = name => ({ count: 1, limit: 20, semantic: false, results: [{ uid: name, name, description: '<img src=x onerror=alert(1)>', responseKinds: ['message'], defaults: {} }] });
const flatten = el => [el.textContent, ...el.children.map(flatten)].join(' ');

test('theme changes, safe text, explicit environment selection, read-only bridge', async () => {
  const ui = await panel(async (name,args) => name === 'mainsequence_open' ? status : args.view === 'agent' ? {agent:page('Analyst').results[0]} : page('Analyst'));
  assert.equal(ui.el('account').textContent, 'Analyst');
  assert.equal(ui.el('account').attributes['data-status'],'connected');
  assert.equal(ui.el('account').attributes.title,'Connected');
  assert.equal(ui.requests.filter(r => r.method === 'tools/call' && r.params.name !== 'mainsequence_plugin').length, 1, 'No environment is guessed when several exist');
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
  await button(ui,'results','Analyst').onclick();
  assert.match(flatten(ui.el('results')), /<img src=x/); // textContent, never HTML execution
  assert.equal(ui.styles.get('--color-background-primary'), '#212121');
  ui.receive({ method: 'ui/notifications/host-context-changed', params: { theme: 'light', styles: { variables: { '--color-background-primary': '#ffffff' } } } });
  assert.equal(ui.document.documentElement.style.colorScheme, 'light'); assert.equal(ui.styles.get('--color-background-primary'), '#ffffff');
  assert.ok(ui.requests.every(r => ['ui/initialize', 'ui/notifications/initialized', 'tools/call'].includes(r.method)));
});

test('switching environments drops late data and clears prior results immediately', async () => {
  let finish;
  const ui = await panel(async (name, args) => name === 'mainsequence_open' ? status : args.environmentUid === 'env-a' ? new Promise(resolve => { finish = resolve; }) : page('Sandbox result'));
  ui.el('environment').value = 'env-a'; const first = ui.el('environment').onchange();
  await Promise.resolve(); ui.el('environment').value = 'env-b'; await ui.el('environment').onchange();
  finish(page('Stale research')); await first;
  assert.match(flatten(ui.el('results')), /Sandbox result/); assert.doesNotMatch(flatten(ui.el('results')), /Stale research/);
  assert.equal(ui.el('directory').attributes['aria-busy'], 'false');
});

test('account changes clear results and require a fresh context', async () => {
  const ui = await panel(async name => { if (name === 'mainsequence_open') return status; throw Object.assign(new Error('Account changed'), { code: 'CONTEXT_CHANGED' }); });
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
  assert.equal(ui.el('results').children.length, 0); assert.equal(ui.el('environment').disabled, true); assert.equal(ui.el('search-button').disabled, true);
  assert.equal(ui.el('notice').textContent, 'Account changed'); assert.equal(ui.el('refresh').disabled, false);
  assert.equal(ui.el('account').attributes['data-status'],'error');
});

// devtools reports when the saved login ends (sessionEndsAt). The panel reads time through Date, which these tests set.
const localTime = at => { const d = new Date(at); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function clock(now) { const state = { now }; return { state, Date: class extends Date { static now() { return state.now; } } }; }
test('the header warns a day before the saved login ends and says it ended at the end, on a timer while open', async () => {
  const time = clock(Date.now()), at = time.state.now + 30 * 3_600_000;
  const ui = await panel(async name => name === 'mainsequence_open' ? { ...status, account: { ...account, sessionEndsAt: new Date(at).toISOString() } } : page('Analyst'), new Map(), { Date: time.Date });
  assert.equal(ui.el('account').attributes['data-status'], 'connected'); assert.equal(ui.el('login-notice').textContent, '', 'no warning more than a day before');
  let [timer] = ui.pendingRechecks(); assert.equal(timer.ms, 6 * 3_600_000, 'wakes when the warning starts');
  time.state.now += timer.ms; timer.fn();
  assert.equal(ui.el('account').textContent, 'Analyst'); assert.equal(ui.el('account').attributes['data-status'], 'warning'); assert.equal(ui.el('account').attributes.title, 'Session ends soon');
  assert.match(ui.el('login-notice').textContent, new RegExp(`^MainSequence session ends (today|tomorrow) at ${localTime(at)} — sign in again \\(/ms login\\)$`));
  [timer] = ui.pendingRechecks(); assert.equal(timer.ms, 24 * 3_600_000, 'wakes at the end');
  time.state.now += timer.ms; timer.fn();
  assert.equal(ui.el('account').textContent, 'Session ended'); assert.equal(ui.el('account').attributes['data-status'], 'error');
  assert.equal(ui.el('login-notice').textContent, `MainSequence session ended today at ${localTime(at)} — sign in again (/ms login), then refresh.`);
  assert.deepEqual(ui.pendingRechecks(), []);
});

test('a panel opened after the saved login ended says when it ended and points to /ms login', async () => {
  const ended = Date.now() - 2 * 86_400_000;
  const ui = await panel(async name => name === 'mainsequence_open' ? { account: { authenticated: false, source: 'machine', backend: account.backend, sessionEndsAt: new Date(ended).toISOString() }, contextId: null, environments: [], issue: null } : {});
  assert.equal(ui.el('account').textContent, 'Session ended'); assert.equal(ui.el('account').attributes['data-status'], 'error');
  assert.match(ui.el('login-notice').textContent, new RegExp(`^MainSequence session ended on \\d{1,2} [A-Z][a-z]{2} at ${localTime(ended)} — sign in again \\(/ms login\\), then refresh\\.$`));
  assert.equal(ui.el('account-issue').textContent, '', 'the ended notice replaces the generic sign-in hint');
  assert.deepEqual(ui.pendingRechecks(), []);
});

test('a refused permission (FORBIDDEN) shows its message without signing the panel out', async () => {
  const message = 'The backend https://example.test denied GET /api/v1/agents/ (HTTP 403): the signed-in account does not have permission for it.';
  const ui = await panel(async name => { if (name === 'mainsequence_open') return status; throw Object.assign(new Error(message), { code: 'FORBIDDEN' }); });
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
  assert.equal(ui.el('notice').textContent, message);
  assert.equal(ui.el('account').textContent, 'Analyst'); assert.equal(ui.el('account').attributes['data-status'], 'connected');
  assert.equal(ui.el('environment').disabled, false); assert.equal(ui.el('environment').value, 'env-a'); assert.equal(ui.el('search').disabled, false);
});

test('environment choice survives reopening only for the same verified account and available environment',async()=>{
  const storage=new Map(), handler=async name=>name==='mainsequence_open'?status:page('Analyst');
  const first=await panel(handler,storage);first.el('environment').value='env-b';await first.el('environment').onchange();
  const reopened=await panel(handler,storage);assert.equal(reopened.el('environment').value,'env-b');
  assert.equal(reopened.el('search').disabled,false);assert.match(flatten(reopened.el('results')),/Analyst/);
  const changed=await panel(async name=>name==='mainsequence_open'?{...status,account:{...account,username:'Another account'}}:page('Other'),storage);
  assert.equal(changed.el('environment').value,'');
  const revoked=await panel(async name=>name==='mainsequence_open'?{...status,environments:[status.environments[0],{uid:'env-c',name:'Another'}]}:page('Other'),storage);
  assert.equal(revoked.el('environment').value,'');
});

test('native chat environment is selected on opening, and unavailable environments have an explicit state',async()=>{
  const ui=await panel(async name=>name==='mainsequence_open'?{...status,selectedEnvironmentUid:'env-b'}:page('Sandbox'));
  assert.equal(ui.el('environment').value,'env-b');assert.match(flatten(ui.el('results')),/Sandbox/);
  const failed=await panel(async()=>({...status,contextId:null,environments:[],issue:{message:'Environment service unavailable'}}));
  assert.equal(failed.el('account').attributes['data-status'],'connected','a verified login is separate from directory availability');
  assert.equal(failed.el('environment').disabled,true);assert.match(flatten(failed.el('environment')),/Environments unavailable/);
  assert.match(failed.el('account-issue').textContent,/Environment service unavailable/);
});

test('Tools starts with saved connections; adding an MCP requires an explicit scoped review', async () => {
  const saved = {uid:'saved',name:'Saved MCP',saved:true}, available={uid:'available',name:'Available MCP',saved:false}; let mutations=0;
  const ui=await panel(async(name,args)=>{
    if(name==='mainsequence_open')return status;
    if(name==='mainsequence_connection'){mutations++;return {summary:'Connected'};}
    return {count:1,results:args.view==='connections'?[saved]:[available]};
  });
  ui.el('environment').value='env-a';await ui.el('tools-tab').onclick();
  assert.match(flatten(ui.el('results')),/Connected in Research/);assert.doesNotMatch(flatten(ui.el('results')),/Available MCP/);
  await button(ui,'results','Add MCP').onclick();await button(ui,'results','Connect').onclick();assert.equal(mutations,0);
  await button(ui,'confirmation','Confirm').onclick();assert.equal(mutations,1);
});

const walk = el => [el, ...el.children.flatMap(walk)];
const button = (ui, root, text) => walk(ui.el(root)).find(e => e.textContent === text);
test('failed MCP calls display the remote error and uncertainty and cannot be replayed from the confirmation',async()=>{
  let calls=0;
  const ui=await panel(async(name,args)=>{
    if(name==='mainsequence_open')return status;
    if(name==='mainsequence_tools')return {tools:[{name:'read_record',inputSchema:{type:'object'}}]};
    if(name==='mainsequence_call_tool'){calls++;return {error:{code:'MCP_TOOL_ERROR',message:'The connected tool returned an error.'},result:{isError:true,structuredContent:{code:'not_found',message:'Record unavailable'}},effects:{state:'partial-or-uncertain',message:'Verify the outcome before repeating it.'}};}
    return {results:[{uid:'saved',name:'Saved MCP',saved:true}]};
  });
  ui.el('environment').value='env-a';await ui.el('tools-tab').onclick();
  await button(ui,'results','Saved MCP').onclick();await button(ui,'results','Review call').onclick();
  await button(ui,'confirmation','Confirm').onclick();
  const shown=flatten(ui.el('confirmation'));
  assert.match(shown,/MCP_TOOL_ERROR/);assert.match(shown,/not_found/);assert.match(shown,/Record unavailable/);assert.match(shown,/Verify the outcome/);
  assert.equal(button(ui,'confirmation','Confirm').disabled,true);assert.equal(calls,1);
});
test('dual-mode agents expose task selection and preserve the draft without sending during selection', async () => {
  let saved;
  const ui=await panel(async(name,args)=>{
    if(name==='mainsequence_open')return {...status,messagingAvailable:true};
    if(name==='mainsequence_discover')return {...page('Dual'),results:[{...page('Dual').results[0],responseKinds:['message','task']}]};
    if(name==='mainsequence_agent_status')return {requests:saved?[saved]:[]};
    if(name==='mainsequence_stage_message'){saved={...args,agentName:'Dual',state:'pending',sendAttempts:0};return {request:saved};}
    return {};
  });
  ui.el('environment').value='env-a';await ui.el('environment').onchange();await button(ui,'results','Talk').onclick();
  assert.equal(ui.el('response-kind').disabled,false);
  ui.el('message').value='Harmless task';ui.el('response-kind').value='task';ui.el('response-kind').onchange();
  assert.equal(ui.el('message').value,'Harmless task');
  assert.equal(ui.requests.filter(r=>r.method==='ui/message').length,0);
  await ui.el('send-message').onclick();assert.equal(saved.responseKind,'task');
  await ui.el('tools-tab').onclick();assert.equal(ui.el('response-kind').value,'task');
});
test('continuing a saved task selects its original environment and cannot change response mode', async () => {
  let staged;
  const task={requestId:'old-task',agentUid:'TaskAgent',agentName:'Task agent',environmentUid:'env-a',state:'delivered',sendAttempts:1,task:{status:'input_required',terminal:false},receipt:{message:'Need input'}};
  const ui=await panel(async(name,args)=>{
    if(name==='mainsequence_open')return {...status,messagingAvailable:true};
    if(name==='mainsequence_agent_status')return {requests:[task]};
    if(name==='mainsequence_operations')return {operations:[]};
    if(name==='mainsequence_stage_message'){staged=args;return {request:{...args,agentName:'Task agent',state:'pending'}};}
    return {results:[],count:0};
  });
  ui.el('environment').value='env-b';await ui.el('activity-tab').onclick();
  assert.match(flatten(ui.el('results')),/Task · input_required/);
  await button(ui,'results','Continue task').onclick();
  assert.equal(ui.el('environment').value,'env-a');assert.equal(ui.el('response-kind').value,'task');assert.equal(ui.el('response-kind').disabled,true);
  ui.el('message').value='Continue this task';await ui.el('send-message').onclick();
  assert.equal(staged.environmentUid,'env-a');assert.equal(staged.taskRequestId,'old-task');assert.equal(staged.responseKind,'task');
});
test('workspace entry reports read failures and activates the Code tab after recovery',async()=>{
  let fail=true;
  const ui=await panel(async(name,args)=>{
    if(name==='mainsequence_open')return status;
    if(name==='mainsequence_workspace'){if(fail)throw new Error('Temporary backend failure');return {preferences:{baseDir:'/tmp'},pluginWorkspace:null,local:{status:'success',data:{items:[{name:'Selected repo',path:'/tmp/selected-repo'}]}}};}
    return {results:[],count:0};
  });
  ui.el('environment').value='env-a';await ui.el('home-tab').onclick();
  await button(ui,'results','Open in Code').onclick();assert.equal(ui.el('notice').textContent,'Temporary backend failure');
  fail=false;await ui.el('home-tab').onclick();await button(ui,'results','Open in Code').onclick();
  assert.equal(ui.el('code-tab').attributes['aria-selected'],'true');assert.equal(ui.el('directory').attributes['aria-labelledby'],'code-tab');
  assert.match(flatten(ui.el('results')),/Selected repo/);
  await button(ui,'results','Open').onclick();assert.match(flatten(ui.el('results')),/Check status/);
});
test('messages are staged before native submission; double clicks and recovery reuse the saved ID', async () => {
  let saved, sends = 0;
  const ui = await panel(async (name, args) => {
    if (name === 'mainsequence_open') return { ...status, messagingAvailable: true };
    if (name === 'mainsequence_discover') return page('Analyst');
    if (name === 'mainsequence_stage_message') { sends++; saved = { ...args, state: 'pending', agentName: 'Analyst', sendAttempts: 0 }; return { request: saved }; }
    if (name === 'mainsequence_agent_status') return { requests: saved ? [saved] : [] };
    return {};
  });
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
  button(ui, 'results', 'Talk').onclick(); ui.el('message').value = 'A real message';
  const first = ui.el('send-message').onclick(); await ui.el('send-message').onclick(); await first;
  assert.equal(sends, 1);
  const native = ui.requests.filter(r => r.method === 'ui/message'); assert.equal(native.length, 1);
  assert.equal(native[0].params._meta['openai/message'].send, true);
  assert.match(native[0].params.content[0].text, new RegExp(saved.requestId));
  assert.doesNotMatch(native[0].params.content[0].text, /A real message/);
  const staged = ui.requests.findIndex(r => r.params?.name === 'mainsequence_stage_message');
  assert.ok(staged < ui.requests.indexOf(native[0]));
  await button(ui, 'delivery-results', 'Recover in Codex').onclick();
  assert.equal(sends, 1); assert.equal(ui.requests.filter(r => r.method === 'ui/message').length, 2);
  assert.ok(ui.requests.every(r => r.params?.arguments?.action !== 'deliver'), 'only the native chat delivers');
});
test('a late stage after environment switch is saved but never submitted', async () => {
  let finish;
  const ui = await panel(async (name, args) => {
    if (name === 'mainsequence_open') return { ...status, messagingAvailable: true };
    if (name === 'mainsequence_discover') return page('Analyst');
    if (name === 'mainsequence_stage_message') return new Promise(resolve => { finish = () => resolve({ request: { ...args, state: 'pending' } }); });
    if (name === 'mainsequence_agent_status') return { requests: [] };
    return {};
  });
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
  button(ui, 'results', 'Talk').onclick(); ui.el('message').value = 'Message'; const sending = ui.el('send-message').onclick();
  ui.el('environment').value = 'env-b'; await ui.el('environment').onchange(); finish(); await sending;
  assert.equal(ui.requests.filter(r => r.method === 'ui/message').length, 0);
  assert.match(ui.el('delivery-notice').textContent, /saved but was not submitted/);
});
test('opening a panel shows saved receipts safely without automatically submitting them', async () => {
  const ui = await panel(async name => name === 'mainsequence_open' ? { ...status, messagingAvailable: true } : {
    requests: [{ requestId: 'saved-id', state: 'delivered', agentName: 'Analyst', message: 'Question', receipt: { message: '<script>external data</script>' }, sendAttempts: 1 }]
  });
  assert.match(flatten(ui.el('delivery-results')), /Analyst: <script>external data/);
  assert.equal(ui.requests.filter(r => r.method === 'ui/message').length, 0);
  await button(ui, 'delivery-results', 'Show reply in Codex').onclick();
  assert.equal(ui.requests.filter(r => r.method === 'ui/message').length, 1);
});

test('a lost host acknowledgement keeps the saved request and recovery never stages another', async () => {
  let saved, stages = 0, unknown = 0;
  const ui = await panel(async (name, args) => {
    if (!name) throw new Error('Host acknowledgement lost');
    if (name === 'mainsequence_open') return { ...status, messagingAvailable: true };
    if (name === 'mainsequence_discover') return page('Analyst');
    if (name === 'mainsequence_stage_message') { stages++; saved = { ...args, state: 'pending', agentName: 'Analyst', sendAttempts: 0 }; return { request: saved }; }
    if (name === 'mainsequence_agent_status') return { requests: saved ? [saved] : [] };
    if (args.outcome === 'unknown') unknown++;
    return {};
  });
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
  button(ui, 'results', 'Talk').onclick(); ui.el('message').value = 'Lost acknowledgement'; await ui.el('send-message').onclick();
  assert.equal(stages, 1); assert.equal(unknown, 1); assert.match(ui.el('delivery-notice').textContent, /request is saved/);
  await button(ui, 'delivery-results', 'Recover in Codex').onclick();
  assert.equal(stages, 1); assert.equal(unknown, 2);
});

test('selected agent and draft persist across tabs and switching agents; environment change ends selection', async()=>{
 const ui=await panel(async(name,args)=>name==='mainsequence_open'?{...status,messagingAvailable:true}:name==='mainsequence_agent_status'?{requests:[]}:name==='mainsequence_discover'?page('Analyst'):{results:[]});
 ui.el('environment').value='env-a';await ui.el('environment').onchange();button(ui,'results','Talk').onclick();ui.el('message').value='Unsent draft';
 await ui.el('tools-tab').onclick();assert.equal(ui.el('composer').hidden,false);assert.equal(ui.el('message').value,'Unsent draft');
 await ui.el('agents-tab').onclick();button(ui,'results','Talk').onclick();assert.equal(ui.el('message').value,'Unsent draft');
 ui.el('environment').value='env-b';await ui.el('environment').onchange();assert.equal(ui.el('composer').hidden,true);assert.equal(ui.el('message').value,'');
 assert.equal(ui.requests.filter(r=>r.method==='ui/message').length,0);
});
test('agent detail includes public skills and examples without submitting a message',async()=>{
 const agent={...page('Analyst').results[0],skills:[{name:'Research',description:'Read data',examples:['Explain revenue']} ]};
 const ui=await panel(async(name,args)=>name==='mainsequence_open'?{...status,messagingAvailable:true}:name==='mainsequence_agent_status'?{requests:[]}:args.view==='agent'?{agent}:page('Analyst'));
 ui.el('environment').value='env-a';await ui.el('environment').onchange();await button(ui,'results','Analyst').onclick();
 assert.match(flatten(ui.el('results')),/Research/);button(ui,'results','Explain revenue').onclick();assert.equal(ui.el('message').value,'Explain revenue');assert.equal(ui.requests.filter(r=>r.method==='ui/message').length,0);
});
test('a connection review cannot mutate a different environment after navigation',async()=>{
 let calls=0;const ui=await panel(async(name,args)=>{if(name==='mainsequence_open')return status;if(name==='mainsequence_connection')calls++;return {results:[{uid:'saved',name:'Saved MCP',saved:true}],count:1};});
 ui.el('environment').value='env-a';await ui.el('tools-tab').onclick();button(ui,'results','Disconnect').onclick();const confirm=button(ui,'confirmation','Confirm');
 ui.el('environment').value='env-b';await ui.el('environment').onchange();await confirm.onclick();assert.equal(calls,0);
});
test('Code and Settings expose setup, shared preferences and account actions',async()=>{
 const ui=await panel(async(name,args)=>{
  if(name==='mainsequence_open')return status;
  if(name==='mainsequence_settings')return {preferences:{backend:account.backend,baseDir:'/tmp/repos',commandCenterUrl:''},runtime:{nodeVersion:'22',platform:'fixture',capabilities:{}}};
  if(name==='mainsequence_workspace')return {preferences:{baseDir:'/tmp/repos'},local:{status:'success',data:{items:[]}},pluginWorkspace:'/tmp/current',organization:'fixture'};
  if(args.view==='repositories')return {results:[{uid:'repo',code_repository_name:'Library',primary_language:'python',branches:[{repository_branch:'main'}]}]};
  return {results:[],count:0};
 });
 ui.el('environment').value='env-a';await ui.el('environment').onchange();await ui.el('code-tab').onclick();assert.match(flatten(ui.el('results')),/Set up/);await button(ui,'results','Set up').onclick();assert.match(flatten(ui.el('results')),/Install dependencies after setup/);assert.match(flatten(ui.el('results')),/\/tmp\/repos/);
 await ui.el('settings-tab').onclick();assert.match(flatten(ui.el('results')),/Save settings/);assert.match(flatten(ui.el('results')),/Renew session/);assert.match(flatten(ui.el('results')),/Sign out/);
});


test('agent icons are re-read once a minute while shown, without a refresh flag, and only a changed icon is redrawn in place',async()=>{
 const image = text => ({ source: 'data:image/svg+xml;base64,' + Buffer.from('<svg>' + text + '</svg>').toString('base64'), stillSource: 'data:image/svg+xml;base64,' + Buffer.from('<svg>' + text + '-still</svg>').toString('base64'), rendering: 'color', imageRendering: 'auto' });
 let current = image('one'), calls = [];
 const ui = await panel(async (name, args) => {
  if (name === 'mainsequence_open') return { ...status, selectedEnvironmentUid: 'env-a' };
  calls.push({ name, args });
  if (name === 'mainsequence_view' && args.view === 'agent') return { agent: { ...page('Inline').results[0], icon: current, skills: [] } };
  return { ...page('Inline'), results: [{ ...page('Inline').results[0], icon: current }] };
 });
 const drawn = () => walk(ui.el('results')).filter(el => typeof el.src === 'string' && el.src.startsWith('data:image'));
 assert.equal(drawn().length, 1); assert.equal(drawn()[0].src, image('one').source);
 assert.equal(ui.pendingRechecks().length, 1, 'one re-check timer while the Agents list is shown'); assert.equal(ui.pendingRechecks()[0].ms, 60000);
 // Unchanged: a second directory read without refresh, the same element stays.
 const first = drawn()[0]; await ui.pendingRechecks()[0].fn();
 assert.equal(calls.filter(c => c.name === 'mainsequence_discover').length, 2); assert.equal(calls.at(-1).args.refresh, undefined, 're-checks never invalidate shared caches');
 assert.equal(drawn()[0], first); assert.equal(ui.pendingRechecks().length, 1, 'the next re-check is scheduled');
 // Changed in Command Center: redrawn in place with the new source; nothing else re-rendered.
 current = image('two'); await ui.pendingRechecks()[0].fn();
 assert.equal(drawn().length, 1); assert.equal(drawn()[0].src, image('two').source); assert.notEqual(drawn()[0], first);
 assert.equal(walk(ui.el('results')).filter(el => el.textContent === 'Inline').length, 1);
 // Removed in Command Center: the placeholder replaces the image; restored: the image returns.
 current = null; await ui.pendingRechecks()[0].fn(); assert.equal(drawn().length, 0); assert.ok(walk(ui.el('results')).some(el => el.textContent === '◇'));
 current = image('three'); await ui.pendingRechecks()[0].fn(); assert.equal(drawn()[0].src, image('three').source);
 // A failed re-check keeps the drawn icon and tries again later.
 const stable = drawn()[0]; const good = ui.pendingRechecks()[0]; calls.push({ name: 'fail' }); current = new Proxy({}, { get() { throw new Error('directory unavailable'); } });
 await good.fn(); assert.equal(drawn()[0], stable); assert.equal(ui.pendingRechecks().length, 1); current = image('three');
 // Details re-read the one agent through the view; another section ends the timer; Agents starts it again.
 await button(ui, 'results', 'Inline').onclick(); assert.equal(ui.pendingRechecks().length, 1);
 current = image('four'); await ui.pendingRechecks()[0].fn();
 assert.equal(calls.at(-1).name, 'mainsequence_view'); assert.equal(calls.at(-1).args.view, 'agent'); assert.ok(drawn().some(el => el.src === image('four').source));
 await ui.el('tools-tab').onclick(); assert.equal(ui.pendingRechecks().length, 0, 'no re-check off the Agents screens');
 await ui.el('agents-tab').onclick(); assert.equal(ui.pendingRechecks().length, 1);
 // Explicit Refresh still asks for a fresh read; teardown ends the timer.
 await ui.el('refresh').onclick(); assert.equal(calls.at(-1).args.refresh, true);
 ui.receive({ id: 'teardown-1', method: 'ui/resource-teardown', params: {} }); assert.equal(ui.pendingRechecks().length, 0);
});

test('agent icons render from the directory response with no follow-up assets call',async()=>{
 const icon={source:'data:image/svg+xml;base64,PHN2Zy8+',stillSource:'data:image/svg+xml;base64,PHN2Zy8+',rendering:'color',imageRendering:'pixelated'};
 const ui=await panel(async(name,args)=>{
  if(name==='mainsequence_open')return {...status,selectedEnvironmentUid:'env-a'};
  assert.equal(name,'mainsequence_discover','Rendering icons must not invoke another tool');
  return {...page('Inline'),results:[{...page('Inline').results[0],icon}]};
 });
 assert.ok(walk(ui.el('results')).some(el=>el.src===icon.source));
 assert.equal(ui.requests.filter(r=>r.params?.name==='mainsequence_discover').length,1);
 assert.equal(ui.requests.some(r=>r.params?.arguments?.view==='assets'),false);
});

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function pluginPanel(version, update = () => ({ running: 'test', previous: '0.7.11', installed: '0.7.12', status: 'restart_required' })) {
  const calls = [];
  return panel(async (name, args) => {
    if (name === 'mainsequence_open') return status;
    if (name === 'mainsequence_plugin') { calls.push(JSON.parse(JSON.stringify(args))); return args.action === 'update' ? update() : { running: 'test', installed: '0.7.11', updateSupported: true, ...version(args) }; }
    return page('Analyst');
  }).then(async ui => { await settle(); return Object.assign(ui, { pluginCalls: calls }); });
}

test('the header names the running version and installs a published update only after confirmation', async () => {
  const ui = await pluginPanel(() => ({ latest: '0.7.12', status: 'update_available' }));
  assert.equal(ui.el('plugin-version').textContent, 'vtest');
  assert.deepEqual(ui.pluginCalls, [{ action: 'version' }]);
  await button(ui, 'plugin-release', 'Update to 0.7.12').onclick();
  assert.equal(ui.pluginCalls.length, 1, 'updating waits for confirmation');
  assert.match(flatten(ui.el('confirmation')), /installs MainSequence 0\.7\.12\. This chat keeps test until you start a new chat/);
  await button(ui, 'confirmation', 'Confirm').onclick();
  assert.deepEqual(ui.pluginCalls.at(-1), { action: 'update' });
  assert.match(flatten(ui.el('plugin-release')), /0\.7\.12 installed · start a new chat/);
  assert.equal(button(ui, 'plugin-release', 'Update to 0.7.12'), undefined);
  assert.equal(ui.el('plugin-help').hidden, true);
});

test("without Codex's plugin commands, or when they fail, the header shows the terminal steps", async () => {
  const unsupported = await pluginPanel(() => ({ installed: null, latest: '0.7.12', status: 'update_available', updateSupported: false }));
  await button(unsupported, 'plugin-release', 'Update to 0.7.12').onclick();
  assert.equal(unsupported.pluginCalls.some(args => args.action === 'update'), false);
  assert.equal(unsupported.el('plugin-help').hidden, false);
  assert.match(flatten(unsupported.el('plugin-help')), /codex plugin marketplace upgrade mainsequence\ncodex plugin add mainsequence@mainsequence/);
  await button(unsupported, 'plugin-help', 'Dismiss').onclick();
  assert.equal(unsupported.el('plugin-help').hidden, true);
  const failed = await pluginPanel(() => ({ latest: '0.7.12', status: 'update_available' }), () => { throw Object.assign(new Error('Codex could not install the MainSequence update.'), { code: 'PROCESS_FAILED' }); });
  await button(failed, 'plugin-release', 'Update to 0.7.12').onclick(); await button(failed, 'confirmation', 'Confirm').onclick();
  assert.match(flatten(failed.el('plugin-help')), /Codex could not install the MainSequence update\..*codex plugin add mainsequence@mainsequence/s);
  assert.ok(button(failed, 'plugin-release', 'Update to 0.7.12'), 'the published update is still offered');
});

test('an unreachable catalog keeps the version with a manual check that reads again', async () => {
  let reachable = false;
  const ui = await pluginPanel(() => reachable ? { latest: 'test', status: 'current' } : { latest: null, status: 'unknown' });
  assert.equal(ui.el('plugin-version').textContent, 'vtest');
  reachable = true; await button(ui, 'plugin-release', 'Check for updates').onclick();
  assert.deepEqual(ui.pluginCalls.at(-1), { action: 'version', recheck: true });
  assert.match(flatten(ui.el('plugin-release')), /● Up to date/);
});

// Releases and deployments, with results in the shape devtools' deployment reads return.
const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const STAMP = String.raw`\d{4}-\d\d-\d\d \d\d:\d\d`; // a date and time in the machine's zone
const deployment = (uid, state, extra = {}) => ({ uid, state, outcome: '', source: 'repository_event', commit: 'abc1234', releaseUid: 'release-api', releaseName: 'app', agentName: '', kind: 'fastapi', kindLabel: 'FastAPI', revisionUid: 'revision-1',
  repositoryName: 'pricing-engine', branchUid: 'branch-1', branchName: 'main', createdAt: minutesAgo(30), startedAt: minutesAgo(30), finishedAt: ['queued', 'running'].includes(state) ? null : minutesAgo(26), durationMs: 250000, error: '', errorCode: '',
  steps: [{ name: 'Build', state: 'succeeded' }, { name: 'Deploy', state: ['queued', 'running'].includes(state) ? 'running' : state }, { name: 'Verify', state: state === 'succeeded' ? 'succeeded' : 'pending' }], ...extra });
const deploymentRows = deploying => [
  deployment('run-1', deploying ? 'running' : 'succeeded', { durationMs: 240000 }),
  deployment('run-2', 'succeeded', { source: 'manual', commit: 'abc9999', createdAt: minutesAgo(90), startedAt: minutesAgo(90) }),
  deployment('run-5', 'blocked', { releaseUid: 'release-agent', releaseName: 'tau', agentName: 'Risk Analyst', kind: 'harness_agent', kindLabel: 'Harness Agent', createdAt: minutesAgo(125), startedAt: minutesAgo(125), error: 'workflow_prerequisite_failed: image missing' })];
function releasePanel(globals = {}) {
  const calls = [], state = { deploying: true, active: [deployment('run-1', 'running', { durationMs: 240000 })], runState: 'running', more: [], empty: false };
  const ok = (action, data, summary = 'Read.') => ({ result: { schemaVersion: 1, action, status: 'success', summary, data } });
  return panel(async (name, args) => {
    if (name === 'mainsequence_open') return { ...status, selectedEnvironmentUid: 'env-a' };
    if (name === 'mainsequence_view') return args.view === 'repositories' ? { results: [{ uid: 'repo-1', code_repository_name: 'pricing-engine', primary_language: 'python', branches: [{ uid: 'branch-1', repository_branch: 'main' }] }] } : page('Analyst');
    if (name !== 'mainsequence_workspace') return page('Analyst');
    calls.push(JSON.parse(JSON.stringify({ action: args.action, input: args.input, environmentUid: args.environmentUid }))); // plain objects outside the panel's realm
    if (args.action === 'local-context') return { preferences: { baseDir: '/tmp' }, organization: 'fixture', pluginWorkspace: null, local: { status: 'success', data: { items: [{ name: 'pricing-engine', path: '/tmp/pricing-engine', repositoryUid: 'repo-1' }] } } };
    if (args.action === 'resolve') return ok('resolve', { project: { branch: 'main' }, resolution: { code_repository_branch: { uid: 'branch-1', code_repository_name: 'pricing-engine', repository_branch: 'main' } } });
    if (args.action === 'deployment-release-history') { const { days, limit, offset } = args.input, rows = state.empty ? [] : [...state.more, ...deploymentRows(state.deploying)]; return ok(args.action, { count: rows.length, days, now: new Date().toISOString(), results: rows.slice(offset, offset + limit) }); }
    if (args.action === 'deployment-active') return ok('deployment-active', { count: state.active.length, results: state.active });
    if (args.action === 'deployment-history') return ok('deployment-history', { count: 1, results: [{ kind: 'deployment_run', uid: 'run-1', targetLabel: 'pricing-api', state: state.runState, branchName: 'main', commit: 'abc1234' }] });
    if (args.action === 'deployment-run') return ok('deployment-run', { hidden: false, uid: args.input.runUid, kind: 'deployment_run', run: { kind: 'deployment_run', uid: args.input.runUid, targetLabel: 'pricing-api', workflowRun: { kind: 'workflow_run', uid: 'workflow-1' }, state: state.runState, branchName: 'main', commit: 'abc1234', steps: [] } });
    throw new Error('Unexpected workspace action ' + args.action);
  }, new Map(), globals).then(ui => Object.assign(ui, { calls, state, reads: action => calls.filter(call => call.action === action), timers: ms => ui.pendingRechecks().filter(timer => timer.ms === ms) }));
}

const historyInput = extra => ({ days: 1, limit: 25, offset: 0, ...extra });

test('Releases is the deployment history of resource releases, one row per deployment, newest first', async () => {
  const ui = await releasePanel(); await ui.el('releases-tab').onclick();
  assert.equal(ui.el('releases-tab').attributes['aria-selected'], 'true');
  assert.deepEqual(ui.calls.map(call => [call.action, call.input, call.environmentUid]), [['deployment-release-history', historyInput(), 'env-a']], 'one read, over the last day');
  const text = flatten(ui.el('results'));
  assert.match(text, /Deployment history/); assert.match(text, /Research · 3 deployments in the last day · read just now/);
  for (const chip of ['All types', 'APIs', 'Agents', 'Static sites']) assert.ok(button(ui, 'results', chip), chip);
  assert.equal(button(ui, 'results', 'All types').attributes['aria-pressed'], 'true');
  assert.equal(button(ui, 'results', 'This repository'), undefined, 'offered only once a folder resolved its branch');
  assert.deepEqual(walk(ui.el('results')).filter(el => el.className === 'name').map(el => el.textContent), ['pricing-engine · app', 'pricing-engine · app', 'pricing-engine · Risk Analyst'], 'newest first, and a release deployed twice has two rows');
  assert.match(text, new RegExp(`main · abc1234 · ${STAMP} \\(30 min ago\\)`)); assert.match(text, new RegExp(`main · abc9999 · ${STAMP} \\(1 h ago\\)`));
  assert.match(text, /1 of 3 stages · Deploy · 4 min so far · Repository event/); assert.match(text, /3 of 3 stages · 4 min 10 s · Manual/);
  assert.match(text, /FastAPI/); assert.match(text, /Harness Agent/); assert.match(text, /workflow_prerequisite_failed: image missing/);
  for (const [value, cls] of [['Running', 'live'], ['Succeeded', 'ok'], ['Blocked', 'warn']]) assert.ok(walk(ui.el('results')).some(el => el.textContent === value && el.className === 'badge tone-' + cls), value);
  assert.match(text, /Times in UTC([+-]\d\d:\d\d)?\./, 'the zone of those times is named');
  assert.doesNotMatch(text, /\bruns?\b|\d of \d+ ok|All deployments|Open workflow/i, 'no runs, workflows or other deployments');
  const dots = walk(ui.el('results')).find(el => el.attributes?.role === 'img');
  assert.equal(dots.attributes['aria-label'], 'Stages: Build succeeded, Deploy running, Verify pending', "the dots are this deployment's own stages");
  assert.equal(button(ui, 'results', 'Load more'), undefined);
  assert.equal(button(ui, 'results', '1 day').attributes['aria-pressed'], 'true');
  await button(ui, 'results', '30 days').onclick();
  assert.deepEqual(ui.reads('deployment-release-history').at(-1).input, historyInput({ days: 30 }), 'a longer window is read only when chosen');
  assert.equal(button(ui, 'results', '30 days').attributes['aria-pressed'], 'true');
});

test('a blocked deployment without an error says why by its outcome', async () => {
  const ui = await releasePanel(); ui.state.more = [deployment('run-8', 'blocked', { outcome: 'image_not_ready' })];
  await ui.el('releases-tab').onclick();
  assert.match(flatten(ui.el('results')), /Image not ready/);
});

test('an empty history says there were no deployments', async () => {
  const ui = await releasePanel(); ui.state.empty = true; await ui.el('releases-tab').onclick();
  const text = flatten(ui.el('results'));
  assert.match(text, /No deployments in the last day/); assert.match(text, /Choose a longer window/); assert.doesNotMatch(text, /No runs/);
  assert.equal(ui.timers(30000).length, 0);
});

test('a history longer than a page loads more from where it stopped', async () => {
  const ui = await releasePanel(); ui.state.deploying = false;
  ui.state.more = Array.from({ length: 27 }, (_, n) => deployment('more-' + n, 'succeeded', { releaseName: 'site-' + n }));
  await ui.el('releases-tab').onclick();
  assert.match(flatten(ui.el('results')), /25 of 30 deployments/);
  await button(ui, 'results', 'Load more').onclick();
  assert.deepEqual(ui.reads('deployment-release-history').at(-1).input, historyInput({ offset: 25 }));
  assert.equal(walk(ui.el('results')).filter(el => el.className === 'name').length, 30); assert.equal(button(ui, 'results', 'Load more'), undefined);
});

test('Releases re-checks only deployments in progress every 30 s, reads the history once when one ends or starts, then stops', async () => {
  const ui = await releasePanel(); await ui.el('releases-tab').onclick();
  assert.equal(ui.timers(30000).length, 1); assert.match(flatten(ui.el('results')), /Auto-refresh every 30 s while deploying\./);
  // Still deploying, one stage further: the row updates in place and the history is not read again.
  ui.state.active = [deployment('run-1', 'running', { durationMs: 270000, steps: [{ name: 'Build', state: 'succeeded' }, { name: 'Deploy', state: 'succeeded' }, { name: 'Verify', state: 'running' }] })];
  await ui.timers(30000)[0].fn();
  assert.deepEqual(ui.calls.map(call => call.action), ['deployment-release-history', 'deployment-active']);
  assert.deepEqual(ui.calls[1].input, {}, 'the environment, without a branch filter');
  assert.match(flatten(ui.el('results')), /2 of 3 stages · Verify · 4 min 30 s so far/);
  assert.equal(ui.timers(30000).length, 1);
  // Another starts: the history is read once more.
  const started = deployment('run-9', 'queued', { releaseName: 'other', createdAt: minutesAgo(0) });
  ui.state.active = [...ui.state.active, started]; ui.state.more = [started];
  await ui.timers(30000)[0].fn();
  assert.equal(ui.reads('deployment-release-history').length, 2); assert.match(flatten(ui.el('results')), /pricing-engine · other/);
  // They end: the history is read once more and, with nothing deploying, nothing is watched.
  ui.state.active = []; ui.state.more = []; ui.state.deploying = false;
  await ui.timers(30000)[0].fn();
  assert.equal(ui.reads('deployment-release-history').length, 3);
  assert.equal(ui.timers(30000).length, 0);
  assert.doesNotMatch(flatten(ui.el('results')), /so far|Auto-refresh/);
});

test('nothing re-reads while nothing deploys; only the read age moves', async () => {
  const time = clock(Date.now());
  const ui = await releasePanel({ Date: time.Date }); ui.state.deploying = false;
  await ui.el('releases-tab').onclick();
  assert.equal(ui.timers(30000).length, 0);
  const [age] = ui.timers(60000); time.state.now += 60000; age.fn();
  assert.match(flatten(ui.el('results')), /read 1 min ago/);
  assert.deepEqual(ui.calls.map(call => call.action), ['deployment-release-history']);
});

test('a check waits while the panel is hidden, runs as soon as it is visible, and pauses after an hour', async () => {
  const time = clock(Date.now());
  const ui = await releasePanel({ Date: time.Date }); await ui.el('releases-tab').onclick();
  ui.visibility('hidden'); time.state.now += 30000; await ui.timers(30000)[0].fn();
  assert.equal(ui.reads('deployment-active').length, 0); assert.equal(ui.timers(30000).length, 0, 'a hidden check waits without a timer');
  ui.visibility('visible'); await settle();
  assert.equal(ui.reads('deployment-active').length, 1, 'the due check runs on becoming visible'); assert.equal(ui.timers(30000).length, 1);
  ui.visibility('hidden'); ui.visibility('visible'); await settle();
  assert.equal(ui.reads('deployment-active').length, 1, 'becoming visible again checks only when a check is due');
  time.state.now += 3600000; await ui.timers(30000)[0].fn();
  assert.equal(ui.reads('deployment-active').length, 1);
  assert.match(flatten(ui.el('results')), /Auto-refresh paused after an hour\./);
  assert.equal(ui.timers(30000).length, 0);
  await button(ui, 'results', 'Refresh').onclick();
  assert.equal(ui.reads('deployment-release-history').length, 2); assert.equal(ui.timers(30000).length, 1, 'Refresh starts a new hour');
});

test('type chips filter on the backend; This repository filters by the branch a local folder resolved to', async () => {
  const ui = await releasePanel(); await ui.el('releases-tab').onclick();
  await button(ui, 'results', 'Agents').onclick();
  assert.deepEqual(ui.reads('deployment-release-history').at(-1).input, historyInput({ releaseKind: 'harness_agent' }));
  assert.equal(button(ui, 'results', 'Agents').attributes['aria-pressed'], 'true');
  await button(ui, 'results', 'APIs').onclick(); assert.equal(ui.reads('deployment-release-history').at(-1).input.releaseKind, 'fastapi');
  await button(ui, 'results', 'All types').onclick(); assert.equal(ui.reads('deployment-release-history').at(-1).input.releaseKind, undefined);
  await ui.el('code-tab').onclick(); await button(ui, 'results', 'Open').onclick(); await button(ui, 'results', 'View releases').onclick();
  assert.deepEqual(ui.reads('resolve').at(-1).input, { root: '/tmp/pricing-engine' });
  assert.equal(ui.el('releases-tab').attributes['aria-selected'], 'true');
  assert.deepEqual(ui.reads('deployment-release-history').at(-1).input, historyInput({ codeRepositoryBranchUid: 'branch-1' }));
  const mine = button(ui, 'results', 'This repository');
  assert.equal(mine.attributes['aria-pressed'], 'true'); assert.equal(mine.attributes.title, 'pricing-engine · main');
  await ui.timers(30000)[0].fn(); assert.deepEqual(ui.reads('deployment-active').at(-1).input, { codeRepositoryBranchUid: 'branch-1' }, 'checks follow the filter');
  await mine.onclick();
  assert.equal(ui.reads('deployment-release-history').at(-1).input.codeRepositoryBranchUid, undefined);
  assert.equal(button(ui, 'results', 'This repository').attributes['aria-pressed'], 'false');
  ui.el('environment').value = 'env-b'; await ui.el('environment').onchange(); await ui.el('releases-tab').onclick();
  assert.equal(button(ui, 'results', 'This repository'), undefined, 'a resolved branch belongs to its environment');
});

test('a deployment opens its stages and logs under its own name, without the workflow run', async () => {
  const ui = await releasePanel(); await ui.el('releases-tab').onclick();
  await walk(ui.el('results')).find(el => el.className === 'name').onclick();
  assert.deepEqual(ui.calls.at(-1), { action: 'deployment-run', input: { runUid: 'run-1', kind: 'deployment_run' }, environmentUid: 'env-a' });
  const text = flatten(ui.el('results'));
  assert.match(text, /pricing-engine · app/); assert.match(text, /Auto-refresh every 10 s while it deploys\./); assert.ok(button(ui, 'results', 'View logs'));
  assert.equal(button(ui, 'results', 'Open workflow'), undefined); assert.equal(ui.timers(30000).length, 0, 'leaving the history ends its checks');
  await button(ui, 'results', '← Releases').onclick();
  assert.equal(ui.calls.at(-1).action, 'deployment-release-history');
});

test('a running deployment re-reads every 10 s only while shown and visible, ends with the run, and pauses after an hour', async () => {
  const time = clock(Date.now());
  const ui = await releasePanel({ Date: time.Date });
  await ui.el('home-tab').onclick(); await button(ui, 'results', 'All deployments').onclick(); await button(ui, 'results', 'Details').onclick();
  assert.equal(ui.reads('deployment-run').length, 1); assert.equal(ui.timers(10000).length, 1);
  assert.equal(ui.pendingRechecks().filter(timer => timer.ms < 60000 && timer.ms !== 10000).length, 0, 'one loop, at 10 s');
  assert.match(flatten(ui.el('results')), /Auto-refresh every 10 s while it runs\./);
  time.state.now += 10000; await ui.timers(10000)[0].fn();
  assert.equal(ui.reads('deployment-run').length, 2); assert.equal(ui.timers(10000).length, 1);
  ui.visibility('hidden'); time.state.now += 10000; await ui.timers(10000)[0].fn();
  assert.equal(ui.reads('deployment-run').length, 2); assert.equal(ui.timers(10000).length, 0);
  ui.visibility('visible'); await settle();
  assert.equal(ui.reads('deployment-run').length, 3); assert.equal(ui.timers(10000).length, 1);
  await button(ui, 'results', '← Deployments').onclick();
  assert.equal(ui.timers(10000).length, 0, 'leaving the run ends its loop');
  await button(ui, 'results', 'Details').onclick();
  time.state.now += 3600000; await ui.timers(10000)[0].fn();
  assert.equal(ui.reads('deployment-run').length, 4);
  assert.match(flatten(ui.el('results')), /Auto-refresh paused after an hour\./); assert.equal(ui.timers(10000).length, 0);
  await button(ui, 'results', 'Refresh').onclick(); assert.equal(ui.timers(10000).length, 1);
  ui.state.runState = 'succeeded'; await ui.timers(10000)[0].fn();
  assert.equal(ui.reads('deployment-run').length, 6); assert.equal(ui.timers(10000).length, 0, 'a finished run is not read again');
  assert.doesNotMatch(flatten(ui.el('results')), /Auto-refresh/);
  assert.ok(button(ui, 'results', '← Deployments'), 'the run keeps its way back');
});

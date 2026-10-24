const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('src/hosts/panel/panel.html', 'utf8').replace('/* MAINSEQUENCE_PANEL_BUILD */ null', JSON.stringify({ version: 'test', panelId: 'test-build' }));
function element() { return { value: '', disabled: false, textContent: '', hidden: false, children: [], attributes: {}, style: {setProperty(){}},
  setAttribute(key, value) { this.attributes[key] = value; }, append(...nodes) { for (const n of nodes) n.parentNode = this; this.children.push(...nodes); }, replaceChildren(...nodes) { for (const n of nodes) n.parentNode = this; this.children = nodes; },
  replaceWith(next) { const p = this.parentNode, i = p ? p.children.indexOf(this) : -1; if (i >= 0) { p.children[i] = next; next.parentNode = p; } }, focus() {} }; }
async function panel(handler, storage = new Map()) {
  // Minute-long timers (the icon re-check) are captured for the test to fire; shorter ones run for real.
  const scheduled = [];
  const schedule = (fn, ms) => { if (ms >= 60000) { const t = { fn, ms, cleared: false }; scheduled.push(t); return t; } return setTimeout(fn, ms); };
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
  const document = { getElementById: id => els.get(id), createElement: () => element(), documentElement: { style: { setProperty: (k, v) => styles.set(k, v) } } };
  const localStorage = {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  await vm.runInNewContext('(async()=>{' + html.match(/<script type="module">([\s\S]*?)<\/script>/)[1] + '})()', { document, window: {}, parent, localStorage, addEventListener: (name, fn) => listeners.set(name, fn), setTimeout: schedule, clearTimeout: cancel, crypto: require('node:crypto') });
  return { el: id => els.get(id), requests, receive, document, styles, scheduled, pendingRechecks: () => scheduled.filter(t => !t.cleared) };
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
  assert.equal(ui.requests.filter(r => r.method === 'tools/call').length, 1, 'No environment is guessed when several exist');
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

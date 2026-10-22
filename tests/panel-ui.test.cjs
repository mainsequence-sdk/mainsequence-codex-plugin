const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('src/hosts/panel/panel.html', 'utf8').replace('/* MAINSEQUENCE_PANEL_BUILD */ null', JSON.stringify({ version: 'test', panelId: 'test-build' }));
function element() { return { value: '', disabled: false, textContent: '', hidden: false, children: [], attributes: {},
  setAttribute(key, value) { this.attributes[key] = value; }, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, focus() {} }; }
async function panel(handler) {
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
  await vm.runInNewContext('(async()=>{' + html.match(/<script type="module">([\s\S]*?)<\/script>/)[1] + '})()', { document, window: {}, parent, addEventListener: (name, fn) => listeners.set(name, fn), setTimeout, clearTimeout });
  return { el: id => els.get(id), requests, receive, document, styles };
}
const account = { authenticated: true, username: 'Analyst', source: 'machine', checked: true, backend: 'https://example.test' };
const status = { account, contextId: 'context', environments: [{ uid: 'env-a', name: 'Research' }, { uid: 'env-b', name: 'Sandbox' }] };
const page = name => ({ count: 1, limit: 20, semantic: false, results: [{ uid: name, name, description: '<img src=x onerror=alert(1)>', responseKinds: ['message'], defaults: {} }] });
const flatten = el => [el.textContent, ...el.children.map(flatten)].join(' ');

test('theme changes, safe text, explicit environment selection, read-only bridge', async () => {
  const ui = await panel(async name => name === 'mainsequence_open' ? status : page('Analyst'));
  assert.equal(ui.el('account').textContent, 'Analyst');
  assert.equal(ui.requests.filter(r => r.method === 'tools/call').length, 1, 'No environment is guessed when several exist');
  ui.el('environment').value = 'env-a'; await ui.el('environment').onchange();
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
});

test('MCP rows show saved status and only saved connections offer schema inspection', async () => {
  const toolPage = { count: 2, limit: 20, results: [
    { uid: 'saved', name: 'Saved MCP', saved: true }, { uid: 'available', name: 'Available MCP', saved: false },
  ] };
  const ui = await panel(async name => name === 'mainsequence_open' ? status : toolPage);
  ui.el('environment').value = 'env-a'; await ui.el('tools-tab').onclick();
  const walk = el => [el, ...el.children.flatMap(walk)];
  const buttons = walk(ui.el('results')).filter(el => el.textContent === 'Inspect tools');
  assert.equal(buttons.length, 2); assert.equal(buttons[0].disabled, false); assert.equal(buttons[1].disabled, true);
  assert.match(flatten(ui.el('results')), /Saved connection/); assert.match(flatten(ui.el('results')), /Not saved/);
  assert.equal(ui.requests.some(r => r.params?.name === 'mainsequence_tools'), false);
});

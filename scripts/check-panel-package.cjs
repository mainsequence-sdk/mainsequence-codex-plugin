// Exercise the resource and tool contract from an unpacked package, without account access.
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
module.exports = async function checkPanel(installed, env) {
  const child = spawn(process.execPath, ['./dist/panel-server.js'], { cwd: installed, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0; const pending = new Map();
  const deadline = setTimeout(() => { for (const wait of pending.values()) wait.reject(new Error('Packaged MCP timed out')); child.kill(); }, 10000);
  child.stderr.resume();
  child.once('error', error => { for (const wait of pending.values()) wait.reject(error); });
  readline.createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); const wait = pending.get(message.id); if (wait) { pending.delete(message.id); message.error ? wait.reject(new Error(message.error.message)) : wait.resolve(message.result); } });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'package-check', version: '1' }, capabilities: {} });
    const { tools } = await rpc('tools/list');
    if (tools.length !== 3 || !tools.every(tool => tool.annotations.readOnlyHint)) throw new Error('Expected three read-only panel tools');
    const uri = tools.find(tool => tool.name === 'mainsequence_open')?._meta?.ui?.resourceUri;
    const { contents } = await rpc('resources/read', { uri });
    if (!contents[0].text.includes('const BUILD =') || !contents[0].text.includes('"panelId":')) throw new Error('The panel must contain immutable build metadata');
    if (contents[0].mimeType !== 'text/html;profile=mcp-app') throw new Error('Invalid panel MIME type');
    if (require(path.join(installed, '.mcp.json')).mcpServers.mainsequence.args[0] !== './dist/panel-server.js') throw new Error('MCP must use the bundled server');
  } finally { clearTimeout(deadline); child.kill(); }
};

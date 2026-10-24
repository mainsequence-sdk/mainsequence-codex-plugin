// Controlled fresh Codex launches: the old allowlist fails; the fixed allowlist
// reads the same fixture session as the supported CLI. No real keyring or model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { linuxDesktopSession } from '../tests/helpers.cjs';
import { rpcProcess } from './lib/rpc.mjs';

assert.equal(process.platform, 'linux', 'This check exercises Linux Secret Service forwarding.');
const cleanups = [];
const root = path.resolve(import.meta.dirname, '..');
const binary = process.env.MAINSEQUENCE_CODEX_BINARY || 'codex';
try {
  const fixture = await linuxDesktopSession({ after: fn => cleanups.push(fn) });
  await mkdir(fixture.env.CODEX_HOME);
  const host = execFileSync(binary, ['--version'], { env: fixture.env, encoding: 'utf8' }).trim();
  const cli = JSON.parse(execFileSync(process.execPath, [path.join(root, 'codex/dist/runner.js'), 'auth-status', '--json'], { cwd: fixture.root, env: fixture.env, encoding: 'utf8' }));
  assert.equal(cli.status, 'success');
  assert.equal(cli.data.store, 'Secret Service');
  const cases = [];
  for (const forwardDesktop of [false, true]) {
    const trial = path.join(fixture.root, forwardDesktop ? 'fixed' : 'control');
    const marketplace = path.join(trial, 'marketplace');
    const plugin = path.join(marketplace, 'plugins/mainsequence');
    await cp(path.join(root, 'artifacts/local-marketplace'), marketplace, { recursive: true });
    if (!forwardDesktop) {
      const file = path.join(plugin, '.mcp.json');
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      manifest.mcpServers.mainsequence.env_vars = manifest.mcpServers.mainsequence.env_vars.filter(name => !(name in fixture.desktop));
      await writeFile(file, JSON.stringify(manifest));
    }
    const env = { ...fixture.env, CODEX_HOME: path.join(trial, 'codex-home') };
    await mkdir(env.CODEX_HOME, { recursive: true });
    const pluginId = 'mainsequence@mainsequence-local';
    for (const args of [['plugin', 'marketplace', 'add', marketplace, '--json'], ['plugin', 'add', pluginId, '--json']]) {
      execFileSync(binary, args, { cwd: trial, env, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    const client = rpcProcess(binary, ['app-server', '-c', 'analytics.enabled=false', '-c', 'features.remote_plugin=false', '-c', 'features.recommended_plugins=false',
      '-c', 'model_provider="session_offline"', '-c', 'model_providers.session_offline.name="Offline validation"',
      '-c', 'model_providers.session_offline.base_url="http://127.0.0.1:9/v1"', '-c', 'model_providers.session_offline.wire_api="responses"',
      '-c', 'model_providers.session_offline.requires_openai_auth=false'], { cwd: trial, env });
    try {
      await client.request('initialize', { clientInfo: { name: 'linux-session-validation', version: '1' }, capabilities: { experimentalApi: true } });
      client.notify('initialized');
      const threadId = (await client.request('thread/start', { cwd: trial, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', environments: [] })).thread.id;
      let server;
      for (let attempt = 0; attempt < 40; attempt++) {
        server = (await client.request('mcpServerStatus/list', { threadId })).data.find(item => item.pluginId === pluginId);
        if (server && Object.values(server.tools).some(tool => tool.name === 'mainsequence_open')) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.ok(server, 'The fresh native host must discover the installed plugin.');
      const opened = await client.request('mcpServer/tool/call', { threadId, server: server.name, tool: 'mainsequence_open', arguments: {} });
      if (forwardDesktop) {
        assert.notEqual(opened.isError, true, JSON.stringify(opened.structuredContent?.error));
        assert.equal(opened.structuredContent.issue, null);
        assert.equal(opened.structuredContent.account.source, cli.data.source);
        assert.equal(opened.structuredContent.account.checked, true);
        assert.equal(opened.structuredContent.account.username, cli.data.username);
        assert.equal(opened.structuredContent.account.backend, cli.data.backend);
      } else {
        assert.equal(opened.isError, true);
        assert.equal(opened.structuredContent.error.code, 'STORE_ERROR');
        assert.equal(opened.structuredContent.error.reason, 'SESSION_UNAVAILABLE');
        assert.match(opened.structuredContent.error.message, /desktop session bus/);
      }
      cases.push({ forwardDesktop, result: forwardDesktop ? 'verified machine session' : opened.structuredContent.error.code,
        ...(!forwardDesktop ? { reason: opened.structuredContent.error.reason } : {}) });
      await client.request('thread/unsubscribe', { threadId });
    } finally { client.close(); }
  }
  assert.ok(fixture.calls.length > 0 && fixture.calls.every(call => call.method === 'GET'));
  console.log(JSON.stringify({ host, cases, passed: true, modelTurns: 0, realKeyringAccess: false }, null, 2));
} finally { for (const cleanup of cleanups.reverse()) await cleanup(); }

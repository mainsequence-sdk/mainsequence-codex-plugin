const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { linuxDesktopSession } = require('./helpers.cjs');

test('source, standalone and npm manifests forward Linux desktop-session context', () => {
  for (const file of ['manifests/codex/.mcp.json', 'codex/.mcp.json', '.mcp.json']) {
    const server = JSON.parse(fs.readFileSync(file)).mcpServers.mainsequence;
    for (const name of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'DISPLAY', 'WAYLAND_DISPLAY']) {
      assert.ok(server.env_vars.includes(name), `${file} must forward ${name}`);
    }
    assert.equal(server.env, undefined, 'Only variable names belong in a redistributable plugin.');
  }
});

test('Linux packaged CLI and native MCP share the secure machine session with manifest forwarding', { skip: process.platform !== 'linux', timeout: 20000 }, async t => {
  const f = await linuxDesktopSession(t);
  const { rpcProcess } = await import('../scripts/lib/rpc.mjs');
  const installed = path.resolve('codex');
  const mcp = JSON.parse(fs.readFileSync(path.join(installed, '.mcp.json'))).mcpServers.mainsequence;
  async function cli(env) {
    const child = spawn(process.execPath, [path.join(installed, 'dist/runner.js'), 'auth-status', '--check', '--json'], { cwd: f.root, env });
    t.after(() => child.kill());
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(stderr, '');
    return { code, result: JSON.parse(stdout) };
  }
  async function open(env, name = 'mainsequence_open', args = {}) {
    const rpc = rpcProcess(process.execPath, mcp.args, { cwd: installed, env });
    t.after(() => rpc.close());
    try {
      await rpc.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'linux-session-regression', version: '1' } });
      const result = await rpc.request('tools/call', { name, arguments: args });
      assert.equal(rpc.stderr, '');
      return result;
    } finally { rpc.close(); }
  }
  // The issue's diagnostic reproduction: removing the desktop context changes no
  // stored credentials, but both paths fail before making a backend request.
  const missingCli = await cli(f.baseEnv), missingNative = await open(f.baseEnv);
  assert.equal(missingCli.code, 1); assert.equal(missingCli.result.error.code, 'STORE_ERROR');
  assert.equal(missingNative.isError, true); assert.equal(missingNative.structuredContent.error.code, 'STORE_ERROR');
  assert.equal(missingCli.result.error.reason, 'SESSION_UNAVAILABLE');
  assert.equal(missingNative.structuredContent.error.reason, 'SESSION_UNAVAILABLE');
  assert.match(missingNative.structuredContent.error.message, /desktop session bus/);
  const login = await open(f.baseEnv, 'mainsequence_settings', { action: 'login' });
  assert.equal(login.structuredContent.result.error.reason, 'SESSION_UNAVAILABLE');
  assert.equal(f.calls.length, 0);

  const normal = await cli(f.env);
  assert.equal(normal.code, 0);
  assert.equal(normal.result.data.source, 'machine'); assert.equal(normal.result.data.store, 'Secret Service');
  assert.equal(normal.result.data.checked, true);
  // Model the host's baseline environment plus only the manifest's explicit allowlist.
  const forwarded = { PATH: f.baseEnv.PATH, HOME: f.root, MAINSEQUENCE_CODEX_TOOL_CATALOG: 'off' };
  for (const name of mcp.env_vars) if (f.env[name] !== undefined) forwarded[name] = f.env[name];
  const native = await open(forwarded);
  assert.equal(native.isError, undefined, JSON.stringify(native.structuredContent?.error));
  assert.equal(native.structuredContent.issue, null);
  assert.ok(native.structuredContent.contextId);
  assert.equal(native.structuredContent.account.source, normal.result.data.source);
  assert.equal(native.structuredContent.account.username, normal.result.data.username);
  assert.equal(native.structuredContent.account.backend, normal.result.data.backend);
  assert.equal(native.structuredContent.account.checked, true);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.doesNotMatch(JSON.stringify([normal.result, native]), /fixture-machine-access|fixture-machine-refresh/);

  const count = f.calls.length;
  for (const [stderr, reason] of [
    ['org.freedesktop.Secret.Error.IsLocked', 'LOCKED'],
    ['org.freedesktop.DBus.Error.ServiceUnknown', 'SERVICE_UNAVAILABLE'],
    ['org.freedesktop.DBus.Error.AccessDenied', 'ACCESS_DENIED'],
    ['unrecognized helper failure', 'HELPER_FAILED'],
  ]) {
    await f.fail(stderr + '\nprivate-helper-output');
    const failed = await open(f.env);
    assert.equal(failed.structuredContent.error.reason, reason);
    const failedLogin = await open(f.env, 'mainsequence_settings', { action: 'login' });
    assert.equal(failedLogin.structuredContent.result.error.reason, reason);
    assert.doesNotMatch(JSON.stringify([failed, failedLogin]), /private-helper-output/);
  }
  assert.equal(f.calls.length, count, 'Credential-store failures stop before backend requests.');
});

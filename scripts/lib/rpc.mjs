// JSON-RPC process client for Codex host verification. No dependency on experimental plugins.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function rpcProcess(command, args, options = {}) {
  const { onServerRequest, ...spawnOptions } = options;
  const child = spawn(command, args, { ...spawnOptions, stdio: ['pipe','pipe','pipe'] });
  const pending = new Map(), notifications = []; let sequence = 0, stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`RPC process exited ${code}: ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const p = pending.get(message.id);
    if (p) { clearTimeout(p.timer); pending.delete(message.id); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    else if (message.method && message.id !== undefined) {
      if (onServerRequest) void Promise.resolve(onServerRequest(message)).then(result => child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:message.id, result })+'\n'));
      else child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:message.id, error:{ code:-32601, message:'Verification client does not implement this request.' } })+'\n');
    }
    else if (message.method) notifications.push(message);
  });
  return {
    child, notifications,
    get stderr() { return stderr; },
    request(method, params = {}, timeoutMs = 20000) { return new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); },timeoutMs);
      pending.set(id,{resolve,reject,timer}); child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    }); },
    notify(method, params) { child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'); },
    close() { child.stdin.end(); child.kill(); }
  };
}

import { readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { createNodeHost, type HostServices } from '@dev-mainsequence/devtools';
import { DiscoveryError } from './discovery';

/** The running plugin's version against the published catalog, and Codex's own plugin commands. */
export const CODEX_MARKETPLACE = 'mainsequence';
export const CODEX_PLUGIN_ID = `mainsequence@${CODEX_MARKETPLACE}`;
/** What `codex plugin add` installs from: the marketplace catalog on this repository's default branch. */
export const CODEX_CATALOG_URL = 'https://raw.githubusercontent.com/mainsequence-sdk/mainsequence-codex-plugin/main/.agents/plugins/marketplace.json';
export type PluginUpdateOptions = {
  /** The running plugin's version, from its build-info.json. */
  version: string;
  host?: HostServices; fetch?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => number;
  /** The process that started this server; Codex when it runs the plugin. */
  parentExecutable?: () => Promise<string | undefined>;
};

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CODEX = /^codex(?:\.exe)?$/;
const CATALOG_LIMIT = 256_000;
// One check serves every panel this chat opens for a while; Check for updates reads again.
const CHECK_TTL_MS = 30 * 60_000;

const split = (value: string): [number[], string] => {
  const dash = value.indexOf('-');
  return [(dash < 0 ? value : value.slice(0, dash)).split('.').map(Number), dash < 0 ? '' : value.slice(dash + 1)];
};
/** Orders x.y.z versions; a prerelease sorts before its release. Anything else compares equal. */
export function compareVersions(a: string, b: string): number {
  if (!VERSION.test(a) || !VERSION.test(b)) return 0;
  const [coreA, preA] = split(a), [coreB, preB] = split(b);
  for (let i = 0; i < 3; i++) if (coreA[i] !== coreB[i]) return coreA[i] > coreB[i] ? 1 : -1;
  if (preA === preB) return 0;
  if (!preA || !preB) return preA ? -1 : 1;
  return Math.sign(preA.localeCompare(preB, 'en', { numeric: true }));
}
/** Where the plugin stands: an update to install, one installed that needs a new chat, or neither. */
export function updateStatus(running: string, installed: string | null, latest: string | null) {
  if (!VERSION.test(running)) return 'unknown';
  const newest = installed && compareVersions(installed, running) > 0 ? installed : running;
  if (latest && compareVersions(latest, newest) > 0) return 'update_available';
  if (newest !== running) return 'restart_required';
  return latest ? 'current' : 'unknown';
}

export function createPluginUpdate(options: PluginUpdateOptions) {
  const host = options.host ?? createNodeHost();
  const env = { ...process.env, ...options.env };
  const now = options.now ?? Date.now;
  let checked: { at: number; data: Record<string, unknown> } | undefined;

  async function parentExecutable(signal: AbortSignal): Promise<string | undefined> {
    if (process.platform === 'linux') return readlink(`/proc/${process.ppid}/exe`).catch(() => undefined);
    if (process.platform !== 'darwin') return undefined;
    const result = await host.runProcess({ executable: '/bin/ps', args: ['-o', 'comm=', '-p', String(process.ppid)], cwd: '/', signal, timeoutMs: 5_000 });
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
  }
  /** Codex itself: the process that started this server. Nothing else named codex on PATH is run. */
  async function codex(signal: AbortSignal): Promise<string | undefined> {
    const candidate = await (options.parentExecutable ?? (() => parentExecutable(signal)))();
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || !CODEX.test(path.basename(candidate))) return undefined;
    return await stat(candidate).then(item => item.isFile(), () => false) ? candidate : undefined;
  }
  async function run(executable: string, args: string[], signal: AbortSignal, timeoutMs: number) {
    const result = await host.runProcess({ executable, args, cwd: env.HOME || '/', env, signal, timeoutMs });
    if (result.cancelled) throw new DiscoveryError('CANCELLED', 'The action was cancelled.');
    return result;
  }
  /** The copy Codex loads in the next chat; it can be newer than the running one. */
  async function installed(executable: string, signal: AbortSignal): Promise<string | undefined> {
    const result = await run(executable, ['plugin', 'list', '--json'], signal, 20_000);
    if (result.exitCode !== 0) return undefined;
    let list: { installed?: unknown };
    try { list = JSON.parse(result.stdout); } catch { return undefined; }
    const row = Array.isArray(list?.installed) ? list.installed.find(item => item?.pluginId === CODEX_PLUGIN_ID) : undefined;
    return typeof row?.version === 'string' && VERSION.test(row.version) ? row.version : undefined;
  }
  async function latest(signal: AbortSignal): Promise<string> {
    const response = await (options.fetch ?? fetch)(CODEX_CATALOG_URL, { signal: AbortSignal.any([AbortSignal.timeout(10_000), signal]), headers: { accept: 'application/json' } });
    const text = response.ok ? await response.text() : '';
    if (!text || text.length > CATALOG_LIMIT) throw new Error('catalog');
    const plugins = JSON.parse(text)?.plugins;
    const version = Array.isArray(plugins) ? plugins.find(item => item?.name === 'mainsequence')?.source?.version : undefined;
    if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('catalog');
    return version;
  }

  async function version(recheck: boolean, signal: AbortSignal) {
    if (!recheck && checked && now() - checked.at < CHECK_TTL_MS) return checked.data;
    const executable = await codex(signal);
    const [current, newest] = await Promise.all([executable ? installed(executable, signal) : undefined, latest(signal).catch(() => {
      if (signal.aborted) throw new DiscoveryError('CANCELLED', 'The action was cancelled.');
      return null;
    })]);
    const data = { running: options.version, installed: current ?? null, latest: newest, status: updateStatus(options.version, current ?? null, newest),
      updateSupported: Boolean(current), ...(newest ? {} : { catalogError: 'The MainSequence plugin catalog could not be reached.' }) };
    if (newest) checked = { at: now(), data };
    return data;
  }
  async function update(signal: AbortSignal) {
    const executable = await codex(signal);
    const before = executable ? await installed(executable, signal) : undefined;
    if (!executable || !before) throw new DiscoveryError('UNSUPPORTED_ACTION', `Codex's plugin commands are not available to this chat, or MainSequence was not installed from the ${CODEX_MARKETPLACE} marketplace.`);
    checked = undefined;
    if ((await run(executable, ['plugin', 'marketplace', 'upgrade', CODEX_MARKETPLACE], signal, 90_000)).exitCode !== 0) {
      throw new DiscoveryError('PROCESS_FAILED', `Codex could not refresh the ${CODEX_MARKETPLACE} marketplace.`);
    }
    if ((await run(executable, ['plugin', 'add', CODEX_PLUGIN_ID], signal, 150_000)).exitCode !== 0) throw new DiscoveryError('PROCESS_FAILED', 'Codex could not install the MainSequence update.');
    const after = await installed(executable, signal);
    if (!after) throw new DiscoveryError('PROCESS_FAILED', 'Codex installed the update but did not report the installed version.');
    return { running: options.version, previous: before, installed: after, status: updateStatus(options.version, after, null) === 'restart_required' ? 'restart_required' : 'current' };
  }
  return {
    async call(args: Record<string, unknown>, signal: AbortSignal) {
      if (args.recheck !== undefined && typeof args.recheck !== 'boolean') throw new DiscoveryError('INVALID_REQUEST', 'recheck must be a boolean.');
      if (args.action === 'version') return version(args.recheck === true, signal);
      if (args.action === 'update') return update(signal);
      throw new DiscoveryError('INVALID_REQUEST', 'mainsequence_plugin action must be "version" or "update".');
    },
  };
}

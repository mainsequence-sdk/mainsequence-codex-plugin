import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ActionResult, McpConnection, McpTool } from '@dev-mainsequence/devtools';
import { DiscoveryError, type Dispatch } from './discovery';

/**
 * Saved project MCP tools as first-class tools of this server, like the Claude Desktop
 * plugin registers them: `ms_<tool>_<hash>` with the remote schema, bound to one saved
 * connection. The catalog is read from a small local cache so tools/list answers at once;
 * a bounded background refresh keeps it current. No credentials are ever written here.
 */
type Row = Record<string, unknown>;
export type ToolBinding = { backend: string; environmentUid: string; environmentName: string; releaseUid: string; connection: string; tool: string };
export type CatalogConnection = { backend: string; releaseUid: string; environmentUid: string; environmentName: string; name: string; tools: McpTool[] };
export type ToolCatalog = { version: 1; updatedAt: string; connections: CatalogConnection[] };
export type ToolDefinition = { name: string; title: string; description: string; inputSchema: Row; annotations: Row };
export type CatalogState = { count: number; connections: { name: string; environmentName: string; tools: number }[]; updatedAt: string | null; refreshing: boolean; unavailable: string[]; error: { code: string; message: string } | null };

export const TOOL_PREFIX = 'ms_';
const FILE = 'codex-tool-catalog.json';
const LOCK_STALE_MS = 10 * 60_000;
const MAX_TOOLS_PER_CONNECTION = 80;
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 300): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

/** Beside the shared MainSequence CLI state, where devtools keeps mcp-connections.json. */
export function catalogPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MainSequenceCLI')
    : process.platform === 'win32' ? path.join(env.APPDATA || os.homedir(), 'MainSequenceCLI') : path.join(os.homedir(), '.config', 'mainsequence');
  return path.join(dir, FILE);
}

/** The Claude Desktop plugin's naming, so one tool has the same name in both hosts. The hash
 * binds backend, environment and release; the prefix keeps the remote name readable. */
export function toolName(backend: string, environmentUid: string, releaseUid: string, name: string): string {
  const value = `${backend}:${environmentUid}:${releaseUid}:${name}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  // Codex qualifies tool names with the server name; keep the whole name under 64 characters.
  return `${TOOL_PREFIX}${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}_${hash.toString(16)}`;
}
export const isRegisteredToolName = (name: unknown): name is string => typeof name === 'string' && name.startsWith(TOOL_PREFIX);

function tool(value: unknown): McpTool | undefined {
  if (!object(value) || typeof value.name !== 'string' || !value.name || !object(value.inputSchema)) return;
  const annotations: Row = {};
  for (const flag of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
    if (object(value.annotations) && typeof value.annotations[flag] === 'boolean') annotations[flag] = value.annotations[flag];
  }
  return { name: value.name, ...(typeof value.description === 'string' ? { description: value.description } : {}), inputSchema: value.inputSchema, annotations };
}
function connectionRecord(value: unknown): CatalogConnection | undefined {
  if (!object(value) || typeof value.backend !== 'string' || !UUID.test(String(value.releaseUid)) || !UUID.test(String(value.environmentUid)) || !Array.isArray(value.tools)) return;
  return { backend: value.backend, releaseUid: String(value.releaseUid).toLowerCase(), environmentUid: String(value.environmentUid).toLowerCase(),
    environmentName: text(value.environmentName), name: text(value.name), tools: value.tools.map(tool).filter((item): item is McpTool => Boolean(item)).slice(0, MAX_TOOLS_PER_CONNECTION) };
}
/** A missing or damaged cache is an empty catalog, never an error. */
export function readCatalog(file: string): ToolCatalog | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.connections)) return null;
    return { version: 1, updatedAt: text(raw.updatedAt, 40), connections: raw.connections.map(connectionRecord).filter((item): item is CatalogConnection => Boolean(item)) };
  } catch { return null; }
}
export function registration(catalog: ToolCatalog | null): { definitions: ToolDefinition[]; bindings: Map<string, ToolBinding> } {
  const definitions: ToolDefinition[] = [], bindings = new Map<string, ToolBinding>();
  for (const connection of catalog?.connections ?? []) {
    const label = connection.name || connection.releaseUid;
    for (const item of connection.tools) {
      const name = toolName(connection.backend, connection.environmentUid, connection.releaseUid, item.name);
      if (bindings.has(name)) continue;
      const schema = item.inputSchema.type === 'object' ? item.inputSchema : { type: 'object', ...item.inputSchema };
      bindings.set(name, { backend: connection.backend, environmentUid: connection.environmentUid, environmentName: connection.environmentName, releaseUid: connection.releaseUid, connection: label, tool: item.name });
      definitions.push({ name, title: `${label}: ${item.name}`, description: text(`MainSequence ${label} [${connection.environmentName || connection.environmentUid}]: ${item.description || item.name}`, 2000),
        inputSchema: schema, annotations: { openWorldHint: true, ...(item.annotations ?? {}) } });
    }
  }
  return { definitions, bindings };
}
function success<T>(result: ActionResult<T>): T {
  if (result.status !== 'success') throw new DiscoveryError(result.error?.code || 'API_ERROR', result.summary);
  if (result.data === undefined) throw new DiscoveryError('API_ERROR', 'MainSequence returned no data.');
  return result.data;
}
const label = (row: McpConnection) => row.name || row.display_name || row.resource_release_uid;

export function createToolCatalog(options: { dispatch: (signal: AbortSignal) => Dispatch; file?: string; staleMs?: number; disabled?: boolean; notify?: () => void }) {
  const file = options.file ?? catalogPath(), staleMs = options.staleMs ?? 15 * 60_000;
  let catalog = readCatalog(file), loadedAt = mtime(), registered = registration(catalog), running: Promise<void> | null = null;
  let current: { controller: AbortController; locked: boolean } | null = null;
  const state = { unavailable: [] as string[], error: null as CatalogState['error'] };
  function mtime(): number { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }
  /** Another chat's server may have refreshed the shared cache since this process read it. */
  function reload(): void {
    const current = mtime();
    if (current === loadedAt) return;
    catalog = readCatalog(file); loadedAt = current; registered = registration(catalog);
  }
  async function write(next: ToolCatalog): Promise<void> {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await fsp.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fsp.rename(temporary, file); }
    finally { await fsp.rm(temporary, { force: true }); }
  }
  function adopt(next: ToolCatalog): void {
    const before = JSON.stringify(registered.definitions);
    catalog = next; loadedAt = mtime(); registered = registration(next);
    if (JSON.stringify(registered.definitions) !== before) options.notify?.();
  }
  async function lock(): Promise<(() => Promise<void>) | null> {
    const name = file + '.lock';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fsp.open(name, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        return async () => { await handle.close(); await fsp.rm(name, { force: true }); };
      } catch (error: any) {
        if (error?.code === 'ENOENT') { await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); continue; }
        if (error?.code !== 'EEXIST') return null;
        // An interrupted refresh from a closed chat must not block every later one.
        try { if (Date.now() - (await fsp.stat(name)).mtimeMs < LOCK_STALE_MS) return null; await fsp.rm(name, { force: true }); } catch { return null; }
      }
    }
    return null;
  }
  async function readAll(dispatch: Dispatch, previous: ToolCatalog | null): Promise<ToolCatalog> {
    const status = success(await dispatch({ action: 'auth-status' }));
    if (!status.authenticated || !status.backend) throw new DiscoveryError('NOT_AUTHENTICATED', 'Sign in to MainSequence to register saved project MCP tools.');
    const backend = status.backend;
    const rows = success(await dispatch({ action: 'mcp-list', backend, readOnly: true }));
    const connections: CatalogConnection[] = [], unavailable: string[] = [];
    const pending = [...rows];
    // The shared transport keeps two upstream connections per origin; stay within them.
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (pending.length) {
        const row = pending.shift()!;
        try {
          const output = success(await dispatch({ action: 'mcp-tools', backend, releaseUid: row.resource_release_uid }));
          connections.push({ backend, releaseUid: row.resource_release_uid, environmentUid: row.mcp_connection.organization_environment_uid, environmentName: row.mcp_connection.organization_environment_name ?? '',
            name: label(row), tools: output.tools.slice(0, MAX_TOOLS_PER_CONNECTION) });
        } catch (error) {
          if (error instanceof DiscoveryError && error.code === 'CANCELLED') throw error;
          // A connection whose catalog cannot be read now keeps its earlier tools, as in Claude.
          const earlier = previous?.connections.find(item => item.backend === backend && item.releaseUid === row.resource_release_uid);
          if (earlier) connections.push(earlier);
          unavailable.push(label(row));
        }
      }
    }));
    state.unavailable = unavailable;
    return { version: 1, updatedAt: new Date().toISOString(), connections };
  }
  return {
    file,
    /** Definitions for tools/list, from the newest shared cache. */
    list(): ToolDefinition[] { reload(); return registered.definitions; },
    binding(name: string): ToolBinding | undefined { reload(); return registered.bindings.get(name); },
    state(): CatalogState {
      reload();
      return { count: registered.definitions.length, connections: (catalog?.connections ?? []).map(item => ({ name: item.name, environmentName: item.environmentName, tools: item.tools.length })),
        updatedAt: catalog?.updatedAt || null, refreshing: running !== null, unavailable: state.unavailable, error: state.error };
    },
    /** Read every saved connection's current catalog. Without force, a fresh cache is kept and
     * only one chat process refreshes at a time; the others pick its result up from the file. */
    refresh(force = false): Promise<void> {
      if (options.disabled) return Promise.resolve();
      if (running) return running;
      reload();
      if (!force && catalog && Date.parse(catalog.updatedAt) > Date.now() - staleMs) return Promise.resolve();
      const controller = new AbortController();
      current = { controller, locked: false };
      running = (async () => {
        const release = await lock();
        if (!release) return;
        current!.locked = true;
        try {
          const next = await readAll(options.dispatch(controller.signal), catalog);
          await write(next); adopt(next); state.error = null;
        } catch (error) {
          state.error = { code: error instanceof DiscoveryError ? error.code : 'INTERNAL_ERROR', message: error instanceof DiscoveryError ? error.message : 'The saved project MCP tools could not be refreshed.' };
        } finally { current!.locked = false; await release(); }
      })().finally(() => { running = null; current = null; });
      return running;
    },
    /** A chat's server is ending: stop its refresh and free the shared lock for the next one at once. */
    dispose(): void {
      if (!current) return;
      current.controller.abort();
      if (current.locked) { try { fs.rmSync(file + '.lock', { force: true }); } catch { /* the stale-lock rule still applies */ } }
    },
    /** A catalog just read for one saved release replaces that connection's tools without another round trip. */
    async update(releaseUid: string, tools: McpTool[]): Promise<void> {
      if (options.disabled) return;
      reload();
      const index = catalog?.connections.findIndex(item => item.releaseUid === releaseUid.toLowerCase()) ?? -1;
      if (!catalog || index < 0) { void this.refresh(true); return; }
      const connections = catalog.connections.map((item, i) => i === index ? { ...item, tools: tools.map(tool).filter((t): t is McpTool => Boolean(t)).slice(0, MAX_TOOLS_PER_CONNECTION) } : item);
      const next: ToolCatalog = { version: 1, updatedAt: new Date().toISOString(), connections };
      try { await write(next); adopt(next); } catch { /* the in-memory tools are already current */ }
    },
  };
}

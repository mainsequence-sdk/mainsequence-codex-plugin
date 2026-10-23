import { randomUUID } from 'node:crypto';
import type { ActionResult, SessionStatus, PlatformAgent, AgentAsset, createDevTools } from '@dev-mainsequence/devtools';

export type Dispatch = ReturnType<typeof createDevTools>['dispatch'];
type Row = Record<string, unknown>;
type Context = { backend: string; account: string; conversationId?: string; environments: Set<string>; releases: Map<string, Set<string>>; agents: Map<string, Set<string>>; projects: Map<string, Set<string>>; expires: number };
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, max = 4000): string => typeof value === 'string' ? value.slice(0, max) : '';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
export class DiscoveryError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const invalid = () => new DiscoveryError('INVALID_REQUEST', 'Choose an environment or item from the current directory.');
function success<T>(result: ActionResult<T>): T {
  if (result.status !== 'success') throw new DiscoveryError(result.error?.code || 'API_ERROR', result.summary);
  if (result.data === undefined) throw new DiscoveryError('API_ERROR', 'MainSequence returned no data.');
  return result.data;
}
function account(value: SessionStatus) {
  return { backend: text(value.backend), authenticated: value.authenticated === true, username: text(value.username, 300),
    source: text(value.source, 40), checked: value.checked === true, expiresAt: text(value.expiresAt, 100) };
}

/** Host presentation only. Every domain operation goes through the public devtools dispatcher. */
export function createDiscovery(dependencies?: {
  assets(input: { backend: string; expectedAccount: string; environmentUid: string; agentUids: string[] }, signal?: AbortSignal): Promise<Record<string, AgentAsset>>;
  repositories(backend: string, account: string, signal?: AbortSignal): Promise<unknown>;
  preferences(): Promise<{ backend: string; baseDir: string }>;
}) {
  const contexts = new Map<string, Context>();
  // A view preference only; authorization still uses the current context and devtools.
  const selectedEnvironments = new Map<string, string>();
  const accountKey = (backend: string, username: string) => JSON.stringify([backend, username]);
  function prune() {
    for (const [id, context] of contexts) if (context.expires < Date.now()) contexts.delete(id);
  }
  async function status(dispatch: Dispatch, conversationId?: string) {
    prune();
    const local = account(success(await dispatch({ action: 'auth-status' })));
    const base = { account: local, environments: [] as { uid: string; name: string; isProduction: boolean }[], contextId: null as string | null, issue: null as { code: string; message: string } | null };
    if (!local.authenticated) return base;
    try {
      const verified = account(success(await dispatch({ action: 'auth-status', backend: local.backend, check: true })));
      base.account = verified;
      if (!verified.authenticated || !verified.username) throw new DiscoveryError('NOT_AUTHENTICATED', 'Sign in to MainSequence to browse agents and tools.');
      const available = success(await dispatch({ action: 'mcp-environments', backend: verified.backend, expectedAccount: verified.username }))
        .map(item => ({ uid: item.uid, name: text(item.name, 300), isProduction: item.isProduction }));
      const final = account(success(await dispatch({ action: 'auth-status' })));
      if (final.backend !== verified.backend || !final.authenticated) throw new DiscoveryError('CONTEXT_CHANGED', 'The backend or session changed. Refresh MainSequence.');
      while (contexts.size >= 32) contexts.delete(contexts.keys().next().value!);
      const id = randomUUID();
      contexts.set(id, { backend: verified.backend, account: verified.username, conversationId, environments: new Set(available.map(e => e.uid)), releases: new Map(), agents: new Map(), projects: new Map(), expires: Date.now() + 30 * 60_000 });
      const selected = selectedEnvironments.get(accountKey(verified.backend, verified.username));
      return { ...base, contextId: id, environments: available,
        selectedEnvironmentUid: available.some(environment => environment.uid === selected) ? selected : null };
    } catch (error) {
      if (!(error instanceof DiscoveryError)) throw error;
      return { ...base, issue: { code: error.code, message: error.message } };
    }
  }
  async function scoped(dispatch: Dispatch, args: Row, run: (context: Context, environmentUid: string) => Promise<unknown>) {
    prune();
    const context = contexts.get(String(args.contextId));
    if (!context) throw new DiscoveryError('CONTEXT_CHANGED', 'Refresh MainSequence to load the current account and environments.');
    if (!uuid(args.environmentUid) || !context.environments.has(args.environmentUid.toLowerCase())) throw invalid();
    async function verify() {
      // Host settings may change while the panel is open. Devtools binds domain
      // requests to the verified account; this local check invalidates the old view.
      const current = account(success(await dispatch({ action: 'auth-status' })));
      if (!current.authenticated || current.backend !== context!.backend) {
        contexts.delete(String(args.contextId));
        throw new DiscoveryError('CONTEXT_CHANGED', 'The account or backend changed. Refresh MainSequence.');
      }
    }
    await verify();
    let answer;
    try { answer = await run(context, args.environmentUid.toLowerCase()); }
    catch (error) {
      if (error instanceof DiscoveryError && ['AUTH_REJECTED', 'NOT_AUTHENTICATED'].includes(error.code)) {
        contexts.delete(String(args.contextId));
        throw new DiscoveryError('CONTEXT_CHANGED', 'The account or session changed. Refresh MainSequence.');
      }
      throw error;
    }
    await verify();
    const key = accountKey(context.backend, context.account);
    while (selectedEnvironments.size >= 32 && !selectedEnvironments.has(key)) selectedEnvironments.delete(selectedEnvironments.keys().next().value!);
    selectedEnvironments.set(key, args.environmentUid.toLowerCase());
    return answer;
  }
  async function discover(dispatch: Dispatch, args: Row) {
    if (!['agents', 'tools'].includes(String(args.catalog)) || (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 300))
      || (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0))) throw invalid();
    return scoped(dispatch, args, async (context, environmentUid) => {
      const search = text(args.search, 300).trim(), offset = Number(args.offset || 0), limit = 20;
      // Agent semantic search is a ranked result set, not an offset-paginated directory.
      if (args.catalog === 'agents' && search && offset) throw invalid();
      const selection = { backend: context.backend, environmentUid, expectedAccount: context.account };
      if (args.catalog === 'agents') {
        const output = success(await dispatch({ action: 'agents-list', ...selection, search, limit, offset }));
        const results = output.results.map(item => {
          return { uid: item.uid, name: text(item.name, 300), description: text(item.description), runtimeState: text(item.runtimeState, 100),
            repositoryBranch: text(item.repositoryBranch, 300), responseKinds: item.responseKinds.slice(0, 10),
            defaults: { provider: text(item.defaults.provider, 100), model: text(item.defaults.model, 100), thinking: text(item.defaults.thinking, 100) } };
        });
        const known = context.agents.get(environmentUid) || new Set<string>(); results.forEach(item => known.add(item.uid)); context.agents.set(environmentUid, known);
        return { catalog: 'agents', environmentUid, count: output.count, offset: output.offset, limit, semantic: output.semantic, results };
      }
      const output = success(await dispatch({ action: 'mcp-discover', ...selection, search, limit, offset, enrichNames: true }));
      const saved = new Set(success(await dispatch({ action: 'mcp-list', ...selection, readOnly: true })).map(item => item.resource_release_uid));
      const results = output.results.map(item => {
        return { uid: item.resource_release_uid, name: text(item.name, 300) || text(item.display_name, 300) || item.resource_release_uid,
          repository: text(item.display_name, 300), environmentName: text(item.mcp_connection.organization_environment_name, 300), saved: saved.has(item.resource_release_uid) };
      });
      const known = context.releases.get(environmentUid) || new Set<string>(); results.forEach(item => known.add(item.uid)); context.releases.set(environmentUid, known);
      return { catalog: 'tools', environmentUid, count: output.count, offset, limit, semantic: false, results };
    });
  }
  async function tools(dispatch: Dispatch, args: Row) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      if (!uuid(args.releaseUid) || !context.releases.get(environmentUid)?.has(args.releaseUid.toLowerCase())) throw invalid();
      // mcp-tools checks existing saved metadata and current access. It never adds a connection or invokes a project tool.
      const output = success(await dispatch({ action: 'mcp-tools', backend: context.backend, environmentUid, releaseUid: args.releaseUid, expectedAccount: context.account }));
      return { releaseUid: args.releaseUid, tools: output.tools.map(item => {
        return { name: text(item.name, 300), description: text(item.description), inputSchema: item.inputSchema,
          annotations: Object.fromEntries(['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].filter(k => typeof row(item.annotations)[k] === 'boolean').map(k => [k, row(item.annotations)[k]])) };
      }) };
    });
  }
  async function messageSelection(dispatch: Dispatch, args: Row, conversationId: string) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      if (context.conversationId !== conversationId || !uuid(args.agentUid) || !context.agents.get(environmentUid)?.has(args.agentUid.toLowerCase())) throw invalid();
      return { backend: context.backend, account: context.account, environmentUid, agentUid: args.agentUid.toLowerCase() };
    }) as Promise<{ backend: string; account: string; environmentUid: string; agentUid: string }>;
  }
  async function view(dispatch: Dispatch, args: Row, signal?: AbortSignal) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      const selection = { backend: context.backend, expectedAccount: context.account, environmentUid };
      if (args.view === 'agent' || args.view === 'assets') {
        const ids = args.view === 'assets' ? args.agentUids : [args.agentUid];
        if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !uuid(id) || !context.agents.get(environmentUid)?.has(id.toLowerCase()))) throw invalid();
        if (args.view === 'assets') return { assets: dependencies ? await dependencies.assets({ ...selection, agentUids: ids }, signal) : {} };
        const { agent } = success(await dispatch({ action: 'agent-get', ...selection, agentUid: String(args.agentUid) })) as { agent: PlatformAgent };
        return { agent };
      }
      if (args.view === 'connections') {
        const connections = success(await dispatch({ action: 'mcp-list', ...selection, readOnly: true }));
        const known = context.releases.get(environmentUid) || new Set<string>();
        const results = connections.map(item => { known.add(item.resource_release_uid); return { uid: item.resource_release_uid, name: text(item.name,300) || text(item.display_name,300) || item.resource_release_uid, saved:true }; });
        context.releases.set(environmentUid, known); return { results, count: results.length };
      }
      if (args.view === 'projects') {
        if ((args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0)) || (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 300))) throw invalid();
        const page = success(await dispatch({ action: 'organization-projects', ...selection, search:text(args.search,300), offset:Number(args.offset || 0), limit:20 }));
        context.projects.set(environmentUid,new Set(page.results.map(p => p.uid))); return page;
      }
      if (args.view === 'project') {
        if (!uuid(args.projectUid) || !context.projects.get(environmentUid)?.has(args.projectUid)) throw invalid();
        return success(await dispatch({ action: 'organization-project', ...selection, projectUid:args.projectUid }));
      }
      if (args.view === 'repositories' && dependencies) return { results: await dependencies.repositories(context.backend, context.account, signal) };
      if (args.view === 'preferences' && dependencies) return { preferences: await dependencies.preferences() };
      throw invalid();
    });
  }
  async function connection(dispatch: Dispatch, args: Row) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      if (!['connect','disconnect'].includes(String(args.action)) || !uuid(args.releaseUid) || !context.releases.get(environmentUid)?.has(args.releaseUid)) throw invalid();
      const result = await dispatch({ action: args.action === 'connect' ? 'mcp-add' : 'mcp-remove', backend:context.backend, expectedAccount:context.account, environmentUid, releaseUid:args.releaseUid });
      if (result.status !== 'success') throw new DiscoveryError(result.error?.code || 'API_ERROR', result.summary);
      return { summary: result.summary, connected: args.action === 'connect' };
    });
  }
  async function invoke(dispatch: Dispatch, args: Row) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      if (!uuid(args.releaseUid) || !context.releases.get(environmentUid)?.has(args.releaseUid) || typeof args.tool !== 'string' || !args.tool.trim() || args.tool.length > 300 || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) throw invalid();
      const output = await dispatch({ action:'mcp-call', backend:context.backend, expectedAccount:context.account, environmentUid, releaseUid:args.releaseUid, tool:args.tool, arguments:args.arguments as Row });
      // Preserve remote MCP failures and uncertain effects through the native tool
      // boundary. Authentication changes still invalidate the scoped panel.
      if (output.error && ['AUTH_REJECTED','NOT_AUTHENTICATED'].includes(output.error.code)) throw new DiscoveryError(output.error.code, output.summary);
      return { result: output.data, ...(output.status === 'success' ? {} : { error: output.error || { code:'API_ERROR', message:output.summary }, effects:output.effects }) };
    });
  }
  return { status, discover, tools, messageSelection, view, connection, invoke, scoped };
}

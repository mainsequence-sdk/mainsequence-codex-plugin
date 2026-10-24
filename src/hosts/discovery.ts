import { randomUUID } from 'node:crypto';
import type { ActionResult, SessionStatus, PlatformAgent, CredentialStoreFailureReason, createDevTools } from '@dev-mainsequence/devtools';

export type Dispatch = ReturnType<typeof createDevTools>['dispatch'];
type Row = Record<string, unknown>;
type Context = { backend: string; account: string; conversationId?: string; environments: Map<string, string>; releases: Map<string, Set<string>>; agents: Map<string, Set<string>>; projects: Map<string, Set<string>>; expires: number };
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, max = 4000): string => typeof value === 'string' ? value.slice(0, max) : '';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
export class DiscoveryError extends Error {
  constructor(readonly code: string, message: string, readonly reason?: CredentialStoreFailureReason) { super(message); }
}
// Every refusal names the argument and what would be accepted: the model reads these, and
// one generic sentence for five different mistakes was indistinguishable from a broken host.
const invalid = (message: string) => new DiscoveryError('INVALID_REQUEST', message);
const shown = (value: unknown) => JSON.stringify(typeof value === 'string' ? value.slice(0, 80) : value === undefined ? 'missing' : value).slice(0, 100);
function success<T>(result: ActionResult<T>): T {
  if (result.status !== 'success') throw new DiscoveryError(result.error?.code || 'API_ERROR', result.summary, result.error?.reason);
  if (result.data === undefined) throw new DiscoveryError('API_ERROR', 'MainSequence returned no data.');
  return result.data;
}
function account(value: SessionStatus) {
  return { backend: text(value.backend), authenticated: value.authenticated === true, username: text(value.username, 300),
    source: text(value.source, 40), checked: value.checked === true, expiresAt: text(value.expiresAt, 100) };
}
const environmentLabel = (context: Context, uid: string) => `${context.environments.get(uid) || 'environment'} (${uid})`;
/** A release the context has seen, in this environment. Says where it was seen instead when it belongs elsewhere. */
function knownRelease(context: Context, environmentUid: string, value: unknown, kind: 'saved or discovered' | 'discovered'): string {
  if (!uuid(value)) throw invalid(`releaseUid must be a release UUID from mainsequence_view connections or mainsequence_discover tools, not ${shown(value)}.`);
  const uid = value.toLowerCase();
  if (context.releases.get(environmentUid)?.has(uid)) return uid;
  const elsewhere = [...context.releases].find(([, set]) => set.has(uid))?.[0];
  if (elsewhere) throw invalid(`Release ${uid} belongs to ${environmentLabel(context, elsewhere)}; pass environmentUid ${shown(elsewhere)} instead of ${shown(environmentUid)}.`);
  throw invalid(`Release ${uid} is not a ${kind} MCP of ${environmentLabel(context, environmentUid)} in this chat. Read mainsequence_view with view "connections" (saved) or mainsequence_discover with catalog "tools" first, then use its releaseUid.`);
}

/** Host presentation only. Every domain operation goes through the public devtools dispatcher. */
export function createDiscovery(dependencies?: {
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
    const base = { account: local, environments: [] as { uid: string; name: string; isProduction: boolean }[], contextId: null as string | null, issue: null as { code: string; message: string; reason?: CredentialStoreFailureReason } | null };
    if (!local.authenticated) return base;
    try {
      const verified = account(success(await dispatch({ action: 'auth-status', backend: local.backend, check: true })));
      base.account = verified;
      if (!verified.authenticated || !verified.username) throw new DiscoveryError('NOT_AUTHENTICATED', 'Sign in to MainSequence to browse agents and tools.');
      const available = success(await dispatch({ action: 'mcp-environments', backend: verified.backend, expectedAccount: verified.username }))
        .map(item => ({ uid: item.uid, name: text(item.name, 300), isProduction: item.isProduction }));
      const final = account(success(await dispatch({ action: 'auth-status' })));
      if (final.backend !== verified.backend || !final.authenticated) throw new DiscoveryError('CONTEXT_CHANGED', `The backend changed from ${verified.backend} to ${final.backend || 'none'} while opening. Refresh MainSequence.`);
      while (contexts.size >= 32) contexts.delete(contexts.keys().next().value!);
      const id = randomUUID();
      contexts.set(id, { backend: verified.backend, account: verified.username, conversationId, environments: new Map(available.map(e => [e.uid.toLowerCase(), e.name])), releases: new Map(), agents: new Map(), projects: new Map(), expires: Date.now() + 30 * 60_000 });
      const selected = selectedEnvironments.get(accountKey(verified.backend, verified.username));
      return { ...base, contextId: id, environments: available,
        selectedEnvironmentUid: available.some(environment => environment.uid === selected) ? selected : null };
    } catch (error) {
      if (!(error instanceof DiscoveryError)) throw error;
      return { ...base, issue: { code: error.code, message: error.message, ...(error.reason ? { reason: error.reason } : {}) } };
    }
  }
  async function scoped(dispatch: Dispatch, args: Row, run: (context: Context, environmentUid: string) => Promise<unknown>) {
    prune();
    const context = contexts.get(String(args.contextId));
    if (!context) throw new DiscoveryError('CONTEXT_CHANGED', `contextId ${shown(args.contextId)} is unknown to this server (contexts live 30 minutes in the chat's server process). Call mainsequence_open again and use its contextId.`);
    if (!uuid(args.environmentUid) || !context.environments.has(args.environmentUid.toLowerCase())) {
      throw invalid(`environmentUid ${shown(args.environmentUid)} is not one of this account's environments: ${[...context.environments].map(([uid, name]) => `${name} = ${uid}`).join('; ')}.`);
    }
    const environmentUid = args.environmentUid.toLowerCase();
    async function verify() {
      // Host settings may change while the panel is open. Devtools binds domain
      // requests to the verified account; this local check invalidates the old view.
      const current = account(success(await dispatch({ action: 'auth-status' })));
      if (!current.authenticated || current.backend !== context!.backend) {
        contexts.delete(String(args.contextId));
        throw new DiscoveryError('CONTEXT_CHANGED', current.authenticated ? `The backend changed from ${context!.backend} to ${current.backend}. Refresh MainSequence.` : `No MainSequence session is available for ${context!.backend} any more. Sign in again, then refresh MainSequence.`);
      }
    }
    await verify();
    let answer;
    try { answer = await run(context, environmentUid); }
    catch (error) {
      if (error instanceof DiscoveryError && ['AUTH_REJECTED', 'NOT_AUTHENTICATED'].includes(error.code)) {
        contexts.delete(String(args.contextId));
        throw new DiscoveryError('CONTEXT_CHANGED', `The account or session changed (${error.code}: ${error.message}). Refresh MainSequence and retry once.`);
      }
      throw error;
    }
    await verify();
    const key = accountKey(context.backend, context.account);
    while (selectedEnvironments.size >= 32 && !selectedEnvironments.has(key)) selectedEnvironments.delete(selectedEnvironments.keys().next().value!);
    selectedEnvironments.set(key, environmentUid);
    return answer;
  }
  function page(args: Row) {
    if (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 300)) throw invalid(`search must be a string of at most 300 characters, not ${shown(args.search)}.`);
    if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || Number(args.offset) < 0)) throw invalid(`offset must be a non-negative integer, not ${shown(args.offset)}.`);
  }
  async function discover(dispatch: Dispatch, args: Row) {
    if (!['agents', 'tools'].includes(String(args.catalog))) throw invalid(`catalog must be "agents" or "tools", not ${shown(args.catalog)}.`);
    page(args);
    return scoped(dispatch, args, async (context, environmentUid) => {
      const search = text(args.search, 300).trim(), offset = Number(args.offset || 0), limit = 20;
      // Agent semantic search is a ranked result set, not an offset-paginated directory.
      if (args.catalog === 'agents' && search && offset) throw invalid('Agent search returns one ranked result set; omit offset when search is set.');
      const selection = { backend: context.backend, environmentUid, expectedAccount: context.account };
      if (args.catalog === 'agents') {
        const output = success(await dispatch({ action: 'agents-list', ...selection, search, limit, offset, includeIcons:true }));
        const results = output.results.map(item => {
          return { uid: item.uid, name: text(item.name, 300), description: text(item.description), runtimeState: text(item.runtimeState, 100),
            repositoryBranch: text(item.repositoryBranch, 300), responseKinds: item.responseKinds.slice(0, 10), icon:item.icon ?? null,
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
      const releaseUid = knownRelease(context, environmentUid, args.releaseUid, 'saved or discovered');
      // mcp-tools checks existing saved metadata and current access. It never adds a connection or invokes a project tool.
      const output = success(await dispatch({ action: 'mcp-tools', backend: context.backend, environmentUid, releaseUid, expectedAccount: context.account }));
      return { releaseUid, tools: output.tools.map(item => {
        return { name: text(item.name, 300), description: text(item.description), inputSchema: item.inputSchema,
          annotations: Object.fromEntries(['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].filter(k => typeof row(item.annotations)[k] === 'boolean').map(k => [k, row(item.annotations)[k]])) };
      }) };
    });
  }
  async function messageSelection(dispatch: Dispatch, args: Row, conversationId: string) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      if (context.conversationId !== conversationId) throw invalid('This contextId was opened from another chat; agent messages are bound to the chat that opened MainSequence. Call mainsequence_open in this chat and use its contextId.');
      if (!uuid(args.agentUid) || !context.agents.get(environmentUid)?.has(args.agentUid.toLowerCase())) {
        throw invalid(`agentUid ${shown(args.agentUid)} is not an agent of ${environmentLabel(context, environmentUid)} seen in this chat. Read mainsequence_discover with catalog "agents" first and use a uid from its results.`);
      }
      return { backend: context.backend, account: context.account, environmentUid, agentUid: args.agentUid.toLowerCase() };
    }) as Promise<{ backend: string; account: string; environmentUid: string; agentUid: string }>;
  }
  async function view(dispatch: Dispatch, args: Row, signal?: AbortSignal) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      const selection = { backend: context.backend, expectedAccount: context.account, environmentUid };
      if (args.view === 'agent' || args.view === 'assets') {
        const ids = args.view === 'assets' ? args.agentUids : [args.agentUid];
        if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !uuid(id) || !context.agents.get(environmentUid)?.has(id.toLowerCase()))) {
          throw invalid(`${args.view === 'assets' ? 'agentUids (at most 20)' : 'agentUid'} must name agents of ${environmentLabel(context, environmentUid)} seen in this chat; read mainsequence_discover with catalog "agents" first.`);
        }
        // Old open panels must not trigger another directory or individual icon reads.
        if (args.view === 'assets') return { assets: {} };
        const { agent } = success(await dispatch({ action: 'agent-get', ...selection, agentUid: String(args.agentUid), includeIcons:true })) as { agent: PlatformAgent };
        return { agent };
      }
      if (args.view === 'connections') {
        const connections = success(await dispatch({ action: 'mcp-list', ...selection, readOnly: true }));
        const known = context.releases.get(environmentUid) || new Set<string>();
        const results = connections.map(item => { known.add(item.resource_release_uid); return { uid: item.resource_release_uid, name: text(item.name,300) || text(item.display_name,300) || item.resource_release_uid, saved:true }; });
        context.releases.set(environmentUid, known); return { results, count: results.length };
      }
      if (args.view === 'projects') {
        page(args);
        const result = success(await dispatch({ action: 'organization-projects', ...selection, search:text(args.search,300), offset:Number(args.offset || 0), limit:20 }));
        context.projects.set(environmentUid,new Set(result.results.map(p => p.uid))); return result;
      }
      if (args.view === 'project') {
        if (!uuid(args.projectUid) || !context.projects.get(environmentUid)?.has(args.projectUid)) throw invalid(`projectUid ${shown(args.projectUid)} is not a project of ${environmentLabel(context, environmentUid)} seen in this chat; read mainsequence_view with view "projects" first.`);
        return success(await dispatch({ action: 'organization-project', ...selection, projectUid:args.projectUid }));
      }
      if (args.view === 'repositories' && dependencies) return { results: await dependencies.repositories(context.backend, context.account, signal) };
      if (args.view === 'preferences' && dependencies) return { preferences: await dependencies.preferences() };
      throw invalid(`view must be one of agent, assets, connections, projects, project, repositories or preferences, not ${shown(args.view)}.`);
    });
  }
  async function connection(dispatch: Dispatch, args: Row) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      if (!['connect','disconnect'].includes(String(args.action))) throw invalid(`action must be "connect" or "disconnect", not ${shown(args.action)}.`);
      const releaseUid = knownRelease(context, environmentUid, args.releaseUid, 'discovered');
      const result = await dispatch({ action: args.action === 'connect' ? 'mcp-add' : 'mcp-remove', backend:context.backend, expectedAccount:context.account, environmentUid, releaseUid });
      if (result.status !== 'success') throw new DiscoveryError(result.error?.code || 'API_ERROR', result.summary);
      return { summary: result.summary, connected: args.action === 'connect' };
    });
  }
  async function invoke(dispatch: Dispatch, args: Row) {
    return scoped(dispatch, args, async (context, environmentUid) => {
      const releaseUid = knownRelease(context, environmentUid, args.releaseUid, 'saved or discovered');
      if (typeof args.tool !== 'string' || !args.tool.trim() || args.tool.length > 300) throw invalid(`tool must be a tool name from mainsequence_tools (a non-empty string of at most 300 characters), not ${shown(args.tool)}.`);
      // An omitted argument object means no arguments; anything else must be the tool's input object.
      const input = args.arguments === undefined ? {} : args.arguments;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(`arguments must be a JSON object matching the tool's inputSchema (omit it for no arguments), not ${shown(args.arguments)}.`);
      const output = await dispatch({ action:'mcp-call', backend:context.backend, expectedAccount:context.account, environmentUid, releaseUid, tool:args.tool, arguments:input as Row });
      // Preserve remote MCP failures and uncertain effects through the native tool
      // boundary. Authentication changes still invalidate the scoped panel.
      if (output.error && ['AUTH_REJECTED','NOT_AUTHENTICATED'].includes(output.error.code)) throw new DiscoveryError(output.error.code, output.summary);
      return { result: output.data, ...(output.status === 'success' ? {} : { error: output.error || { code:'API_ERROR', message:output.summary }, effects:output.effects }) };
    });
  }
  return { status, discover, tools, messageSelection, view, connection, invoke, scoped };
}

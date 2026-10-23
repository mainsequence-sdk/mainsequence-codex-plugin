import { AgentDelivery, ToolingError, type AgentDeliveryScope, type AgentDeliveryDispatch } from '@dev-mainsequence/devtools';
import { DiscoveryError, type createDiscovery, type Dispatch } from './discovery';

type Row = Record<string, unknown>;
/** This identity is supplied by Codex, never by a model/app tool argument. */
export function conversationIdentity(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return;
  const { threadId, thread_id } = meta as Row;
  if (threadId !== undefined && thread_id !== undefined && threadId !== thread_id) return;
  const value = threadId ?? thread_id;
  return typeof value === 'string' && value.trim() && value.length <= 512 ? value : undefined;
}
export function createMessaging(discovery: ReturnType<typeof createDiscovery>, createDispatch: (signal?: AbortSignal) => AgentDeliveryDispatch,
  options: { directory?: string; readinessTimeoutMs?: number } = {}) {
  const delivery = new AgentDelivery({ ...options, createDispatch });
  async function scope(dispatch: Dispatch, conversationId?: string): Promise<AgentDeliveryScope> {
    if (!conversationId) throw new DiscoveryError('CONVERSATION_REQUIRED', 'Open MainSequence inside a Codex chat to send or recover messages.');
    const local = await dispatch({ action: 'auth-status' });
    if (local.status !== 'success' || !local.data?.authenticated || !local.data.backend) throw new DiscoveryError('NOT_AUTHENTICATED', 'Refresh your shared MainSequence session.');
    const result = await dispatch({ action: 'auth-status', backend: local.data.backend, check: true });
    if (result.status !== 'success' || !result.data?.authenticated || !result.data.username) throw new DiscoveryError('NOT_AUTHENTICATED', 'The shared MainSequence account could not be verified.');
    return { host: 'codex', conversationId, backend: result.data.backend, account: result.data.username };
  }
  async function call(name: string, args: Row, dispatch: Dispatch, conversationId: string | undefined, signal: AbortSignal) {
    const target = await scope(dispatch, conversationId);
    if (name === 'mainsequence_agent_prepare') {const selected=await discovery.messageSelection(dispatch,args,target.conversationId);return {conversation:await delivery.prepare(target,{...selected,conversationKey:args.conversationKey as string|undefined},signal)};}
    if (name === 'mainsequence_stage_message') {
      const selected = await discovery.messageSelection(dispatch, args, target.conversationId);
      if (selected.backend !== target.backend || selected.account !== target.account) throw new DiscoveryError('CONTEXT_CHANGED', 'The selected account changed. Refresh MainSequence.');
      return { request: await delivery.stage(target, { ...selected, requestId: args.requestId as string, message: args.message as string, conversationKey: args.conversationKey as string | undefined, taskRequestId: args.taskRequestId as string | undefined, responseKind: args.responseKind as 'message' | 'task' | undefined }, signal) };
    }
    if (name === 'mainsequence_agent_task') return { request: await delivery.task(target, args.requestId as string, args.action as 'get' | 'wait' | 'cancel', signal) };
    if (name === 'mainsequence_submission') return { request: await delivery.submission(target, args.requestId as string, args.outcome as 'attempted' | 'acknowledged' | 'unknown', signal) };
    if ((name === 'mainsequence_agent_status' && !['list', 'get', 'wait'].includes(String(args.action)))
      || (name === 'mainsequence_agent_request' && !['deliver', 'cancel'].includes(String(args.action)))) throw new ToolingError('INVALID_REQUEST', 'Use the matching delivery or read-only status tool.');
    const id = args.requestId as string;
    switch (args.action) {
      case 'list': if (id !== undefined) throw new ToolingError('INVALID_REQUEST', 'List takes no request ID.'); return { requests: await delivery.list(target, signal) };
      case 'get': return { request: await delivery.get(target, id, signal) };
      case 'deliver': return { request: await delivery.deliver(target, id, signal) };
      case 'wait': return { request: await delivery.wait(target, id, signal) };
      case 'cancel': return { request: await delivery.cancel(target, id, signal) };
      default: throw new ToolingError('INVALID_REQUEST', 'Choose list, get, deliver, wait or cancel.');
    }
  }
  return { call };
}

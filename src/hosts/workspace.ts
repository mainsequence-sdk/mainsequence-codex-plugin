import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDevTools, createNodeHost, createSessionService, bindSessionAccount, createProjectOperations, PROJECT_OPERATION_ACTIONS,
  createDeployments, readDesktopPreferences, writeWorkspacePreferences, RepositoryClient, safeSlug, ToolingError, type ActionResult,
  type ActionRequest, type ProjectOperationRequest, type DeploymentRequest, type SessionLock } from '@dev-mainsequence/devtools';
import { createDiscovery, type Dispatch, DiscoveryError } from './discovery';
type Row = Record<string, unknown>;
type Job = { id: string; action: string; context: string; environmentUid: string; status: 'running' | 'success' | 'failure' | 'cancelled'; progress: string; startedAt: string; result?: ActionResult; owner: string; controller: AbortController };
const READ = new Set(['status','resolve','sdk-status','local-repositories','delete-local-preview','docker-preview','devcontainer-preview','deployment-history','deployment-run','deployment-logs','update-sdk','install-skills']);
const WRITE = new Set(['setup','sync','update-sdk','update-agents','install-skills','skills-sync','install','env-cleanup','open-folder','docker-build','devcontainer-write','delete-local','organization-project-setup','organization-project-link']);
const ALLOWED = new Set(['root','projectType','repositoryUid','branch','baseDir','install','dryRun','organization','confirmation','image','platform','expectedDigest','projectUid','branchUid','target','commandCenterUrl','codeRepositoryBranchUid','limit','offset','runUid','kind','stepUid','cursor']);
export function createWorkspace(discovery: ReturnType<typeof createDiscovery>, dependencies: { fetch?: typeof fetch; sessionLock?: SessionLock; execute?: (action: string, input: Row, context: {backend:string;account:string}, environmentUid:string, signal?:AbortSignal, progress?:(message:string)=>void) => Promise<ActionResult> } = {}) {
  const jobs = new Map<string, Job>();
  const ownerKey = (context: { backend: string; account: string; conversationId?: string }) => JSON.stringify([context.backend, context.account, context.conversationId]);
  const publicJob = ({ owner: _, controller: __, ...job }: Job) => job;
  async function execute(action: string, args: Row, scope: { backend: string; account: string }, environmentUid: string, signal?: AbortSignal, progress?: (message: string) => void) {
    if(dependencies.execute) return dependencies.execute(action,args,scope,environmentUid,signal,progress);
    const host = createNodeHost(progress);
    host.openFolder = async root => { if (!await host.openBrowser(pathToFileURL(root).href)) throw new ToolingError('BROWSER_FAILED','The folder could not open.'); };
    const originalSession = createSessionService(host, { signal, fetch:dependencies.fetch, sessionLock:dependencies.sessionLock });
    const session = await bindSessionAccount(originalSession, scope.backend, scope.account);
    const input = { ...args, action, backend: scope.backend, expectedAccount: scope.account, environmentUid };
    let result: ActionResult;
    if (action.startsWith('deployment-')) result = await createDeployments({host,signal,fetch:dependencies.fetch, sessionLock:dependencies.sessionLock}).dispatch(input as DeploymentRequest);
    else if (PROJECT_OPERATION_ACTIONS.has(action)) result = await createProjectOperations({ host, signal }).dispatch(input as unknown as ProjectOperationRequest);
    // Organization actions bind expectedAccount themselves. A scoped session cannot
    // be rebound; ordinary repository actions instead need our already-bound session.
    else result = await createDevTools({ host, session: action.startsWith('organization-project-') ? originalSession : session, signal, fetch:dependencies.fetch, sessionLock:dependencies.sessionLock }).dispatch({ ...input, ...(action === 'organization-project-setup' ? { instructionsFile: 'AGENTS.md' } : {}) } as ActionRequest);
    await session.status(scope.backend, true);
    if(action==='organization-project-setup' && result.data && typeof result.data==='object') {const {claudeUrl: _,...workspace}=result.data as Record<string,unknown>;result={...result,data:workspace};}
    return result;
  }
  async function call(name: string, args: Row, dispatch: Dispatch, signal: AbortSignal, conversationId?: string) {
    if (name === 'mainsequence_settings') {
      if (args.action === 'get') return { preferences: await readDesktopPreferences(), runtime: { pluginWorkspace: null, workingDirectory: process.cwd(), nodeVersion: process.version, platform: process.platform + ' ' + process.arch,
        capabilities: { folderPicker: false, signedNativeTerminal: false, nativeWorkspaceAttachment: false, folderPath: true } } };
      if (args.action === 'save') return { preferences: await writeWorkspacePreferences({backend:String(args.backend || ''),baseDir:String(args.baseDir || ''),commandCenterUrl:String(args.commandCenterUrl || '')}) };
      if (!['login','logout','refresh-token'].includes(String(args.action))) throw new DiscoveryError('INVALID_REQUEST','Choose a supported account action.');
      // The normal shared login service owns the browser and private credential persistence.
      return { result: await dispatch({action:args.action,backend:typeof args.backend === 'string' ? args.backend : undefined} as ActionRequest) };
    }
    return discovery.scoped(dispatch,args,async (context,environmentUid) => {
      if (context.conversationId !== conversationId) throw new DiscoveryError('CONTEXT_CHANGED','Open MainSequence from this chat.');
      if (name === 'mainsequence_operations') {
        const owned = [...jobs.values()].filter(job => job.owner === ownerKey(context));
        if (args.action === 'list') return { operations: owned.map(publicJob) };
        const job = owned.find(job => job.id === args.operationId);
        if (!job) throw new DiscoveryError('INVALID_REQUEST','No operation belongs to this account and chat.');
        if (args.action === 'cancel' && job.status === 'running') { job.progress = 'Cancelling…'; job.controller.abort(); }
        else if (args.action !== 'get' && args.action !== 'cancel') throw new DiscoveryError('INVALID_REQUEST','Choose list, get or cancel.');
        return { operation: publicJob(job) };
      }
      const action = String(args.action), input = (args.input || {}) as Row;
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !ALLOWED.has(k))) throw new DiscoveryError('INVALID_REQUEST','Unsupported workspace arguments.');
      if (name === 'mainsequence_workspace' && action === 'local-context') {
        const prefs = await readDesktopPreferences();
        const session = await bindSessionAccount(createSessionService(createNodeHost(),{signal,fetch:dependencies.fetch, sessionLock:dependencies.sessionLock}),context.backend,context.account);
        const client=new RepositoryClient(session,context.backend),profile = await client.getCurrentUserProfile();
        const repositories=(await client.getCodeRepositories()).map(repo=>({uid:repo.uid,name:repo.code_repository_name}));
        const organization = safeSlug(profile.organization || 'default');
        const local = await execute('local-repositories',{baseDir:prefs.baseDir,organization,repositories},context,environmentUid,signal);
        return { preferences:prefs,organization,local,pluginWorkspace:null };
      }
      if (!(name === 'mainsequence_workspace' ? READ : WRITE).has(action)) throw new DiscoveryError('INVALID_REQUEST','Unsupported workspace action.');
      if (action.startsWith('organization-project') && (!context.projects.get(environmentUid)?.has(String(input.projectUid)))) throw new DiscoveryError('INVALID_REQUEST','Choose a project from the current directory.');
      if (name === 'mainsequence_workspace' && ['update-sdk','install-skills'].includes(action) && input.dryRun !== true) throw new DiscoveryError('INVALID_REQUEST','Preview requires dryRun: true.');
      if (name === 'mainsequence_workspace') return { result: await execute(action,input,context,environmentUid,signal) };
      // Accepted operations outlive panel close/native Stop. Cancellation is explicit; never replay a job.
      if (action === 'setup' && [...jobs.values()].some(job => job.owner === ownerKey(context) && job.action === action && job.context === String(input.repositoryUid) && job.status === 'running')) throw new DiscoveryError('PROJECT_BUSY','This repository is already being set up. View its running operation before trying again.');
      if ([...jobs.values()].filter(j => j.status === 'running').length >= 8) throw new DiscoveryError('PROJECT_BUSY','Wait for a running operation to finish.');
      while(jobs.size >= 100) { const old = [...jobs.values()].find(j => j.status !== 'running'); if (!old) break; jobs.delete(old.id); }
      const job: Job = {id:randomUUID(),action,context:String(input.root || input.projectUid || input.repositoryUid || ''),environmentUid,status:'running',progress:'Starting…',startedAt:new Date().toISOString(),owner:ownerKey(context),controller:new AbortController()};
      jobs.set(job.id,job);
      void execute(action,input,context,environmentUid,job.controller.signal,message => {job.progress=message;}).then(result => {job.result=result;job.status=result.status;job.progress=result.summary;},error => {
        job.status=job.controller.signal.aborted?'cancelled':'failure';job.progress=error instanceof ToolingError?error.message:'The operation stopped. Inspect partial changes before retrying.';
        job.result={schemaVersion:1,action,status:job.status,summary:job.progress,effects:{state:'partial-or-uncertain',message:'Local or remote state may have changed. No automatic retry was attempted.'}};
      });
      return {operation:publicJob(job)};
    });
  }
  return {call};
}

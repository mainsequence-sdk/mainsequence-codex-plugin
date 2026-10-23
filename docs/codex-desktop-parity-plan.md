# MainSequence in stock Codex: implementation plan

Updated 2026-10-22 after the shared discovery upgrade. Codex 0.4.2 now consumes the devtools 0.3.2 release candidate for typed, account-bound discovery and read-only saved connections. The earlier live probe communication proof remains complete; authenticated desktop acceptance and production agent delivery remain pending. Neither new package has been published by this work.

## Decision and ownership

**Devtools remains the head.** Its public package owns MainSequence operations, authentication/session behavior, validation, repository/project policy, agent transport and project MCP transport. This repository supplies the Codex presentation and host integration for those capabilities.

The independent Claude project is a read-only behavior reference. Do not import its modules, bundle its UI, introduce a Claude adapter here, or change that project to implement Codex. Use the existing Codex plugin distribution and stock Codex APIs; no custom Codex build, extra orchestration service or replacement domain layer.

The native communication path now demonstrated is:

**Codex MCP App → native app message → Codex model invokes the plugin's MCP tool → devtools → agent → tool result and labelled native assistant reply.**

The result participates in subsequent native chat context. This path uses a Codex inference turn. It is not Claude's zero-inference command-output mechanism, and it does not insert a separate external-agent role.

| Owner | Responsibilities |
| --- | --- |
| Devtools | Existing public actions and clients; machine session and credentials; domain validation; agent readiness/send/tasks; MCP connection/catalog/call semantics; repository and project operations. |
| Codex plugin | MCP App and bridge; thin MCP tool handlers calling public devtools APIs; Codex chat identity and per-chat routing metadata; native message/draft integration; UI confirmations, progress, Activity, styles, package lifecycle and host tests. |
| Stock Codex | Composer/transcript rendering, model execution, app-message scheduling, tool catalog adoption and extension surfaces. A host limitation is not a reason to move UI policy into devtools. |
| Claude project | Remains independent and unchanged. Its existing behavior defines reference cases, not a runtime dependency. |

The disposable probe completed the core host communication proof. The 0.4.1 build introduced the production Agents/Tools panel; 0.4.2 upgrades its shared discovery implementation to devtools 0.3.2. Claude remains unchanged. The probe remains separate; real agent sending and production request storage are not implemented by this read-only slice.

## Current product boundary

The product is `mainsequence-codex-plugin`, installed as **MainSequence** (`mainsequence@mainsequence-local` for the local build). Production implementation is under `src/` and uses the public devtools package. The standalone Host Probe has been uninstalled from the desktop. Its historical test sources/results remain development evidence, are excluded from both release archives, and are not imported by production code or its verification scripts. The installed 0.4.1 package is separate from the newly built 0.4.2 candidate, which pins devtools 0.3.2 and has not been activated in the desktop by this upgrade.

## What we actually verified

The earlier native relay used the **unchanged devtools 0.3.0 package with fixture transports**. The phase 1 build/update tests were repeated against the **0.3.1 dependency now installed in the workspace**, with no dependency edits by this implementation. Real Codex desktop/model interactions are distinguished below from an isolated actual Codex runtime using a scripted local model. No real MainSequence account, remote agent or project MCP was exercised.

| Capability | Verified observation | Limit |
| --- | --- | --- |
| Native agent reply | The 0.6.0 panel saved immutable input and target before submission; actual Codex delivered the request ID through its MCP tool and quoted the receipt’s real fixture reply. | Requires model inference. Real services, request provenance and durable production storage still need qualification. |
| Next-turn context | D1’s separate recall request contained no answer. A completed later turn reproduced its exact multiline reply with **zero tools, zero commands and no resend**; total sends stayed six. | Desktop compaction, new/branched chats, long histories and restart/resume of this MCP relay remain untested. |
| Literal input and duplicates | The saved D1 message retained its newline and two leading spaces. Two native message arrivals produced one agent dispatch; the second returned `reusedReceipt: true` and kept total sends at six. | This measured duplicate case and focused concurrency/crash tests are not a general exactly-once guarantee. Production retention, account scoping and concurrency need acceptance. |
| Stop and app-message scheduling | C1 survived panel closure. In 0.6.0, D1 survived an interrupted turn as pending; explicit recovery reused the ID and delayed native arrivals were deduplicated. | Acknowledgement is not a delivery deadline. Do not infer permanent loss from an intermediate pending check. C3’s earlier failure remains recorded and unresent. |
| Agent lifecycle | Panel prepare without sending; separate Alpha/Beta sessions; exact sends; task status/wait/cancel; uncertainty guard; environment/End invalidation. | Fixtures only. Full readiness delays, live account changes and task-only agents are not established. |
| MCP refresh and use | The actual model discovered an added tool, used a revised required argument, and refused a removed tool through stable discovery/call operations. Removed invocation caused zero remote calls. | Addition was triggered in the panel; schema revision/removal used a local fixture control after inspector timeouts. This is not full UI acceptance of every refresh button. |
| Individual native tool schemas | Notifications did not refresh model function definitions in measured runs. Isolated host disable/enable rebuilt them; MCP/config reload alone did not. | No panel-accessible API for that host action was established. Do not promise each remote tool becomes a separate native function automatically. |
| Native composer | Public draft-write request was acknowledged. User reported the original DRAFT-CHECK text remained once after two clicks. | No verified draft-read API, arbitrary draft preservation, prefix replacement, automatic re-addressing or Switch agent band. Revised MCP-request draft has not had full native-composer acceptance. |
| App and styling | Real MCP App tools, resource reads, fullscreen, direct actions, job progress/cancel, shared UI/model chat identity and host CSS variables worked. Neutral panel colors were visually observed. | Live light/dark switching, accessibility, rich content and persistent launcher discovery remain open. Footer placement is not required. |
| Packaging/update | Probe 0.5.0 records the packaged dependency and content hash, captures immutable panel HTML, checks panel/server identity before dispatch and refuses changed contents under an installed version. Actual isolated Codex install/update/MCP reload/resume/removal passed. Live 0.5.0 and 0.6.0 tests observed matching installed/server/panel identities and retained sessions; 0.6.0 activated after a user plugin toggle. | Installation alone initially left the existing chat on its old server while advertising the new resource. The exact later desktop activation trigger was not observed. Supported MCP reload adopted the package in the isolated backend; this is separate from individual native-schema refresh. |

The earlier blocking-hook reply was not visible in native chat. The nonblocking hook passed an isolated scripted-model test, but the panel's live app message did not carry that hook result. Neither is the production panel reply mechanism. The later shell fallback is also excluded from the successful native MCP acceptance claim.

Evidence: [live 0.6.0 Stop/recovery, duplicates and recall](../experiments/codex-host-probe/results/desktop-live-v6.json), [live 0.5.0 activation, queue and recall checks](../experiments/codex-host-probe/results/desktop-live-v5.json), [revised native-send and recall trace](../experiments/codex-host-probe/results/native-relay-live-v4.json), [live MCP refresh tests](../experiments/codex-host-probe/results/desktop-v3-checks.json), [earlier panel/agent checks](../experiments/codex-host-probe/results/desktop-v2-checks.json), [isolated context/catalog checks](../experiments/codex-host-probe/results/context-refresh-v3.json), [0.5.0 runtime checks](../experiments/codex-host-probe/results/runtime-v5.json), [upgrade sequence](../experiments/codex-host-probe/results/update-v5.json), [desktop install versus activation](../experiments/codex-host-probe/results/desktop-install-v5.json), and [detailed results](codex-host-probe-results.md).

## Claude parity inventory

The reference is the inspected local Claude **0.4.18** source and documentation, not an assumption that the communication probe covers the whole application. Its package pins devtools **0.3.1**. The historical live native relay used **0.3.0**; the current Codex workspace independently moved to **0.3.1**. The 0.5.0/0.6.0 build and live fixture checks exercise that package. Real-service production parity remains untested.

| Area | Reference behavior to retain | Codex work still missing |
| --- | --- | --- |
| Home and common navigation | Home, Code, Projects, Agents, Tools; account/environment header; next steps, current checkout, recent operations; Settings and Activity. | Production views and shared state. Probe has only Agents, MCP tools and Host checks. |
| Settings and account | Existing machine-session login/status/renewal/sign-out; backend, repositories folder, environment and diagnostics; usable defaults without saving. | Real integration and lifecycle tests; preserve existing configuration and avoid writing on startup. Codex's own account/provider settings are outside this work. |
| Agents | Search/details, Markdown, icons and reduced motion, provider/model/thinking defaults, preparation/progress/cancel, independent conversations, New conversation, task-only agents, owned tasks and uncertain-delivery recovery. | Production controls, pagination, real readiness/auth, late-result isolation, persistent scoped metadata and live task lifecycle. Only the fixture subset is verified. |
| Native conversation | Selected recipient, exact user text, readable attributed replies, continued conversation, End and agent switching. | Production MCP relay, request provenance and duplicate protection. Exact Claude prefix/read/retarget behavior and zero-inference command transcript remain host parity gaps. |
| Tools/MCP | Environment-scoped search/connect/remove, saved names, schemas, rich results, confirmation, stale-context refusal and usable state during backend blips. | Real endpoints; multiple connections and pagination; error/annotation handling; non-text content; degraded refresh and saved-name behavior. Stable discovery/call is the verified Codex model route. |
| Code | Remote/local repository lists, branch selection, safe setup, status, dependencies, SDK updates, instructions/skills, Docker build, devcontainer editing, previews, cancellation and safe local deletion. | Expose existing devtools operations through the panel and verify each workflow. Existing CLI support is not panel acceptance. |
| Projects | Environment-scoped project search, member branches, exact links, repeatable local setup, independent checkouts and preservation of edits. | Codex views over shared operations; verify a supported workspace-opening/attachment route separately from filesystem preparation. Automatic multi-folder attachment is unproven. |
| Deployments | Latest run for the actual checkout/branch, environment history, run/step timeline, cursor-paged logs, read-only model status and bounded polling while visible. | Shared public action coverage plus Codex UI/model integration; none was tested by this probe. |
| Activity and confirmations | Real progress, running/completed/failed/cancelled states, partial effects, review before mutation and explicit retry. | Production worker lifecycle, user-authored versus model-initiated authorization, stale confirmation invalidation and status restoration after panel close. A local cancel must not imply remote rollback. |
| Host actions | Folder picker/reveal, project/session opening and capability-aware controls. | Verify each supported Codex plugin API. Do not assume tools available to this assistant are APIs callable by an installed MCP App. Signed terminal and container-session launch are limitations in Claude too, not completed reference capabilities. |

Read-only references: [Claude feature coverage](../../mainsequence-claude-desktop/docs/claude-desktop.md), [agent contract](../../mainsequence-claude-desktop/docs/agents.md), [user-authored interaction decision](../../mainsequence-claude-desktop/docs/adr/0005-user-authored-agent-interactions.md), [0.4.18 saved MCP names](../../mainsequence-claude-desktop/docs/releases/0.4.18.md), and [reference dependency pin](../../mainsequence-claude-desktop/package.json).

## Implementation order and acceptance

### 1. Codex host and communication proof — core gate passed

The 0.5.0 build safeguards and 0.6.0 saved-request/receipt flow are implemented in the disposable test plugin. Twelve focused tests pass. Actual isolated Codex verifies installation, package adoption through supported reload, immutable resource identity, session preservation, receipt reuse, interruption and native context. These isolated checks do not substitute for desktop evidence.

The desktop now verifies matching installed/server/panel identities after a plugin toggle; queued delivery across panel closure; exact native replies; actual Stop followed by recovery of saved D1; one agent dispatch across two native message arrivals; and exact next-turn recall with zero tools. Total sends moved five to six on first delivery and stayed six through duplicate receipt reuse and recall. The old C3 request remains untouched. See [completed live acceptance](../experiments/codex-host-probe/results/desktop-live-v6.json).

Carry these proven rules into integration: save literal input and target before submission; pass a request ID to the model; persist dispatch uncertainty before remote execution; keep pending, delivered and uncertain states distinct; reuse successful receipts; never automatically replay an uncertain dispatch. Acknowledgement does not guarantee immediate processing, and an intermediate pending check does not prove permanent loss.

**Status:** the requested fixture communication gate is passed and production integration can begin. Remaining host acceptance includes supported launcher discovery, light/dark switching/accessibility, full revised-draft behavior, desktop restart/resume and compaction. The observed desktop toggle is a manual activation path; no plugin-accessible automatic reload API or scheduling latency guarantee is established. Footer placement remains optional.

### 2. Minimal Agents/Tools panel — implemented, authenticated desktop acceptance pending

The 0.4.1 build extends this repository's existing package with `src/panel-server.ts`, `src/hosts/discovery.ts`, a host-styled HTML panel and `manifests/codex/.mcp.json`. The existing hook/CLI remains intact. Build and archive checks include the MCP server, immutable UI resource and unchanged pinned devtools 0.3.1 package; no source checkout or runtime npm download is required.

The panel uses only the public `createDevTools`/`createNodeHost` API. Its three native MCP tools open account/environment status, discover agents/project MCPs and inspect a previously saved MCP's fresh schemas. It uses existing machine/environment sessions. No login, agent preparation, message send, connection mutation or project-tool call is exposed by these new tools. Environment selection is local to the panel; account/backend changes are rechecked before and after directory/catalog reads, and late UI results are discarded.

The original 0.4.1 panel avoided `mcp-list` because devtools 0.3.1 could backfill names. The 0.4.2 upgrade uses devtools 0.3.2's `mcp-list` with `readOnly: true` to show saved status and `mcp-discover` with `enrichNames: true` for repository labels. `mcp-tools` inspects an already saved connection and refuses unsaved ones. Domain requests use `expectedAccount`; backend response parsing and request/retry binding live in devtools. The plugin keeps host context and view invalidation, without reproducing the connection store or private transport. Tests verify unchanged saved files, no agent sends or project-tool calls, no credential leakage, stale-account rejection, pagination boundaries and dark/light host variables.

The local real-session status check selected `http://127.0.0.1:8000` and reported no saved session. This is a verified signed-out state, **not authenticated directory acceptance**. Local browser preview was blocked by the host's URL policy; simulated bridge/theme tests do not establish desktop rendering. See [panel behavior and validation](agents-tools-panel.md) for current evidence and remaining checks.

**Next acceptance:** activate the packaged 0.4.2 build in stock Codex, use the user's existing signed-in devtools backend, select an actual environment, list real agents/MCPs and inspect a known saved connection. Preserve existing settings/connections and verify native dark/light rendering. A backend/sign-in must be identified before claiming live authenticated results; do not copy credentials from Claude or alter its project.

**Then phase 3:** add an explicitly selected real agent exchange. Production request/receipt storage, provenance, permissions, atomic persistence, expiry, concurrent recovery and scoped invalidation belong to that phase; the disposable fixture ledger is not copied into production by this read-only work.

### 3. Ship the agent/native-context vertical slice

Implement production prepare/send/end, agent selection, independent session/task state and the verified native MCP relay. Carry the stable Codex chat ID, backend, account, environment and agent/session identity through every operation. Revalidate on execution and discard stale results after context changes.

Use the now-tested saved-request/receipt contract: capture literal input and target once, then let the model invoke that request ID. The live D1 test proves duplicate receipt reuse for the measured case. This remains Codex routing metadata in the plugin; devtools owns readiness and transport. Qualify production provenance, storage, expiry, context and concurrency before real-service acceptance. Do not restore the older model-reconstructed send arguments.

Keep devtools readiness, tasks and delivery semantics authoritative. Persist uncertainty before dispatch and refuse automatic replay after ambiguous completion. Test concurrent clicks, late replies, crashes, ended/stale sessions, renamed agents and new conversations. A single-send observation is not an exactly-once guarantee.

Separate a user-selected panel send from a model-proposed follow-up. Verify supported approval/elicitation or an explicit panel confirmation that displays target, environment and exact message. Do not assume tool annotations alone reproduce Claude's confirmations. Keep remote replies as external data, label their agent/environment, and support useful Markdown/rich results without interpreting their contents as commands.

Use explicit draft writes only with measured behavior. Do not promise automatic prefix preservation or implement it by guessing the native draft. Keep the panel composer available while that host gap remains. Agent-task status/bounded wait/cancel must use known owned tasks; neither host has established automatic wake-on-task-completion here.

**Exit:** real authorized message → visible native reply → later-turn recall, exact input and original attribution, no automatic resend, separate agents/chats, task lifecycle and context-change tests. Repeat after supported resume and exercise long-result/compaction limits separately.

### 4. Ship Tools with fresh schemas and retained state

Expose the existing devtools discover/list/connect/tools/call/disconnect operations through stable Codex MCP tools and the panel. Fetch current schemas before a call and revalidate at dispatch. Preserve release identity and environment scoping; disconnected or stale tools must fail before remote execution.

Adopt shared saved connection names instead of rebuilding Claude's name-resolution code. Keep last successful display/catalog information with an explicit stale/unavailable state during refresh failures; this must not bypass devtools' fresh permission or call validation. Verify multiple connections, pagination, changing arguments, removal, denied reads, transient backend outages and unchanged working connections.

Preserve MCP text, structured data, images and resource links through the Codex-supported content contract. Replace stale success displays on errors. Test confirmations for write operations and partial-effect handling; never automatically replay an uncertain call.

**Exit:** model discovers and calls added/revised tools in the same chat using the stable interface; removed tools are refused; real rich/error content and degraded refresh pass. Individually advertised function schemas remain a documented host difference unless a supported automatic refresh path is later proven.

### 5. Complete the remaining screens over devtools

Build Home/Settings/Activity first as shared UI infrastructure, then Code and Projects. Follow the reference capability inventory, including disabled-with-reason controls, real progress and deliberate previews/confirmations. Use Codex typography, colors, radii and theme changes; no replacement brand-blue theme. Test keyboard navigation, narrow panels and reduced-motion behavior for icons.

Reuse shared repository/project mutations, locks, cancellation and edit-preservation rules. Preparing project checkouts does not prove that Codex attached them or changed its working directory. Verify folder/session/attachment actions only through supported host contracts. Where unavailable, expose the prepared result and an explicit limitation rather than claiming full parity.

Add deployments after the public shared action coverage is resolved. Render run/step state, logs and a read-only model result in Codex. Poll only the relevant visible active views and stop on close/context change/completion; deployment polling is separate from automatically messaging agents.

**Exit:** every reference row above has a tested Codex implementation or an explicitly documented host limitation. Real repository, project and deployment workflows are still outstanding.

### 6. Release and parity acceptance

Run the existing dependency-boundary, package and host checks plus meaningful regressions for the new routes. Use versioned immutable artifacts and UI resources, verify the installed build actually running, then exercise clean install and upgrade with saved sessions/connections. Keep fixture evidence distinct from approved real-service acceptance.

The release checklist must include native reply/context, composer behavior, MCP updates and errors, account/environment invalidation, confirmations, task cancellation, panel/chat lifecycle, repository edits, project attachment and all remaining screens. Native resume and compaction must not be advertised as permanent memory.

**Exit:** functionality matrix closed with evidence; remaining host differences stated in user-facing terms. Do not label an adapted native relay or stable MCP dispatcher as exact host-API parity.

## Upstream and unification review — 2026-10-22

The original source review below identified targeted additions to **the existing devtools package**. Its first increment is now implemented in devtools 0.3.2 and consumed by Codex 0.4.2. Claude and VS Code remain unchanged. Items 3–5 remain planned; no new repository, UI framework or desktop adapter layer was introduced.

**Implemented:** one bounded environment loader with compatible action result shapes; public typed discovery results; optional account-bound MCP/Projects requests using the shared session (also adopted by agents with the built-in session); `mcp-list` with `readOnly: true`; optional bounded discovery-name enrichment. Codex now consumes these contracts, retains its own view/context guards, and shows saved connections without changing the store. The legacy listing/backfill behavior remains available to existing callers.

**Release state:** devtools source is on `codex/shared-discovery`, based on verified `v0.3.1` / `0f78f9b`. Codex pins the locally packed 0.3.2 bytes through its existing verified-archive workflow. The registry returned no 0.3.2 release during this work. Publish devtools and verify registry integrity before releasing Codex; no package or marketplace publication has occurred.

**Validation:** 124 devtools tests and 30 Codex tests pass, including both complete release/package checks. An isolated stock Codex backend registers the three production panel tools, reads the versioned resource metadata and refuses stale context, with zero model turns and zero MainSequence requests. The release archives and [upgrade evidence](../artifacts/discovery-upgrade-results.json) record the exact dependency integrity. This is not authenticated live-service or desktop-rendering acceptance; the user's installed 0.4.1 plugin was not replaced.

### Baseline and capabilities already shared

At review time, Codex 0.4.1 and Claude 0.4.18 both pinned devtools **0.3.1**, while the local devtools repository (`../codex-plugin`, despite its directory name) was on the older `codex/opencode-v2-adapter`, commit `8f35e9d`, version **0.3.0**. The review therefore used the installed 0.3.1 package. Implementation fetched and verified the release source, preserved the older branch, and started `codex/shared-discovery` from `v0.3.1`. Findings below describe that baseline; items 1–2 are now implemented.

The VS Code manifest pins **0.2.8** and already consumes public devtools session, repository, project and dispatcher APIs. Its current working changes are outside this task. Version alignment needs its own compatibility checks, not a blind bump of every consumer.

Devtools already owns authentication/renewal, machine session storage, repository clients, project/filesystem operations, agent readiness/send/tasks and MCP connection/catalog/call transport. Saved MCP names already exist in 0.3.1. These are reuse points, not new extraction projects. Codex's new [discovery module](../src/hosts/discovery.ts) calls the public dispatcher; it has no independent MainSequence HTTP client.

### 1. Shared discovery contracts and scope checks — first upstream increment

Three related gaps affect the production Agents/Tools panel now:

- **Environment listing is duplicated inside devtools.** `mcp-environments` and `OrganizationProjectClient.environments()` call the same endpoint but implement different pagination, duplicate handling and projections. The MCP route advances by 100 and deduplicates rows; the project route advances by the returned row count and rejects duplicates. Unify the internal loader and validation while preserving both public action names and their compatible result shapes, including the MCP production-environment flag.
- **Account preconditions are inconsistent.** Agent actions accept `expectedAccount`; the public MCP request does not. Codex consequently rechecks backend/account before and after each scoped directory/catalog read. Provide a common backend/account/environment precondition for shared operations, bound to the session used for execution. Keep permission checks authoritative at the backend. Before/after UI checks alone are not an atomic guarantee for future mutations.
- **Dispatcher results are insufficiently typed.** `ActionResult.data` is `unknown`, even though several individual domain models already exist. Add public result interfaces or an action-to-result type map, particularly for MCP discovery, saved connections and catalogs. Normalize backend data in devtools. Codex should still validate its MCP inputs and own presentation limits; it should not reproduce backend response parsing in every screen.

Keep Codex's opaque panel context IDs, expiry, selected-item allowlists, late-result rejection and chat identity here. Those are host interaction state, not shared domain APIs. Do not upstream `createDiscovery()` wholesale.

**Acceptance:** short/empty/duplicate environment pages have one documented behavior; existing action consumers remain compatible; an account/backend change cannot silently retarget an operation; cancellation and refresh failures are covered; typed results compile in a small consumer fixture. Use injected transports, not live credentials.

Evidence in the consumed package: `dist/shared/mcp.js` (`mcp-environments`, lines 264–289), `organizationProjects.js` (`environments`, lines 60–73), `agents.js` (account preconditions), `mcp.d.ts` and `models.d.ts`. Codex compensating logic is in [discovery.ts](../src/hosts/discovery.ts).

### 2. Read-only saved MCP listing and discovery names — same initial workstream

In devtools 0.3.1, `mcp-list` calls `backfill()`, which may write missing labels to the saved connection store. The production panel deliberately avoids this action to preserve its no-connection-writes contract. A read-only UI needs to distinguish available and already connected MCPs without parsing the private store or triggering a migration.

Add an explicit no-write listing option or separate read operation; retain the current legacy behavior for existing callers. Separate metadata persistence from inspection through an explicit refresh/migration operation. Network reads and normal session renewal are distinct from changing saved connection metadata.

Claude also still enriches **discovery** results through [claudeMcpNames.ts](../../mainsequence-claude-desktop/src/hosts/claudeMcpNames.ts): it resolves repository branches with bounded parallel requests and tolerates unavailable optional names. Put that domain enrichment in devtools when adding it for Codex. Do not copy the Claude wrapper or recreate saved-name support that already exists.

**Acceptance:** read-only listing leaves the saved connection file byte-identical, preserves corrupt stores, respects backend/environment scope and never adds/removes a connection. Optional name lookup failures do not hide usable endpoints; cancellation still propagates. Existing connect/list consumers retain their behavior.

Evidence: consumed `dist/shared/mcp.js`, `backfill()` at lines 223–250 and `mcp-list` at lines 331–333; [current panel policy](agents-tools-panel.md).

### 3. Neutral workspace preparation — before Codex Projects

The issue is broader than a Claude launch URL in the return value: devtools 0.3.1 workspace setup **writes `CLAUDE.md`**, generates `claude://code/new`, and returns a summary telling Claude to attach the checkouts. These are concrete host assumptions inside shared operations.

Add a neutral preparation contract returning workspace paths, project/environment identity and repository/branch membership. Keep checkout safety, repeatability and filesystem policy in devtools. Instruction-file generation, opening the host and attaching folders belong in each host project.

Leaving Claude unchanged requires an additive migration: the new neutral route must avoid Claude files/URLs, while the existing entrypoint remains compatible temporarily. Deprecate that legacy behavior; removal requires a separately coordinated consumer migration. Do not introduce new Claude-specific code in Codex, overwrite user instruction files or claim that filesystem preparation means Codex has attached the workspace.

**Acceptance:** neutral setup emits no Claude instructions or launch URL, preserves existing repository edits/branches, remains repeatable and cancels without claiming rollback. Existing consumers retain their current contract. Codex opening/attachment needs separate stock-host acceptance.

Evidence: consumed `dist/shared/organizationProjectWorkspace.js`, lines 286–298, its public return type and `actions.js` summary; [Claude's current consumer](../../mainsequence-claude-desktop/src/hosts/claudeProjectActions.ts).

### 4. Deployment reads — before implementing a second client

[claudeDeployments.ts](../../mainsequence-claude-desktop/src/hosts/claudeDeployments.ts) currently owns backend endpoint calls, UUID/pagination validation, history/run/log projections and restricted-or-unavailable run handling. It already uses the shared session service, but the consumed devtools package exposes no equivalent deployment client/actions.

Introduce additive host-neutral deployment APIs and result types in devtools, using these behavior cases as the reference. Include history filtering, run/step state, cursor-paged logs, cancellation and bounded public data. Keep Claude's error wrapper and UI separate; Codex owns its timeline, selection, polling cadence and native tool presentation. Claude can adopt the shared API independently later; its source does not need changing to make it available to Codex.

**Acceptance:** permissions/unavailable runs, malformed pages, cursor validation, cancellation and bounded results are tested in devtools; Codex adds only its own view/model integration tests. Do not expose credentials or imply a hidden run exists.

### 5. Authenticated agent assets — useful when adding agent detail parity

[claudeAgentIcons.ts](../../mainsequence-claude-desktop/src/hosts/claudeAgentIcons.ts) adapts binary icon responses to JSON inside the shared session transport. It also validates canonical platform paths, allowed media types, sizes and account/environment scope. This domain portion is reusable as a narrow agent-assets client or bounded authenticated binary-read facility in devtools.

Keep Claude's SVG wrapper, native markup budget and resizing/rendering code in Claude. Codex must render its own icons with its theme and reduced-motion behavior. Do not upstream the whole image module or create a shared renderer.

**Acceptance:** foreign/noncanonical URLs are refused, size/content-type bounds and aborts work, no credentials reach the panel, and account changes invalidate asset reads. Each host tests its own rendering separately.

### Boundaries and implementation order

| Keep in devtools | Keep in the host projects |
| --- | --- |
| Authenticated requests, domain scope/validation, typed data, pagination, agent/task transport, project MCP semantics, workspace preparation, deployment and asset reads. | Native components/themes, composer integration, MCP App bridge, tool descriptions, host approval UI, selected-view state, polling lifecycle, installation and activation. |
| Shared operation failures and remote delivery semantics. | Codex request provenance, chat routing, native queue/Stop recovery, pending requests and receipt presentation. |

Do not move the disposable probe ledger into devtools. Its measured duplicate protection is not a cross-client exactly-once guarantee. If cross-client retry guarantees become a requirement, investigate the backend idempotency contract first; this review did not inspect backend implementation. The existing agent transport already supports the demonstrated native relay without a new shared orchestration layer.

Updated sequence:

1. Finish authenticated desktop acceptance of the already-built 0.4.1 panel using existing sessions. This does not require the proposed upstream changes.
2. **Implemented locally:** matched the devtools 0.3.1 source baseline and built the focused discovery increment, including names. Existing callers retain compatible action names and legacy listing behavior; new scope/read-only options are explicit.
3. **Integrated locally; publication pending:** Codex 0.4.2 pins devtools 0.3.2 and consumes the new APIs. Publish the verified devtools archive first, confirm registry integrity, then release/activate Codex and validate real discovery. Do not automatically update Claude or VS Code.
4. Build production agent/native-context delivery in Codex over existing devtools transport, with host-specific durable requests and receipts. This can proceed independently of deployment or workspace work.
5. Add neutral workspace preparation before Projects, deployment APIs before Deployments, and shared asset reads when adding agent detail/icons. Reuse backend-facing contract tests; retain separate host acceptance tests.

No new repository, custom Codex or Claude refactor is required. The earlier next-step statement that phase 2 still needed implementation is superseded: the panel is built; authenticated desktop acceptance and production agent delivery remain. D1 and C3 remain historical evidence, never requests to replay.

## CRM connection incident: 0.7.2 / devtools 0.3.6

The reported generic `API_ERROR` did not establish a broken login or missing contact.
The CRM catalog and live reads succeeded with the existing shared account. The plugin
was discarding the remote tool's error result and uncertain-effects warning. Devtools
now distinguishes `MCP_TOOL_ERROR` from API/transport errors; Codex preserves the
original sanitized content and structured result in native tool output and panel errors.
An error never triggers an automatic replay, and authentication changes still invalidate
the scoped view.

Timing a read-only settings call identified ten profile reads in one account-bound MCP
action (about 26 seconds). Devtools now verifies remotely at entry and completion, and
rereads shared credentials between protocol messages. A changed access token is verified
before continuing; a different account or a mid-verification switch fails closed. The
live repeat made two profile reads. Total latency was 59.6 seconds before and 63.9 seconds
on that repeat because the remote CRM call increased from 19.5 to 41.3 seconds. This is
evidence of reduced client overhead, **not** a claim that server latency is resolved.

Verification completed:

- 146 devtools tests, 49 plugin tests, type checks and detached package checks pass.
- Stock Codex 0.163.0-alpha.10.2 registered all 16 tools and rejected stale context.
- Two fresh instances of the installed 0.7.2 MCP server reused the shared login and saved
  Production CRM connection, each loading 70 fresh schemas. A deliberately nonexistent
  contact returned `MCP_TOOL_ERROR` plus the original `not_found`; a separate settings
  read returned `ok`. Each test issued one read-only tool call. No CRM records changed.
- Local evidence: `artifacts/crm-wire-0.7.2.json`, `artifacts/crm-fix-host-0.7.2.log`,
  `artifacts/crm-fix-release-0.7.2.log`; devtools timings and tests are in its
  `artifacts/crm-connection-{before,after}.jsonl` and `artifacts/crm-fix-release-0.3.6.log`.

0.7.2 is installed locally and activation was requested. The last native desktop call
still identified 0.7.1 / devtools 0.3.5 and reported an environment-load failure; it is
not evidence about the fixed server. Native activation and the same native CRM read
remain to be verified. The fresh-client acceptance above does not substitute for that.
The original failed contact's underlying error cannot be recovered from its discarded
response. CRM server latency remains a separate investigation.

Next parity acceptance: after activating the fixed native server, finish a new real
task-mode message, native Stop/recovery and context recall, followed by successful
disposable workspace mutations. Do not resend historical requests or the failed
container-write job. Devtools remains the shared head; Claude and its dependency are
unchanged. Neither local development package was published.

## MCP overhead and connection status: 0.7.3–0.7.4 / devtools 0.3.7

The repeated setup is now owned and avoided in devtools. A bounded in-memory cache
holds verified release metadata, a release grant and schemas for at most 60 seconds,
never beyond credential expiry. The Codex host supplies one opaque cache handle to
its per-request dispatchers. Each request retains its own AbortSignal. Account or
saved-connection changes, expiry, disconnect and transport failure invalidate reuse.
Unknown credential lifetimes are not cached. Tool results are never cached, and no
tool invocation is automatically replayed, including after cancellation.

The conversational skill now prefers native tools. Starting a separate CLI process
for each action discards connection reuse; the runner remains a fallback.

Live read-only measurements from the **installed** 0.7.3 server and existing shared
login/Production CRM connection:

| Operation | HTTP requests | Total | HTTP response time | Local overhead |
| --- | ---: | ---: | ---: | ---: |
| Prepared contact lookup (known nonexistent test UID) | 1 | 15,341 ms | 15,161 ms | 180 ms |
| Explicit warm schema refresh | 1 | 749 ms | 557 ms | 192 ms |
| Prepared settings read | 1 | 18,924 ms | 18,734 ms | 190 ms |

The contact lookup preserved CRM's `not_found`. The settings read returned CRM's
`internal_error` in a successful HTTP response; its expected-`ok` acceptance assertion
failed. This is recorded separately from the verified one-request transport path;
the server error is not fixed or hidden by the cache. No call was replayed.

Initial setup is still required: that fresh process used 4 requests for account and
environments, 2 for an account-bound saved-connections view and 7 for the cold schema
read. The one-request result applies to a prepared connection, not a fresh workflow.
Remote CRM latency remains visible and is not claimed to be fixed.

Native desktop verification after the user's reload confirmed **0.7.3 / 0.3.7**,
verified shared login, both environments, the saved CRM and 70 schemas. A bounded
contact list and a real single-contact read both returned `ok` in native tool output.
The single-contact call took 15,394 ms. No contact data was written to test artifacts.
Evidence: `artifacts/crm-cache-wire-0.7.3.json`, its log and HTTP trace,
`artifacts/crm-native-0.7.3.json`, `artifacts/mcp-cache-host-0.7.3.log`.

The user's grey-dot report exposed a separate UI defect: the account marker always
inherited muted text colour. The live panel did contain development and Production,
but had no selection. Production was selected successfully in the actual panel.
**0.7.4** uses Codex's `--color-text-success` for a verified account, accessible
connection labels, explicit empty/error states and a wider environment selector.
It restores a valid current-chat environment or the last choice for that verified
account/backend. Unknown or revoked selections are never silently substituted.
Receipt loading no longer delays account/environment usability. The rendered preview
confirmed the green indicator and Production surviving a page reload.

155 devtools tests and 52 Codex plugin tests pass, including cache invalidation,
Stop without replay, fresh schema retrieval, account-scoped selection restoration,
error state rendering, type checks and isolated package checks. 0.7.4 is installed
locally with devtools 0.3.7. The last native call still reported 0.7.3; activation of
the new UI and final native colour verification remain pending the requested reload.
Claude remains untouched; neither package was published in this change.

The attached Django logs describe a separate OAuth connection: GET `/mcp` is rejected
by the stateless POST-only route, and `/auth/mcp/token/` rejects an expired/revoked
OAuth refresh token (`invalid_grant`). Codex still has an enabled `main_sequence`
connection at the matching central URL. The new plugin's release-exchange/POST
transport does not use that OAuth token endpoint. No permission bypass or automatic
reauthorization was introduced.

## Removed installation directory: 0.7.5 / devtools 0.3.8

The user's `crm_mcp_diagnosis_2026-10-23.json` identified a distinct local
lifecycle failure. Codex's installer had removed version 0.7.3 while old server
processes still used that directory as their cwd. MCP dispatch evaluated
`process.cwd()` before resolving even an explicitly supplied backend. An OS cwd
lookup then threw `ENOENT/uv_cwd`, hidden by the generic `INTERNAL_ERROR` boundary.
Account status did not consult cwd, explaining how a valid shared login could
coexist with an empty, failed environment directory. A cached cwd can also mask
this failure temporarily; one later native 0.7.3 open still returned two environments.

Implemented in the shared head, devtools 0.3.8:

- MCP requests with an explicit backend or `MAINSEQUENCE_ENDPOINT` never consult cwd.
- Implicit project lookup retains `.env` precedence. If that directory is gone,
  return `CURRENT_DIRECTORY_UNAVAILABLE` with recovery guidance; do not silently
  choose a different backend or replay a request.
- CLI parsing consults cwd only for an action that needs an implicit project path.
  Help, account commands, explicit MCP backends and explicit project paths survive.
- A subprocess regression deletes its real cwd, clears Node's cached cwd and checks
  the exact failure/recovery paths using a fake session and zero network traffic.

The Codex 0.7.5 host captures package resources at startup, then uses the existing
home directory as its stable process cwd. It never treats its package directory
or home directory as a user repository. Home's Code action opens the repository
list; local operations require a selected folder. The detached package test now
removes the entire installation while its process is alive and verifies tools,
immutable panel HTML and settings still work. The 0.7.4 green account indicator,
Codex theme variables and account-scoped environment selection are retained.

Validation: 156 devtools tests and 52 plugin tests pass, including detached npm
consumers. Stock Codex 0.163.0-alpha.10.2 discovers all 16 native tools and the
0.7.5 panel in an isolated profile and rejects a stale context. Live shared-session
acceptance is recorded separately in `artifacts/update-lifecycle-live-0.7.5.json`;
that test removes only a disposable package copy, with no remote writes. Native
activation and visual acceptance must be recorded separately from these tests.

The diagnostic's metadata HTTP 500 is independently attributed to a Cloud SQL
proxy/database connection closing. That evidence does not prove the earlier
Task-specific failure has the same cause. No backend restart, credential change,
CRM mutation, Claude edit or custom Codex build is part of this lifecycle repair.

Live acceptance completed successfully on 2026-10-23 (local time), using the
existing shared login and backend. After deleting the disposable package directory,
the same server verified the account and loaded `development` and `Production`,
7 Production agents, the one saved CRM connection, all 70 CRM schemas and 41 local
repositories. Settings and the immutable panel resource also survived. There were
zero remote writes. This proves the repaired lifecycle with a real account;
it does not by itself prove that an already-running desktop server has reloaded.

Installation: the existing `mainsequence@mainsequence-local` now contains 0.7.5
with bundled devtools 0.3.8; installed server, panel, core actions and build metadata
match the verified artifact. The last call from this desktop chat still reported
0.7.3, so the user was asked to toggle the plugin once. Final native green-indicator
and environment-selector visual verification remains pending that host activation.
The fix is installed locally; these versions have not been published to npm.

## Direct OAuth request burst — 2026-10-23

The user's second Django log excerpt contains 38 HTTP requests over 12 seconds,
including seven GET /mcp 405 responses and four rejected OAuth refreshes. Ngrok's
request inspector identifies `codex-mcp-client/0.163.0-alpha.10.2`; desktop logs at
the corresponding times report `reauthenticationRequired` for direct configured
servers `main_sequence` and `crm`. These are separate from the plugin's shared
machine-session POST transport.

At inspection, both direct servers already had `enabled = false` in the user's
Codex configuration. The last rejected OAuth retry in the backend log was
2026-10-22T22:03:56.829149Z. At 22:18:02Z, the previous ten minutes contained zero
GET /mcp requests and zero /auth/mcp/token/ requests. The burst had stopped. No
config change, process termination, backend call or Claude change was needed in
this investigation. Evidence: `artifacts/backend-request-storm-2026-10-23.json`.

Native activation confirmed after the user's reload: this chat reports MainSequence
0.7.5 / devtools 0.3.8, verifies the shared machine account, returns both environments
and discovers 7 Production agents. Native settings confirm the stable working
directory is the home directory and `pluginWorkspace` is null. The permitted MCP
panel inspector currently lists no expanded app, so visual confirmation of the green
indicator and populated selector awaits expansion of the newest app card.
Evidence: `artifacts/native-activation-0.7.5.json`.

Expanded-panel verification completed for the reported UI defects: the visible Codex
MCP App panel reports a connected account; its indicator's computed color exactly
matches the host's `--color-text-success`, `rgb(64, 201, 119)`. The environment
selector is enabled, contains both development and Production, and has Production
selected. These checks used live DOM/computed CSS, not the local preview.

Screenshot capture timed out on the visible panel and reset the permitted inspector;
a subsequent DOM call also timed out. The last captured agent-list state was loading,
so full list rendering is not claimed. Native discovery has separately returned
7 agents, and backend directory/icon requests completed with HTTP 200. No additional
reload, code change or credentials change was needed for the green-dot/selector check.

## Cross-panel connection sharing — 2026-10-23

The actual expanded 0.7.5 Codex panel was inspected successfully: all seven Production agents rendered, including their model details and seven Talk buttons. Search and Refresh were enabled. This completes the previously missing live agent-list rendering check. Evidence: `artifacts/native-agent-list-0.7.5.json`. Screenshot capture still times out; the evidence is from the permitted live DOM inspector.

The per-chat process architecture did not share its HTTP cache across chats. Devtools 0.3.9 now owns an opt-in per-user shared transport and session-renewal coordinator. Codex 0.7.6 passes both to every session-backed panel service. Account/environment scoping and conversation receipts remain separate. The plugin no longer serializes directory reads behind background icon work. Explicit Refresh and MCP schema reload invalidate shared cached reads.

Verified: 163 core tests and 53 plugin tests pass. Twenty independent packaged Codex servers share one owner and make seven cold fixture discovery requests total, with one agent-list read. An expired-session fixture with twenty processes performs one refresh and one credential-store write. Cancellation and worker failure do not replay mutations. The packaged plugin loads in stock Codex without a custom host.

A live intermediate twenty-client run using the existing machine login loaded seven agents and four icons through one owner and one upstream socket: thirteen cold HTTP requests total and zero additional requests for the repeated agent discovery. The first live run encountered account verification failures during renewal, prompting the shared session lease. The final run with the lease was blocked by the external local backend stopping: port 8000 refused connections and the Django web container was absent. That run is recorded as failed, not verified.

0.7.6 is installed locally. The current native chat still reported 0.7.5 immediately after installation, so activation and final native-panel verification are pending the requested plugin toggle and backend availability. Claude remains untouched. These versions have not been published.

## Local backend activation and CRM renewal — 2026-10-23

Native activation of 0.7.6 / devtools 0.3.9 was confirmed. The shared setting now
selects the owner's `http://local-backend:8000` alias. The Mac's hosts file and
resolver map it to `127.0.0.1`; the earlier workstation resolution is no longer
current. The normal shared login for this exact backend now verifies successfully.

The alias exposed a backend configuration defect: REST account/environment reads
succeeded, but MCP rejected `Host: local-backend:8000` with HTTP 421. With explicit
owner approval, the backend's existing MCP Host allowlist gained that exact
authority. Three focused boundary tests pass, including rejection of other ports,
lookalike hosts and an unapproved Origin. Authentication remains required. The
running backend subsequently served all seven Production agents. This is separate
from the Codex plugin and needs no Codex reload. Backend issue
[#1178](https://github.com/Main-Sequence-Server-Side/tdag-django/issues/1178)
is fixed in local commit `127c96167` (not pushed).

A real connection setup then saved CRM successfully but returned `CONTEXT_CHANGED`
when its account-bound operation renewed the token before retaining its cache.
Devtools 0.3.10 now skips retaining that stale identity and lets its existing final
account verification decide success. It does not reuse the old grant or replay an
operation. A regression reproduces renewal during setup and verifies one refresh,
successful persistence, a later warm read and one business dispatch. Existing
account-change and cancellation protections still pass. Codex 0.7.7 pins this fix.
Release checks pass: 164 devtools tests and 53 plugin tests, plus isolated packages.

Final live sharing acceptance with 20 packaged 0.7.7 chat processes passed against
the real shared login: all clients saw the same two environments, seven agents and
four icons. They joined the SAME service instance used by native Codex, with 23
connected clients including existing desktop chats. The measured run made 13
upstream requests total, coalesced 247 reads, and used 80 cached responses. Repeating
agent discovery caused zero additional upstream requests. The service had three
sockets across the platform and CRM origins; its bound is two per origin, not two
across every service. Evidence: `artifacts/shared-panels-live-0.7.7.json`.

Real CRM acceptance on the packaged fix loaded 70 schemas, listed 41 tasks and read
one task detail. Each business read made exactly ONE upstream request, with no
repeated discovery or initialization and zero business writes. However, those two
reads still took 37.2 and 10.1 seconds. Django separately logged a 30-second refresh
failure with a database connection closing through `host.docker.internal:15432`.
This does not prove the database caused every slow CRM call; upstream latency
remains unresolved. Evidence: `artifacts/crm-read-live-0.7.7.json`.

Native activation is now verified: this chat and the expanded panel both report
0.7.7 / devtools 0.3.10 and the same shared transport instance as the twenty-client
acceptance test. The actual Codex panel renders all seven agents and seven Talk
buttons, enabled Search/Refresh controls, and both environments with Production
selected. Its connected-account indicator matches Codex's success color exactly:
`rgb(64, 201, 119)`. This is live DOM/computed-CSS evidence; screenshot capture was
not verified. Evidence: `artifacts/native-agent-list-0.7.7.json`.

Native CRM reads now pass too: task listing returned 41 tasks, task detail
succeeded, contact listing returned 206 contacts, and contact detail succeeded.
The consecutive contact list/detail reads made exactly one upstream request each,
with no repeated setup. They still took 12.7 and 13.6 seconds respectively; this
does not resolve the upstream latency. Earlier native task listing took 55 seconds.
Read-only database probes subsequently connected through both the configured host
route and the Docker service route in about 600 ms, with SELECT 1 around 200 ms.
Django also recorded intermittent database connection failures and an 86.9-second
token refresh, so a healthy spot check does not establish backend reliability.
Evidence: `artifacts/native-crm-read-0.7.7.json`.

The misleading MCP off switch was traced to Codex's name matching: it removes
underscores when matching configured servers to plugin server names. The obsolete
disabled standalone `main_sequence` therefore matched the running plugin's
`mainsequence` entry. Only that obsolete disabled configuration section was removed,
with its non-secret values backed up locally. The plugin remains enabled; the old
standalone CRM OAuth server remains disabled. The native settings page itself was
not visually rechecked after removal because it is outside the permitted inspector.

The package-removal lifecycle test also passes for 0.7.7: an already-running server
continues account, environment, agent, saved CRM/catalog, workspace and panel-resource
reads after its disposable installation directory is removed. Evidence:
`artifacts/update-lifecycle-live-0.7.7.json`.

Claude remains unchanged and no custom Codex was built. No pending CRM task/contact
updates were executed. These package versions have not been published. Remaining
work is backend latency/reliability, tracked in
[#1177](https://github.com/Main-Sequence-Server-Side/tdag-django/issues/1177),
and the separately documented host limitations;
agent-list rendering, native activation and shared discovery are verified.

## Eliminate separate icon requests — 2026-10-23

The user correctly identified an unused platform capability: `agent.list`,
`agent.search` and `agent.get` already support `include_icons: true`. Version 0.7.7
instead read the Command Center agent directory again and fetched each icon URL.
Connection sharing reduced duplication across panels but did not remove this
unnecessary work. The earlier sharing result was not evidence that the request
set itself was minimal.

Devtools 0.3.11 adds `includeIcons` to agent list/detail requests and projects
bounded `command_center_icon.idle` bytes into host-ready images and reduced-motion
stills. Missing or malformed data yields a placeholder with no image-fetch fallback.
Its legacy asset API also uses the inline MCP contract. Codex 0.7.8 consumes images
from the original directory/search/detail response; it never starts a separate
assets request. Legacy `view: assets` calls from old panel HTML return an empty
result without backend work. The user's shared login and Claude are unchanged.

Verified: 165 devtools tests and 54 plugin tests pass, including package isolation.
The twenty-process packaged fixture renders inline image data through one owner:
six total cold HTTP requests (account, environments, MCP initialize/notification,
catalog and agent list), one agent-list read, zero Command Center directory/icon
requests, and at most two sockets to the fixture origin. Warm discovery and the
idle interval add zero requests. The actual panel script test renders the returned
image without requesting assets. The concurrent renewal fixture now writes its
synthetic credential file atomically, matching the real credential-store behavior;
production credential handling is unchanged.

A bounded live check used one packaged process and one directory read, rather than
running another live concurrency test. It returned seven Production agents and four
inline icons through the existing shared transport. Directory work took 7.1 seconds
and four upstream requests including MCP setup; legacy assets added zero requests.
Evidence: `artifacts/inline-icons-live-0.7.8.json`. The native chat also reports
0.7.8 / devtools 0.3.11 with the same transport owner; no further activation toggle
is needed. All three expanded native panels are now verified through the permitted
DOM inspector: seven agents, four fully loaded inline images, three placeholders,
both environments, and the green connected indicator using Codex's success color.
Each panel's visible runtime diagnostics reports 0.7.8 / 0.3.11 and the exact same
shared connection service, `4835ec21-5e87-40a7-952a-6a45b821ab21`.
Evidence: `artifacts/inline-icons-native-0.7.8.json`.

The live 60-second idle observation counted one upstream request while another
chat process joined the shared service. That global counter cannot attribute the
request to a panel, so this is not recorded as a zero-traffic live test. Zero idle
traffic and cross-process request coalescing are verified by the isolated fixture
above. No extra live load test was run against the user's working backend.
These are local installed packages, not published releases. This fix makes no claim
to resolve the separate database-connection failures tracked in backend #1177.

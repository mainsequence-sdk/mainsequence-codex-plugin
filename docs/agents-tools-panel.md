# MainSequence Codex plugin — panel and Claude parity

Version **0.7.1**, with shared devtools **0.3.5**, implements the MainSequence panel's
workflows in stock Codex. Claude is a read-only behavior/layout reference; its source
and dependency stay unchanged. This is the real plugin, not a host probe.

## Current capability matrix

| Surface | Implemented behavior |
| --- | --- |
| Header/navigation | MainSequence emblem, shared account, environment, Activity, Settings; Home/Code/Projects/Agents/Tools; compact rows and grouped details; host theme variables, neutral fallbacks and reduced-motion icons |
| Agents | Search/pages, real icons, defaults, descriptions, skills/examples; Talk prepares a stable session without sending; new conversations; drafts survive browsing; direct messages and task mode |
| Native context/recovery | Immutable request saved before native submission, at-most-once dispatch, durable receipts, same-ID recovery, uncertain sends blocked; native MCP results and labelled replies remain conversation context |
| Agent tasks | Accepted task receipt, get/wait/cancel, continue an owned saved task, outputs in native context; no task read/recovery resends the original message |
| Tools | Saved connections, Add MCP, connect/disconnect review, fresh schemas, explicit JSON tool-call review; catalog cache survives refresh failure; stable model-facing discovery/call tools |
| Code | Remote/local search, branch selection, setup with optional install; folder/type, status/resolve/SDK; sync/install/SDK update and preview; instructions/skills and preview/sync; environment cleanup; Docker build preview; devcontainer preview/write; local deletion preview and explicit confirmation |
| Projects | Search/pages, branch counts, descriptions, repository/branch links; local setup/update with Codex AGENTS.md; progress, cancellation, partial-effect reporting and explicit native workspace handoff |
| Deployments | Environment/branch history, pages, run/workflow stages, related runs, durations, errors, active-run polling, stage logs, log filtering/cursors; read-only |
| Settings | Existing shared account, browser login, connection check, renewal, explicit shared sign-out; repositories folder/backend/Command Center settings; diagnostics and local scan |
| Activity | Agent receipts/tasks plus accepted workspace operations, progress, explicit cancellation and results; accepted workspace work survives panel close/native Stop while the server remains alive |

## Stock Codex differences

### What the plugin exposes automatically

Enabling MainSequence registers the plugin's bundled `mainsequence` MCP server and
its 16 integration tools (15 model-visible and one app-only submission acknowledgement),
plus one `ms_<tool>_<hash>` tool for every tool of every saved project MCP connection,
named and bound exactly as the Claude Desktop plugin names and binds them. Those tools
use the shared devtools session. The plugin does not mirror the central platform `/mcp`
catalog as individual Codex functions. Saved connections do not become separate native
MCP configuration entries. The registered project tools come from devtools' shared
project-tool catalog (`project-tool-catalog.json` beside `mcp-connections.json`, the same
file, names, schemas and result shape the Claude Desktop plugin uses; devtools ADR 0004)
that `tools/list` answers from at once; one chat's server refreshes it in the background
when it is older than 15 minutes or after a connection or account change, and sends
`tools/list_changed`. The
`tools/list_changed` observation below describes the host's measured registration
behavior: a connection saved in the current chat is registered for the next chat, and is
usable immediately through `mainsequence_tools` / `mainsequence_call_tool`.

These are host-integration differences, not reasons to omit domain functionality:

- **Native composer/footer extensions:** no exposed equivalent to Claude's custom
  footer slot, persistent selected-agent band above the native input, or interception
  of arbitrary native drafts. Codex uses the MCP App panel and its supported native
  draft/send bridge. The MainSequence opener can live where Codex supports MCP Apps.
- **External assistant bubbles without a model turn:** the panel cannot append arbitrary
  assistant transcript entries. Saved replies return as native MCP results and Codex
  presents them. They stay in context, with a Codex inference turn.
- **Dynamic top-level project tool registration:** measured stock-host behavior refreshes
  server status after `tools/list_changed`, but does not rebuild model function schemas
  until a host plugin reload or a new chat. Project tools registered from the catalog
  cache are therefore those known when the chat's server started; fresh tools remain
  usable immediately through the stable `mainsequence_tools` / `mainsequence_call_tool`
  interface.
- **Native workspace/terminal controls:** the MCP App bridge exposes no native folder
  picker, automatic multi-root session attachment, signed-terminal environment injection,
  or start-in-devcontainer API. Folder paths, repository preparation, opening the OS
  folder and explicit native workspace handoff are implemented. The handoff is a native
  message, not proof that Codex attached every checkout. Runtime executable overrides
  belong to Codex's launch configuration, not to the running panel.

Workspace operations are retained for the server lifetime; they are not replayed after
server restart. Agent requests/receipts remain durable across restart. Native Stop does
not imply remote cancellation or rollback. A platform reconciliation receipt for ambiguous
message sends is still unavailable; the client blocks resend rather than claiming
end-to-end distributed exactly-once delivery.

## Use

Open MainSequence and expand its app card. Choose an environment. **Talk** prepares the
agent without an introductory send. Examples only fill a draft. **Send in Codex** saves
an immutable request before queuing its native relay; **Draft** prepares the native input.
Use **Messages and recovery** on the same request after interruption. **Activity** offers
owned task controls and workspace progress. Mutating workspace and MCP controls show the
selected target and explicit review; destructive operations require a fresh core preview.

## Boundaries

| MCP tool | Public devtools operations |
| --- | --- |
| `mainsequence_open` | `auth-status`, verified `auth-status`, `mcp-environments` |
| `mainsequence_discover` | `agents-list`, or `mcp-discover` with `enrichNames: true` plus `mcp-list` with `readOnly: true`; all use `expectedAccount` |
| `mainsequence_tools` | Fresh `mcp-tools` for a discovered or saved release, using `expectedAccount` |
| `mainsequence_view` | Agent details/assets, saved connections, projects, repository discovery and shared preferences |
| `mainsequence_connection` | Explicit scoped `mcp-add` / `mcp-remove` |
| `mainsequence_call_tool` | Explicit `mcp-call`, with fresh catalog/access checks in devtools |
| `mainsequence_agent_prepare` | Durable shared agent session preparation without an introductory message |
| `mainsequence_stage_message` | Durable immutable request staging, bound to native chat/account/environment |
| `mainsequence_agent_request` | Same-ID delivery or cancellation before dispatch |
| `mainsequence_agent_status` | Saved request/receipt list, get and wait; no sending |
| `mainsequence_agent_task` | Owned saved-task get, wait and cancellation |
| `mainsequence_submission` | App-only native submission acknowledgement bookkeeping; no remote dispatch |
| `mainsequence_workspace` | Scoped repository/SDK/local status, previews and public deployment reads |
| `mainsequence_action` | Reviewed allowlisted devtools repository/project operations |
| `mainsequence_operations` | Host-owned accepted-operation status and cancellation |
| `mainsequence_settings` | Public shared preferences and existing shared-session login/renewal/sign-out |

The discovery tools are model- and app-accessible and return useful structured results without a UI. Their arguments are allowlisted; they do not accept arbitrary devtools actions. Context identifiers are short-lived server memory, not agent session IDs or a new persistent settings store. Restarting the MCP process requires refreshing the panel.

The 0.4.1 panel avoided `mcp-list` because devtools 0.3.1 could backfill saved names during inspection. Devtools 0.3.2 adds explicit read-only listing, which the panel now uses without migrating or writing connections. Public typed results replace host-side backend response parsing. Devtools binds the actual request/retry credentials to the selected account; Codex retains local backend-change checks, context IDs and late-view rejection. No private package imports or independent MainSequence HTTP client are introduced.

The UI uses the public MCP Apps JSON-RPC bridge. All colors, typography and radii prefer host CSS variables, with neutral light/dark fallbacks. Data is rendered as text, including external descriptions. The UI has no external fetches, scripts or fonts and declares empty connection/resource CSP lists. Its resource URI includes a build hash; the server captures immutable HTML at startup and the panel checks its identity before using results.

The existing developer-command hook and conversational MCP skill retain their behavior. Those explicit workflows retain their existing mutations; directory and schema inspection stay read-only. Agent messaging uses the separate durable workflow below. Historical fixture tests are development evidence only; no probe plugin is required or shipped.

## Original 0.4.1 validation recorded on 2026-10-22

- 26 tests passed: existing hook/CLI regression tests, production dependency/package boundaries, and ten panel tests.
- The actual public devtools package parsed fixture account/environment/agent/MCP responses and acquired a fixture release credential for schema inspection. Saved connection bytes were unchanged; no credential persistence, agent sends or project tool invocations occurred. Credential values were absent from panel results.
- Detached packaged MCP server started outside the checkout, exposed exactly three read-only tools, returned immutable UI after a file changed, and refused unknown tools, arguments and resources.
- Simulated UI bridge verified explicit environment selection, literal text rendering, stale-result rejection, account invalidation and dark/light variable changes. It did not perform any native message or draft operation.
- The stock Codex backend (`0.163.0-alpha.10.2`) installed the package in an isolated profile, discovered all three tools and the versioned app resource, and refused a stale context. No model turn or MainSequence request occurred. This confirms host registration, not desktop rendering.
- The real local session check selected `http://127.0.0.1:8000` and returned **not signed in**, with no environment queries. No authenticated live agent/MCP directory is claimed.
- Browser preview of a local file was blocked by Codex's URL policy. Desktop rendering and accessibility acceptance remain unverified; bridge tests are not screenshots or live-host evidence.

Run `npm test`, `npm run release:check` and `node scripts/verify-panel-host.mjs` for code/package checks. The release check unpacks the npm archive, verifies the MCP/resource contract and runs the existing hook/CLI without `node_modules` or the source checkout. No publish occurs.

## 0.4.2 / devtools 0.3.2 upgrade

The additional regression cases exercise shared environment pagination, account changes
during identity verification and reads, safe same-account 401 retries, refusal to retry as
another account, and refresh races that preserve another process's saved account. MCP
tests cover byte-identical legacy-store reads, corrupt/missing stores, discovery-name
enrichment and no connection mutation. Codex tests cover the new public request options,
saved/unsaved badges and inspection controls, unchanged connection bytes and backend
invalidation. Verified account identity takes precedence over stale saved display metadata.
Existing native theme behavior remains covered by the bridge tests. Devtools passes 124
tests and its standalone package checks; Codex's suite contains 30 tests. The upgrade also
passes isolated stock Codex registration, without a model turn or MainSequence request.

The release lock pins the exact devtools archive. The release sequence publishes devtools
first and verifies registry integrity before building and publishing the Codex consumer.
The local-archive helper described in the README supports development before publication.
Desktop activation, rendering and authenticated live discovery remain separate acceptance steps.

## Live desktop acceptance — 2026-10-22

Devtools 0.3.2 and the real Codex plugin 0.4.2 are published. The plugin is enabled in stock Codex and the public marketplace points to 0.4.2.

With the user's approval, the existing shared MainSequence machine login was restored through Chrome for `http://127.0.0.1:8000`. The installed Codex plugin and Claude's devtools dependency read the same Keychain service, backend account and credential pair. No Claude code was changed and no separate Codex credential store was introduced. The earlier invalid saved record matched a synthetic SDK test token; its writer was not established.

The active native MCP tools verified the account with the backend and completed these live reads:

| Environment | Agents | MCP releases |
| --- | ---: | ---: |
| development | 2 | 2 |
| Production | 7 | 5 |

The already-saved Production CRM connection returned 70 tool schemas through `mainsequence_tools`. No agent messages or project tool calls were sent, and no connections were added. Directory runtime states were `unknown`; discovery does not establish runtime readiness.

The expanded desktop panel displayed the verified shared account, accepted development environment selection and rendered both Agents and Tools directories. Unsaved MCPs correctly disabled schema inspection. Actual host CSS variables supplied Codex's neutral dark colors and system font. Screenshots and sanitized receipts are recorded in `artifacts/live-desktop-acceptance-0.4.2.json`, `artifacts/live-agents-codex-0.4.2.jpg` and `artifacts/live-tools-codex-0.4.2.jpg`. Historical validation above remains the record of what was known at each earlier stage.

At the end of 0.4.2 acceptance, production messaging remained the next step. Live semantic search, pagination and agent runtime readiness were not claimed by that run. Claude remains independent and stock Codex remains the host.

## 0.5.0 / devtools 0.3.3: real agent messaging

Choose **Message**, enter text, and select **Send in Codex** or **Draft in Codex**.
The panel first saves an immutable request. It then submits a native message containing
only the saved request ID and relay instructions. Codex calls `mainsequence_agent_request`
and quotes the returned `receipt.message`, labelled with the agent name. The MCP result
and native assistant reply become conversation context. This uses stock Codex's supported
MCP App bridge; it does not insert an arbitrary external assistant identity.

| Tool | Behavior |
| --- | --- |
| `mainsequence_stage_message` | Validate the current discovered agent/account/chat and persist the immutable request; no remote send |
| `mainsequence_agent_request` | Deliver the saved request once, or cancel an unsent request |
| `mainsequence_agent_status` | Read-only list/get/wait and exact saved receipts; no send approval needed |
| `mainsequence_submission` | App-only acknowledgement bookkeeping; never evidence of remote delivery |

The host obtains chat identity from Codex's `threadId`/`thread_id` tool metadata.
Tool arguments cannot supply it. A global panel without a chat can browse but cannot
message. Records are scoped by host, chat, backend and verified shared account. Stage
requires the current discovery page; recovery does not need its expired context ID.

**Stop and recovery:** Stop interrupts the native waiter. Accepted work continues in
the MCP server and saves its receipt. Open **Messages and recovery** and recover the
original request. Duplicate clicks, queued duplicate native arrivals and repeated
recovery return the same work or receipt, without dispatching again. Reopening a panel
only lists saved state; it never sends automatically. Pending messages can be cancelled
and expire after 24 hours. Failed preparation with zero dispatches can be explicitly
recovered under the same ID; errors after dispatch are never retried. Delivery does not cancel the remote agent when Codex stops.

The shared devtools `AgentDelivery` service owns state, locks, readiness and dispatch.
After a process dies during preparation, the stable session handle can resume. After a
process dies during send, or a transport response is ambiguous, status is **uncertain**
and resend is blocked. The platform has no authoritative direct-message reconciliation
receipt, so this is at-most-once client dispatch, not a distributed exactly-once promise.
A new request must never be used to bypass an uncertain one. The initial implementation
supports direct-message agents; background task controls remain a later parity step.

Storage is private local application data under `MainSequenceCLI/agent-delivery-v1`.
It contains messages and receipts, never credentials. Receipt history is retained;
256 saved requests per conversation or the storage size bound refuses new writes rather
than deleting deduplication history. UI colors, typography and controls still use Codex
variables and neutral fallbacks. Claude and its pinned dependency are unchanged.

Automated coverage includes Stop before/during dispatch, simultaneous recovery,
process death, missing/corrupt storage, account/chat isolation, stale selections,
double clicks, native submission order and safe receipt rendering. The opt-in
`scripts/verify-agent-messaging-live.mjs ENVIRONMENT_UUID AGENT_UUID` uses a real agent
and the existing shared login in an isolated stock Codex app-server. Its local scripted
model transport inspects next-turn context; it is distinct from desktop click acceptance
or a free-running model's recall. It sends one harmless echo, invokes native Stop,
recovers the same ID twice and verifies the native transcript and subsequent model input.
Development archives are not published automatically; publish devtools first, verify its
registry integrity, then release the Codex consumer.

### Validation recorded on 2026-10-22

- Devtools: **135 tests passed**. Codex plugin: **36 tests passed**, plus archive
  installation and detached execution checks. Claude code and dependency pins were not changed.
- Stock Codex `0.163.0-alpha.10.2` registers seven production MCP tools, including a
  separate read-only status tool. Calls cannot override the host chat identity, and
  the read-only tool refuses delivery actions.
- The production package, an isolated stock Codex profile and a local test backend
  passed native `turn/interrupt`, same-ID recovery twice, exactly one recorded A2A
  send, exact receipt reuse, native transcript persistence, and next-turn context
  inspection without another tool call. This is a deterministic transport test,
  not a claim of live-agent success or desktop button acceptance.
- The real development **MetaTables Analyst** passed the same native Stop/recovery
  flow using the existing shared localhost account. It returned the requested echo;
  two subsequent recovery turns reused its exact saved receipt with `sendAttempts: 1`.
  The reply appeared in the native assistant transcript and the following turn's
  model input, with zero recall tool calls. MainSequence ran the real agent; the
  isolated stock Codex host used a deterministic local model transport to inspect
  context. This verifies real delivery and native context, not desktop button clicks
  or unrestricted model recall.
- The real shared account successfully authenticated, discovered agents, created the
  Tutorial Helper session and survived native Stop. Its request reached the agent,
  whose canonical logs recorded `agent.model.failed` with HTTP 400 followed by an
  A2A HTTP 502. The request is `uncertain` and remains blocked from resend. No direct
  Message receipt lookup is advertised by the platform. The failure is not a login
  failure, and no fallback credentials or transport were introduced.
- The local 0.5.0 build is installed and now active in the existing desktop chat.
  After the user's plugin toggle, the first call still reached 0.4.2 while reload
  completed. The subsequent call returned 0.5.0 / devtools 0.3.3 with messaging enabled,
  and the new native messaging tools appeared. Another restart was not needed.

Sanitized reports live in `artifacts/agent-messaging-live-*.json`; each distinguishes
`liveAgent: true` from the local test backend. The deterministic run ending in
`e19e8676-cae5-48ca-bf5e-de2264fa49a2` passed all six checks. The Tutorial Helper run
`b14f8a08-609c-43d1-b1ee-7c386b8f7999` records the live runtime failure separately.
The real MetaTables Analyst run `0a506f95-727b-45e6-b5c6-0b33a59f2aa6` passed all
five live delivery, recovery and context checks.
Run `node scripts/verify-agent-messaging-live.mjs --fixture` for the reproducible
host regression. Live mode requires explicit environment/agent IDs and sends a
harmless no-tools echo; an uncertain request must never be retried or replaced.

### Active desktop messaging acceptance

The real desktop panel verified the shared account, selected development, displayed
two agents, opened the MetaTables composer and accepted one **Send in Codex** click.
It saved request `f6eb8ea1-2a35-439f-8f7d-b5775eda42d0` before native submission; the
host acknowledged the queue entry. Development MCP discovery also returned two releases.
The active assistant delivered that same saved ID using the native MCP tool. The real
agent replied, and repeated native recovery returned the identical saved receipt with
`sendAttempts: 1`. Its exact reply was quoted in the native conversation.

The panel received Codex's `rgb(24, 24, 24)` dark background, white text and system font;
the inspected layout had no horizontal overflow. The inspector subsequently timed out,
so the final receipt screenshot and recovery-button click are not claimed. Native Stop
and next-turn context remain covered by the isolated stock-host test above; no desktop
Stop click was made in this acceptance run. This desktop chat's following queued turn
must reuse its saved receipt and must never dispatch another message.

`artifacts/live-desktop-messaging-0.5.0.json` records the actual desktop results separately
from the deterministic host harness. Publication remains a separate step.

## 0.6.0 layout and capability acceptance

The compact layout follows Claude's header, navigation, name/action rows, list-to-detail
navigation, connected-tools-first view and persistent agent selection. All UI chrome uses
Codex theme variables with neutral fallbacks; the brand mark is a monochrome derivative
of this repository's existing SVG. Real agent artwork is fetched through the new public
`createAgentAssets` devtools API, never through credentials exposed to the panel. Assets
are account/environment scoped, limited to canonical icon routes and bounded in size;
reduced motion uses the static PNG frame.

Regression coverage: devtools **139 tests**, Codex **41 tests**, plus both package checks.
New cases cover image bounds/origin/account changes, details and examples, persistent
drafts, connection reviews invalidated by navigation, and unknown-item execution refusal.
Existing native messaging, Stop/recovery and no-duplicate-send tests remain in place.
No additional live agent messages were sent for the visual redesign, and old uncertain
requests were not touched.

Read-only live acceptance uses the same shared localhost account: development exposes
2 agents, 2 MCP releases and 0 projects; Production exposes 7 agents, 5 releases and
14 projects. Both can read the account's 45 repositories. Agent icons, skills/examples,
project branches, saved connections and preferences were read through the production
package. `artifacts/design-live-acceptance-0.6.0.json` records individual results.
Visual acceptance uses the exact panel source in a local browser harness with a captured
read-only account snapshot and Codex theme variables. All mutations are disabled there;
this is not presented as native desktop activation evidence.

### Gaps recorded at 0.6.0 (superseded by the current matrix)

- Background task creation, progress, task cancellation and a new-agent-conversation control.
- Workspace setup/attachment and repository mutation controls, deployment management,
  Docker/devcontainer operations and editable shared settings in the panel.
- Native dock/composer replacement: stock Codex exposes an MCP App panel and native
  draft/send bridge, not Claude's host UI primitives. Agent replies still enter native
  conversation context through the verified durable MCP delivery path.

The existing head implementation of organization-project setup still contains a
Claude-specific attachment result/instruction path. That must become host-neutral before
Codex exposes it. This release does not copy Claude's adapter into Codex or modify Claude.
Development versions remain local until a separate release: publish devtools first,
verify its registry integrity, rebuild the Codex archive, then publish the consumer.

## 0.7.0 validation

The reference was inspected in the actual Claude Desktop MainSequence panel, including
its compact Code list and project controls. The updated Codex source is checked in a
read-only Chrome preview at side-panel widths; this is separate from native Codex
activation and rendering acceptance.

Shared devtools tests cover durable preparation, direct-message Stop/recovery, task
receipts/cancellation, account isolation, safe workspace settings writes and deployment
projection/redaction. Plugin tests cover native bridge order, stale selections, scoped
workspace actions, previews and accepted-operation cancellation. Package verification
runs the detached npm bundle without node_modules. The isolated stock Codex runtime
loads all 16 MCP tools and the immutable panel resource without a model turn.

Read-only live acceptance uses the existing shared login: development has 2 agents,
2 MCP releases and 0 projects; Production has 7 agents, 5 releases and 14 projects.
Both environments return repository/local discovery and deployment history; run/stage
and log reads succeed. The existing Production CRM MCP returns 70 schemas. No agent
message, connection mutation, repository setup or production tool invocation is performed
by this read-only check. See local `artifacts/design-live-acceptance-0.7.0.json` and
`artifacts/parity-host-0.7.0.log` for evidence. Local development archives are not published.

### Final package and desktop activation acceptance

The completed release checks passed **144 devtools tests and 44 plugin tests**, both
type checks and detached package verification. The installed production bundle matched
all 64 generated plugin files. The isolated stock host exposed all 16 tools and refused
stale context, without contacting MainSequence or running a model turn.

After the user's plugin toggle, this existing native desktop chat returned plugin
**0.7.0 / devtools 0.3.5**, build
`96b8527853e477a8c0604ab20bb05a67108f0c4f6ce38ca8bc5d44eecf28930d`.
The native MCP App displayed the new compact header/navigation, authenticated shared
account, environment selector and editable Settings view. Native settings and Production
deployment-history reads succeeded against localhost. The inspector then timed out
twice, so a complete native click-through and a final native screenshot are **not**
claimed. This is an inspection limit, not an unresolved plugin activation.

The existing delivered request `f6eb8ea1-2a35-439f-8f7d-b5775eda42d0` was read through
the new native server, without delivery or staging. It remained `delivered`, with
`sendAttempts: 1`, the same session and the exact receipt
`The blue fox found  seven stars.` The receipt was quoted again in this native chat.
This verifies persisted-receipt recovery after activation; it is not a new live Stop
test or a new task-mode dispatch. The earlier stock-host Stop/context acceptance and
the current deterministic regression tests supply those separate checks.

The read-only live suite completed 18 checks with zero failures. The final local
discovery check found 41 folders, 30 matched to current remote repositories. Browser
visual checks use the exact final HTML with a captured account snapshot and disabled
mutations: dark/light, 320/460-pixel widths, Home, Code/list/setup/maintenance,
Projects/list/detail, Agents, Tools with 70 CRM schemas, Settings and deployment
history/stages. They do not substitute for native host rendering evidence. Screenshots:
`artifacts/parity-0.7.0-agents-dark.png`,
`artifacts/parity-0.7.0-tools-dark.png` and
`artifacts/parity-0.7.0-settings-light-320.png`.

New workspace mutations and agent task controls have fixture/contract coverage; they
were not exercised against production resources during this visual acceptance. Workspace
jobs still have server-lifetime storage, while agent receipts have durable storage.
Claude's working tree and its devtools dependency remain unchanged. Neither development
version was published. `artifacts/parity-acceptance-0.7.0.json` separates these results.

## 0.7.1 live-test fixes

The next real desktop pass found that a dual-mode agent had no Task selector: Talk
always chose Message when both modes were supported. The composer now exposes the
advertised modes, preserves the draft when switching mode and keeps continued tasks
locked to Task. Continuing a saved task selects its saved environment before staging.
Read failures from workspace-entry buttons now appear in the panel, and opening a
workspace from Home selects the Code tab correctly.

All **47 plugin tests**, type checking, detached package validation and isolated stock
Codex registration pass. Shared devtools remains 0.3.5. The real 0.7.0 Code view loaded
local/remote repositories and checked a disposable local workspace; the CRM task-capable
session was prepared without a message. One container-write job failed during backend
verification; the target file was absent on inspection, and the operation was not
repeated. The later read succeeded with the same shared login. This is recorded as a
failed live check, not a successful write or a credential migration.

At this checkpoint 0.7.1 is installed locally and activation has been requested. Native
task submission/Stop/recovery and successful workspace mutations remain pending;
`artifacts/live-desktop-operations-0.7.0.json` records the checkpoint. Claude is unchanged.

### Update lifecycle (0.7.5)

The server captures its panel resources at startup and runs from a stable home
directory, so an update removing an older plugin cache does not break its existing
chat. Devtools 0.3.8 resolves explicitly selected MCP backends independently of cwd.
A missing directory needed for implicit project lookup returns
`CURRENT_DIRECTORY_UNAVAILABLE` with recovery guidance. The server's working
directory is diagnostic information only; Code actions use selected repositories.

The regression suite removes a running detached package and verifies its settings,
tool list and captured panel remain available. `scripts/verify-update-lifecycle-live.mjs`
checks account, environments, agents, saved CRM schemas and local discovery using
the existing shared session after removing only a disposable package copy.


## Inline icon correction — 0.7.8

The Agents directory, semantic search and detail request the platform's existing
`include_icons: true` through devtools `includeIcons: true`. Images and their
reduced-motion still frames are projected from `command_center_icon.idle` in that
same response. The panel does not request a second Command Center directory or
individual `/icon/` URLs. Missing or invalid inline images render the placeholder
without any image-fetch fallback. The legacy `view: assets` request remains a
network-free no-op for old panel HTML; reopen the current panel to render icons.

The shared devtools transport still coalesces the combined response across chat
processes. There is no periodic agent/icon refresh (until 0.7.10, below). Explicit Refresh
requests a fresh directory. No change is made to the shared login or Claude.

## Direct project tools, timeouts and distinct refusals — 0.7.8

Measured against the Production CRM release on 2026-10-23 with plain `fetch`: a cold
`mcp-call` took 53–71 s (release detail and exchange-launch about 2 s each, the
project's `initialize` 9 s to over 60 s, `tools/call crm_contacts_list` 39 s), a warm one
7–10 s. Codex's default `tool_timeout_sec` is 60 s, so the host failed the tool while the
server was still waiting; Claude Desktop runs the same devtools call with a 30-minute
budget and succeeds. Three changes follow from that comparison:

- `.mcp.json` sets `tool_timeout_sec: 300`. The server's own per-request limit is 290 s.
  In 0.7.8 the server gave project MCP requests (`mainsequence_tools`,
  `mainsequence_call_tool`, `mainsequence_connection` and the registered `ms_*` tools) a
  120 s HTTP budget per message instead of devtools' 60 s default; since 0.7.9 that budget
  is devtools' own default (`projectRequestTimeoutMs`), and a tool's advertised
  `_meta["mainsequence.ai/timeout-seconds/v1"]` is honoured up to 300 s.
- Saved project MCP tools are registered directly as `ms_<tool>_<hash>`
  (`src/hosts/toolCatalog.ts` in 0.7.8; devtools' shared project-tool registry since
  0.7.9, see below), with the same FNV-1a naming as the Claude plugin, so
  `ms_crm_contacts_list_183f8138` is the same tool in both hosts. A call forwards to
  `mcp-call` with the saved connection's backend, environment and release and returns the
  remote tool's own content and `structuredContent`, with `summary`, `error` and
  `effects` appended as in Claude. No `expectedAccount` snapshot is attached; devtools
  verifies the shared session for the connection's backend. The catalog cache holds
  schemas only, never credentials or results; one process refreshes at a time under a
  lock file; a connection whose catalog cannot be read keeps its earlier tools and is
  reported in `mainsequence_open` → `registeredTools.unavailable`. `mainsequence_tools`
  no longer discards the shared transport cache for every chat process.
- Every `INVALID_REQUEST` from the discovery layer now names the argument and what is
  accepted: a wrong `environmentUid` lists the account's environments; a release known
  in another environment names that environment; an unknown release says which read
  (`mainsequence_view connections` or `mainsequence_discover tools`) must come first; an
  omitted `arguments` object on `mainsequence_call_tool` is an empty object, as its
  schema says; release ids match regardless of case. `CONTEXT_CHANGED` carries its cause
  (`AUTH_REJECTED: The MCP endpoint returned HTTP 401.`) instead of a bare "refresh".

`MAINSEQUENCE_CODEX_TOOL_CATALOG=off` stops a server from reading or writing the
catalog on its own (the packaged test uses it); cached tools are still listed.

Live acceptance on 2026-10-23, Codex CLI 0.163.0, local marketplace install: a fresh
server's first `tools/list` returned the 16 plugin tools; its background refresh wrote
70 CRM schemas to the catalog and sent `tools/list_changed`; the next `tools/list`
returned 86 tools. In `codex exec` sessions the model found and called
`mcp__mainsequence__ms_crm_contacts_list_68ee6e71` directly through its code-mode tool and
answered with the contact's title and uid; attempts ran 20–35 s and were not cut off by
the host. Three earlier sessions failed on upstream errors only (`HTTP 503` and a reset
from the project gateway, `HTTP 500` from the development backend behind the
`local-backend` haproxy); a plain-fetch call made in the same minute as the successful
session also met one backend `HTTP 500`. Those errors now reach the model with their
status code instead of a generic "refresh" message.

## Shared project-tool registry — 0.7.9

The 0.7.8 comparison left two copies of the same five things in the Claude Desktop and
Codex plugins: the tool name, the definition, the result shape, the catalog refresh and the
state directory. devtools 0.3.12 owns them now (its ADR 0004, "Shared project-tool registry
for host plugins"), and this release consumes that API:

- `src/hosts/toolCatalog.ts` is gone. The server creates devtools'
  `createProjectToolCatalog({ dispatch, disabled, notify })`, lists `catalog.list()` after its
  own 16 tools, keeps `tools/list_changed`, `catalog.update()` after `mainsequence_tools`
  and `catalog.refresh(true)` after a connection or account change, and answers an `ms_*`
  call with `projectToolResult(mcp-call)`. Names, schemas, hints and results are the bytes
  devtools produces, so they are the Claude Desktop plugin's.
- The catalog file is `project-tool-catalog.json` beside `mcp-connections.json`, shared
  with the Claude Desktop plugin; a refresh by either host is visible to the other at its
  next listing. The 0.7.8 file, `codex-tool-catalog.json`, is left in place and unused; the
  first refresh writes the new one. A listing is scoped to the current account's backend,
  so connections another backend saved into the same file stay out of this chat's tools.
- devtools gives project MCP requests a 120 s budget of its own and honours a tool's
  advertised timeout up to 300 s; the server's 120 s override from 0.7.8 is removed.
  Error messages from devtools now name the endpoint, the request (`tools/call
  crm_contacts_list`) and the status, tell a timeout from a connection failure, and keep
  a JSON-RPC error's own message; the server passes them through unchanged.
- `tests/panel-tool-catalog.test.cjs` moved to devtools (`tests/project-tools.test.cjs`,
  with the frozen name vector `ms_crm_contacts_list_183f8138`); `panel-server.test.cjs`
  still proves the packaged server registers a cached connection's tool with devtools'
  name and schema.

Pins devtools 0.3.12, built from its registry archive (`npm ci --ignore-scripts`; the integrity in
`package-lock.json` and `build-info.json` is the registry's `dist.integrity`). `npm run
release:check`: 55 tests, release metadata, the standalone and npm archives, the npm archive
exercised as Codex installs it.

Live acceptance on 2026-10-23 with this build's packaged server over stdio
(`codex/dist/panel-server.js`, the shared machine session, backend `http://local-backend:8000`,
environment Production): `initialize` answered `mainsequence 0.7.9` with `tools.listChanged`. The
first `tools/list` returned 160 tools, the 16 plugin tools plus 144 project tools: before the
server has learned its backend from `auth-status`, the shared file's two scopes
(`http://127.0.0.1:8000`, written by the Claude Desktop plugin, and `http://local-backend:8000`)
are both listed. The background refresh learned the backend and sent `tools/list_changed` 0.5 s
later; the next `tools/list` returned 88 tools, the 72 CRM tools named for this backend
(`ms_crm_contacts_list_68ee6e71`, described `MainSequence crm [Production]: List CRM contacts
with bounded paging and filters.`). `tools/call ms_crm_contacts_list_68ee6e71` with
`page_size: 1` returned in 10.1 s with `isError` unset: two text blocks and `structuredContent`
`code: ok` with one contact of 212. In the same hour the Claude Desktop plugin 0.4.19 registered
the same release's tools from the same shared file under the `127.0.0.1:8000` names. The record
is the local `artifacts/live-acceptance-0.7.9.json`. The pre-backend listing of every scope is a
devtools follow-up: a fresh server's first list could be scoped to the configured backend.

Published on 2026-10-23 (UTC) from tag `v0.7.9` on main `9cddf65`, the merge of the acceptance
record above, by the release workflow (run 40032861384: `npm ci` from the registry devtools
archive, `release:check`, `npm publish --provenance` through trusted publishing). The registry
serves `@dev-mainsequence/codex-plugin@0.7.9` as `latest`, 70 files, integrity
`sha512-5EmHyWdb3V+DB8EJmKsfK/P8bvMP+2DO04ntwuuO7EqDwbIVo5DNCOJctJJAiQlHqdVKNgbFSoEMUKjHKKL0iA==`,
read from the registry after publishing (a local `npm pack` of the same files has another
integrity). The devtools marketplace entry was advanced from 0.4.2 to 0.7.9
(mainsequence-sdk/mainsequence-devtools#20, main `18cbfc8`). In an isolated `CODEX_HOME` with
the Codex CLI 0.163.0, `codex plugin marketplace add
https://github.com/mainsequence-sdk/mainsequence-devtools.git`, `codex plugin marketplace upgrade
mainsequence` and `codex plugin add mainsequence@mainsequence` installed `mainsequence@mainsequence`
0.7.9 from the npm package into `plugins/cache/mainsequence/mainsequence/0.7.9`, with the
manifest, `dist/panel-server.js`, `dist/runner.js`, hooks, skills and `.mcp.json` in place and
`build-info.json` naming devtools 0.3.12 by its registry integrity; `codex plugin list` reported
it installed and enabled. The owner's own Codex home (local `mainsequence-local` marketplace,
0.7.8 installed) was not touched; upgrading it is a user step: `codex plugin marketplace upgrade
mainsequence`, `codex plugin add mainsequence@mainsequence`, then review the hook and start a new
chat.

## Agent icons follow Command Center — 0.7.10

An icon changed in Command Center reached an open panel only after Refresh or a new app card:
the Agents list drew an agent's inline icon when it listed agents and nothing re-read the
directory while the list stayed on screen. (The Claude Desktop plugin had the same gap and fixed
it in its 0.4.20 with the per-agent icon route and entity tags; the Codex panel takes icons
inline from the directory, so it re-reads that instead.)

- While the Agents list or an agent's details stay on screen, the panel re-reads what it shows
  once a minute: the directory page (`mainsequence_discover`, same search and offset) for the
  list, the agent view for the details. The read carries no `refresh` flag: the shared
  transport keeps a directory read for 30 s, so a read a minute later is fresh without
  invalidating other panels' caches, unlike the Refresh button.
- Only a changed icon is redrawn, in place: the list, drafts and scroll position stay. A
  removed icon shows the placeholder; a failed re-read keeps the drawn icons and tries again at
  the next minute.
- The timer ends with the screen (another section, a detail or list change, environment
  change, teardown) and pauses after 240 re-reads until the screen is opened again. Nothing is
  stored; the inline icons live in the panel's memory as before.

Verification on 2026-10-24: `npm run release:check` from the registry devtools 0.3.12 archive,
56 tests (new: the panel UI test drives the minute timer through the vm harness and checks an
unchanged, changed, removed, restored and failed re-read, the detail view's re-read, the timer
ending on another section and on teardown, and that the Refresh button alone sends `refresh`),
release metadata, the standalone and npm archives, the npm archive exercised as Codex installs
it. Live acceptance with the built server over stdio and the server-stamped panel page driven
in a minimal DOM (Production, seven agents, the shared machine session): the list drew seven
icons; two minute re-reads each read the directory page without `refresh` (14–17 s per read
against the local backend, in the background), found no change and redrew nothing; the timer
ended when Tools was shown, came back on Agents and ended on teardown. No icon was changed in
Command Center during the run; the changed, removed and failed paths are the UI test's.
Published on 2026-10-24 from tag `v0.7.10` on main `b705951` by the release workflow (run
40082819471: `npm ci` from the registry devtools archive, `release:check`, `npm publish
--provenance` through trusted publishing). The registry serves `@dev-mainsequence/codex-plugin@0.7.10`
as `latest`, 70 files, integrity
`sha512-L23DWgVJ+YfplieeQhbmcjgU2N2h65Nc1EixFLs6AzaCaRW65uZxb1DtZn+CKX6AEPEdksh7kQfyZXHkL9sbJA==`,
read from the registry after publishing. The devtools marketplace entry was advanced from 0.7.9 to
0.7.10 (mainsequence-sdk/mainsequence-devtools#21, main `c857329`). In an isolated `CODEX_HOME`
with the Codex CLI 0.163.0, `codex plugin marketplace add
https://github.com/mainsequence-sdk/mainsequence-devtools.git`, `codex plugin marketplace upgrade
mainsequence` and `codex plugin add mainsequence@mainsequence` installed `mainsequence@mainsequence`
0.7.10 from the npm package, with the manifest, `dist/panel-server.js`, `dist/runner.js`, hooks,
skills and `.mcp.json` in place and `build-info.json` naming devtools 0.3.12 by its registry
integrity; `codex plugin list` reported it installed and enabled. The owner's own Codex home was not
touched; upgrading it is a user step (`codex plugin marketplace upgrade mainsequence`, `codex plugin
add mainsequence@mainsequence`, then review the hook and start a new chat).

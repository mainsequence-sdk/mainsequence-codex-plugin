# MainSequence for Codex: capabilities and host differences

The plugin implements the MainSequence panel's workflows in stock Codex. The Claude
Desktop plugin is a read-only behaviour and layout reference; its source and dependency
stay unchanged. No probe or custom Codex build is shipped.

## Capability matrix

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

## What the plugin exposes automatically

Enabling MainSequence registers the plugin's bundled `mainsequence` MCP server and its 16
integration tools (15 model-visible and one app-only submission acknowledgement), plus one
`ms_<tool>_<hash>` tool for every tool of every saved project MCP connection, named and
bound exactly as the Claude Desktop plugin names and binds them. Those tools use the
shared devtools session. The plugin does not mirror the central platform `/mcp` catalog as
individual Codex functions, and saved connections do not become separate native MCP
configuration entries.

The registered project tools come from devtools' shared project-tool catalog
(`project-tool-catalog.json` beside `mcp-connections.json`, the same file, names, schemas
and result shape the Claude Desktop plugin uses; devtools ADR 0004). `tools/list` answers
from it at once; one chat's server refreshes it in the background when it is older than 15
minutes or after a connection or account change, and sends `tools/list_changed`. A listing
is scoped to the current account's backend once the server has learned it. A call to an
`ms_*` tool forwards to `mcp-call` with the saved connection's backend, environment and
release and returns the remote tool's own content and `structuredContent`, with `summary`,
`error` and `effects` appended as in Claude. The catalog holds schemas only, never
credentials or results; one process refreshes at a time under a lock file; a connection
whose catalog cannot be read keeps its earlier tools and is reported in
`mainsequence_open` → `registeredTools.unavailable`.
`MAINSEQUENCE_CODEX_TOOL_CATALOG=off` stops a server from reading or writing the catalog on
its own (the packaged test uses it); cached tools are still listed.

Project MCP requests are slow when the project has scaled to zero: a first call to the
Production CRM measured 53–71 s, a warm one 7–10 s. `.mcp.json` therefore sets
`tool_timeout_sec: 300` (Codex's default is 60 s) and the server's own per-request limit is
290 s; devtools gives a project request 120 s and honours a tool's advertised
`_meta["mainsequence.ai/timeout-seconds/v1"]` up to 300 s. Error messages from devtools name
the endpoint, the request (`tools/call crm_contacts_list`) and the status, tell a timeout
from a connection failure, and keep a JSON-RPC error's own message; the server passes them
through unchanged. Every `INVALID_REQUEST` from the discovery layer names the argument and
what is accepted: a wrong `environmentUid` lists the account's environments; a release
known in another environment names that environment; an unknown release says which read
(`mainsequence_view connections` or `mainsequence_discover tools`) must come first; an
omitted `arguments` object on `mainsequence_call_tool` is an empty object; release ids match
regardless of case. `CONTEXT_CHANGED` carries its cause (`AUTH_REJECTED: The MCP endpoint
returned HTTP 401.`).

Agent icons come inline from the platform's agent directory (`include_icons: true`); the
panel does not request individual icon URLs, and a missing or invalid image renders the
placeholder. While the Agents list or an agent's details stay on screen, the panel re-reads
what it shows once a minute (the same directory page, or the agent view) so an icon changed
in Command Center is redrawn in place; the list, drafts and scroll position stay. The timer
ends with the screen and pauses after 240 re-reads until the screen is opened again.

The server captures its panel resources at startup and runs from a stable home directory,
so a plugin update that removes an older plugin cache does not break an existing chat.
Explicitly selected MCP backends resolve independently of the working directory; a missing
directory needed for an implicit project lookup returns `CURRENT_DIRECTORY_UNAVAILABLE`
with recovery guidance.

## Stock Codex differences

These are host-integration differences, not reasons to omit domain functionality:

- **Native composer/footer extensions:** no exposed equivalent to Claude's custom
  footer slot, persistent selected-agent band above the native input, or interception
  of arbitrary native drafts. Codex uses the MCP App panel and its supported native
  draft/send bridge. The MainSequence opener can live where Codex supports MCP Apps.
- **External assistant bubbles without a model turn:** the panel cannot append arbitrary
  assistant transcript entries. Saved replies return as native MCP results and Codex
  presents them. They stay in context, with a Codex inference turn.
- **Dynamic top-level project tool registration:** stock Codex refreshes server status
  after `tools/list_changed` but does not rebuild model function schemas until a host
  plugin reload or a new chat. Project tools registered from the catalog cache are
  therefore those known when the chat's server started; fresh tools remain usable
  immediately through the stable `mainsequence_tools` / `mainsequence_call_tool` interface.
- **Native workspace/terminal controls:** the MCP App bridge exposes no native folder
  picker, automatic multi-root session attachment, signed-terminal environment injection,
  or start-in-devcontainer API. Folder paths, repository preparation, opening the OS
  folder and explicit native workspace handoff are implemented. The handoff is a native
  message, not proof that Codex attached every checkout. Runtime executable overrides
  belong to Codex's launch configuration, not to the running panel.

Workspace operations are retained for the server lifetime; they are not replayed after
server restart. Agent requests and receipts remain durable across restart. Native Stop does
not imply remote cancellation or rollback. The platform offers no reconciliation receipt
for an ambiguous message send, so the client blocks resend rather than claiming end-to-end
exactly-once delivery.

## Use

Open MainSequence and expand its app card. Choose an environment. **Talk** prepares the
agent without an introductory send. Examples only fill a draft. **Send in Codex** saves
an immutable request before queuing its native relay; **Draft** prepares the native input.
Use **Messages and recovery** on the same request after interruption. **Activity** offers
owned task controls and workspace progress. Mutating workspace and MCP controls show the
selected target and explicit review; destructive operations require a fresh core preview.

Agent messaging in detail: the panel first saves an immutable request, then submits a
native message containing only the saved request ID and relay instructions. Codex calls
`mainsequence_agent_request` and quotes the returned `receipt.message`, labelled with the
agent name. The host obtains chat identity from Codex's thread metadata; tool arguments
cannot supply it, and a global panel without a chat can browse but cannot message. Records
are scoped by host, chat, backend and verified shared account and live in private local
application data under `MainSequenceCLI/agent-delivery-v1`, which holds messages and
receipts, never credentials. Pending messages can be cancelled and expire after 24 hours;
failed preparation with zero dispatches can be recovered under the same ID; errors after
dispatch are never retried; after a process dies during send, or a transport response is
ambiguous, the request is **uncertain** and resend is blocked. A new request must never be
used to bypass an uncertain one.

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

The discovery tools are model- and app-accessible and return useful structured results
without a UI. Their arguments are allowlisted; they do not accept arbitrary devtools
actions. Context identifiers are short-lived server memory, not agent session IDs or a new
persistent settings store. Restarting the MCP process requires refreshing the panel.

Saved connections are read with devtools' read-only listing, without migrating or writing
them. Public typed results replace host-side backend response parsing. Devtools binds the
actual request and retry credentials to the selected account; the plugin keeps local
backend-change checks, context IDs and late-view rejection. No private package imports or
independent MainSequence HTTP client exist in the plugin.

The UI uses the public MCP Apps JSON-RPC bridge. All colors, typography and radii prefer
host CSS variables, with neutral light/dark fallbacks. Data is rendered as text, including
external descriptions. The UI has no external fetches, scripts or fonts and declares empty
connection/resource CSP lists. Its resource URI includes a build hash; the server captures
immutable HTML at startup and the panel checks its identity before using results.

The developer-command hook and the conversational MCP skill keep their own behaviour.
Those explicit workflows retain their existing mutations; directory and schema inspection
stay read-only. Agent messaging uses the durable workflow above.

## Verification

`npm run release:check` type-checks, builds, runs the Node tests, checks release metadata,
the marketplace and the documentation, packs the standalone artifact and the npm archive,
and verifies the npm archive as Codex installs it, without `node_modules` or the source
checkout. `npm run verify:codex` and `npm run verify:codex:reload` run real app-server turns
against a counted offline model fixture in an isolated Codex home. Live acceptance against
a real backend is recorded in each release's pull request and GitHub release, not here.

## Linux credential-store diagnostics

[Codex issue #11](https://github.com/mainsequence-sdk/mainsequence-codex-plugin/issues/11)
has a launcher correction here and a shared diagnostic fix in
[devtools #24](https://github.com/mainsequence-sdk/mainsequence-devtools/issues/24).
The manifest forwards `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `DISPLAY` and
`WAYLAND_DISPLAY`. Only names are packaged; the host supplies their values.
Devtools owns classification and fixed safe messages. Discovery/native tools retain
its optional `error.reason`; no helper stderr or credential record is exposed.

The packaged regression checks open/sign-in failures for `SESSION_UNAVAILABLE`,
`LOCKED`, `SERVICE_UNAVAILABLE`, `ACCESS_DENIED` and `HELPER_FAILED`, then verifies the
same fixture machine session as the CLI when forwarding is present. A fake secret-tool,
isolated home and loopback backend keep real credentials untouched.
`node scripts/verify-linux-session-host.mjs` reproduces failure with the old allowlist
and success with the fixed allowlist through fresh native Codex hosts, with no model turns.
The release check passes all 58 tests and verifies standalone/npm packages.

The launcher fix was also reinstalled in the active Codex chat: after the user toggled
the plugin off and on, native open verified the existing machine session, loaded both
environments and showed the connected panel. No fresh sign-in was needed.

Both Codex and Claude pin the same checked upstream archive. Publish devtools first,
verify its registry integrity against the lockfile, then release the plugins. Until
publication, CI builds upstream's `codex/linux-session-errors` branch and checks the
exact archive integrity. The public marketplace keeps its published package pin.

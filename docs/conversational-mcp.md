# Conversational project MCP connections

With the plugin loaded and a usable MainSequence developer session, ask:

1. "Which internal MCPs are available?"
2. "Add metatable-mcp."
3. "Use it to list my tables."

Codex discovers the directory, saves your selection, reads that project's current tools and
invokes them through the bundled client. You do not need a slash command, settings edit or
restart between adding a project and using it. Saved selections work in later
conversations. When several releases share a name, select the intended release and
environment.

Connections are owned by the plugin. They do not create separate entries in Codex's native
MCP list. Installing or updating the plugin itself still follows the host's plugin
lifecycle.

Every saved connection's tools are also registered directly as `ms_<tool>_<hash>` tools
with the project's own schemas, the way the Claude Desktop plugin registers them, so "list
my contacts" is one tool call with no context or environment argument. The registration
comes from devtools' shared project-tool catalog (`project-tool-catalog.json` beside
`mcp-connections.json`, shared with the Claude Desktop plugin), refreshed in the
background; a connection saved in the current chat is registered from the next chat on,
and is usable at once through `mainsequence_tools` / `mainsequence_call_tool`. The plugin's
server allows Codex tool calls 300 seconds, because a cold project MCP can take more than
the host's 60-second default to answer.

## Runner and library

The conversational skill prefers the native `mainsequence_*` tools, which share a
persistent devtools connection cache. It opens account context once, reads saved
connections, inspects schemas, then calls the selected tool. The bundled runner is a
fallback when native tools are unavailable:

| Command | Result |
| --- | --- |
| `mcp-discover [--search TEXT] [--limit N] [--offset N]` | A page from `resource_release.mcp_endpoints`; no local mutation. |
| `mcp-add --uid RELEASE_UUID` | Verify connection and tool catalog, then remember it. |
| `mcp-list` | Saved metadata for the selected backend; no health claim. |
| `mcp-remove --uid RELEASE_UUID` | Forget one connection without logging out. |
| `mcp-tools --uid RELEASE_UUID` | Read the current tools and their input schemas. |
| `mcp-call --uid RELEASE_UUID --tool NAME [--arguments-file FILE]` | Invoke the selected tool once; preserve its structured/content result. |

Run commands with `node dist/runner.js`, or the installed `ms-devtools` command. All accept
`--backend URL` and `--json`. The JSON argument file contains the tool's argument object;
omission supplies an empty object. It is limited to 1 MB. No credentials are accepted as
command arguments.

The exported `createDevTools().dispatch()` accepts the same `mcp-*` actions through
`ActionRequest`; `mcp-call` uses `releaseUid`, `tool` and `arguments`. Hosts can inject
`mcpConnectionsPath` for their own local metadata location.

## Access and saved data

The plugin uses the existing developer machine session for central discovery and release
credential exchange. A short-lived credential for the selected FastAPI release
authenticates project requests; the platform login token never goes to the project
endpoint. Credentials are not persisted with connections or exposed in results. The
machine session renews privately.

If no developer session exists, use the MainSequence hosted login (**Settings → Sign in with
browser**, or `/ms login --backend URL`). A central Codex OAuth connection does not provide
that session. Browser sign-in may be necessary once; adding further project connections
reuses the developer session.

Connection metadata lives in `mcp-connections.json` beside the MainSequence CLI
configuration, separated by backend and release UID. The native process reuses verified
release metadata, a release grant and schemas for at most 60 seconds, bounded by credential
expiry; a prepared call sends only the business `tools/call` request, and an explicit
schema read fetches the current catalog. Shared login and saved connection changes, expiry
and transport failures invalidate the cache; each call keeps its own cancellation signal.
Credentials and results are never persisted in this cache. A changed endpoint requires an
explicit add again. Removing a connection does not revoke your login. Separate runner
processes perform fresh setup.

The release UID identifies a connection. `mcp-add` also reads the release's name, its
repository's name and its repository branch from the release directory and stores them
with the connection as `name`, `display_name` and `code_repository_branch_uid`, so
`mcp-list` labels a saved connection without a backend request; a connection saved
without them is completed by the first listing that can read those labels, and a label
that cannot be read is left out rather than making the MCP unavailable. Discovery rows
carry `name` and `code_repository_branch_uid` as the platform directory reports them.

Project tools enforce their ordinary permissions. The client adds no agent-specific
allowlist or exclusions.

## Failures and limits

Access denial, an unavailable release, or a corrupt connection file is reported without
deleting the saved connection or changing accounts. All project requests use the current
stateless Streamable HTTP profile. Stateful sessions, subscriptions, tasks and deprecated
SSE endpoints are unsupported.

A tool call is never retried automatically. A timeout, interrupted stream or cancellation
may follow a completed remote operation. If the result reports partial-or-uncertain
effects, check the operation's outcome before repeating it. A remote tool failure is
labelled `MCP_TOOL_ERROR`, distinct from an HTTP or protocol `API_ERROR`; the native tool
result and the panel preserve the original `content`, `structuredContent` and
uncertain-effects warning, so a CRM `not_found` or `forbidden` response is visible instead
of being discarded, with known authentication credentials redacted. Cold setup verifies
the shared account remotely; prepared calls check the selected credentials locally before
and after execution; server-side authorization still applies to every call.

See [ADR 0002](adr/0002-conversational-project-mcp-client.md) for the design and
authentication decision.

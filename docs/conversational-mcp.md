# Conversational project MCP connections

With the updated plugin loaded and a usable Main Sequence developer session, ask:

1. "Which internal MCPs are available?"
2. "Add metatable-mcp."
3. "Use it to list my tables."

Codex discovers the directory, saves your selection, reads that project's current tools and invokes them through the bundled client. You do not need a slash command, settings edit or restart between adding a project and using it. Saved selections work in later conversations. When multiple releases have the same name, select the intended release/Environment.

Connections are owned by the plugin. They do not create separate entries in Codex's native MCP list. Installing or updating the plugin itself still follows the host's plugin lifecycle.

Since plugin 0.7.8 every saved connection's tools are also registered directly as `ms_<tool>_<hash>` tools with the project's own schemas, the way the Claude Desktop plugin registers them, so "list my contacts" is one tool call with no contextId or environment argument. The registration comes from a catalog cache beside `mcp-connections.json` that is refreshed in the background; a connection saved in the current chat is registered from the next chat on, and is usable at once through `mainsequence_tools` / `mainsequence_call_tool`. The plugin's server also allows Codex tool calls 300 seconds, because a cold project MCP has taken more than the host's 60-second default to answer.

## Runner and library

The conversational skill prefers native `mainsequence_*` tools, which share a
persistent devtools connection cache. It opens account context once, reads saved
connections, inspects schemas, then calls the selected tool. The bundled runner is
a fallback when native tools are unavailable:

| Command | Result |
| --- | --- |
| mcp-discover [--search TEXT] [--limit N] [--offset N] | A page from resource_release.mcp_endpoints; no local mutation. |
| mcp-add --uid RELEASE_UUID | Verify connection and tool catalog, then remember it. |
| mcp-list | Saved metadata for the selected backend; no health claim. |
| mcp-remove --uid RELEASE_UUID | Forget one connection without logging out. |
| mcp-tools --uid RELEASE_UUID | Read the current tools and their input schemas. |
| mcp-call --uid RELEASE_UUID --tool NAME [--arguments-file FILE] | Invoke the selected tool once; preserve its structured/content result. |

Run commands with node dist/runner.js, or the installed ms-devtools command. All accept --backend URL and --json. The JSON argument file contains the tool's argument object; omission supplies an empty object. It is limited to 1 MB. No credentials are accepted as command arguments.

The exported createDevTools().dispatch() accepts the same mcp-* actions through ActionRequest; mcp-call uses releaseUid, tool and arguments. Hosts can inject mcpConnectionsPath for their own local metadata location. Existing session and HostServices options still apply.

## Access and saved data

The plugin uses the existing developer machine session for central discovery and release credential exchange. A short-lived credential for the selected FastAPI release authenticates project requests; the platform login token never goes to the project endpoint. Credentials are not persisted with connections or exposed in results. The normal machine session renews privately.

If no developer session exists, use the existing Main Sequence hosted login. A central Codex OAuth connection does not automatically provide that session. Browser sign-in may be necessary once; adding subsequent project connections reuses the developer session.

Connection metadata lives in mcp-connections.json beside the existing MainSequence CLI configuration, separated by backend and release UID. Since plugin 0.7.3 / devtools 0.3.7, the native process reuses verified release metadata, a release grant and schemas for at most 60 seconds, bounded by credential expiry. A prepared call sends only the business `tools/call` request. Explicit schema reads still fetch the current catalog. Shared login and saved connection changes, expiry and transport failures invalidate the cache; each call keeps its own cancellation signal. Credentials and results are never persisted in this cache. A changed endpoint requires an explicit add again. Removing a connection does not revoke your login. Separate runner processes perform fresh setup.

The release UID identifies a connection. Since devtools 0.3.1, mcp-add also reads the release's name, its repository's name and its repository branch from the release directory and stores them with the connection as `name`, `display_name` and `code_repository_branch_uid`, so mcp-list labels a saved connection without a backend request; a connection saved by an earlier version is completed by the first listing that can read those labels, and a label that cannot be read is left out rather than making the MCP unavailable. Adding a connection and reading or calling its tools work without the labels, and UID-based operations do not repeat discovery to obtain a name. Discovery rows carry `name` and `code_repository_branch_uid` as the platform directory reports them.

Project tools enforce their ordinary permissions. The client adds no agent-specific allowlist or exclusions.

## Failures and limits

Access denial, an unavailable release, or a corrupt connection file is reported without deleting the saved connection or changing accounts. All project requests use the current stateless Streamable HTTP profile. Stateful sessions, subscriptions, tasks and deprecated SSE endpoints are unsupported.

A tool call is never retried automatically. A timeout, interrupted stream or cancellation may follow a completed remote operation. If the result reports partial-or-uncertain effects, check the operation's outcome before repeating it. Tool errors retain their server result for diagnosis, with known authentication credentials redacted.

Since plugin 0.7.2 / devtools 0.3.6, a remote tool failure is labelled
`MCP_TOOL_ERROR`, distinct from an HTTP/protocol `API_ERROR`. The native tool result
and panel preserve the original `content`, `structuredContent` and uncertain-effects
warning. A CRM `not_found` or `forbidden` response is therefore visible instead of
being discarded. Cold setup verifies the shared account remotely. Prepared calls
check the selected credentials locally before and after execution; server-side
authorization still applies to every call.

## Validation and release boundary

The protocol, credential-isolation, saved-connection and packaged-client fixtures run in the devtools test suite, where the client lives; this repository's tests cover the skill, the hook and the packaged plugin. None of them access the user's credential store or invoke real project tools. The built plugin and npm archive include the conversational skill and the vendored client without runtime npm dependencies.

This source change does not publish a package, replace an immutable installed plugin version or establish live desktop end-to-end proof. A versioned plugin release/update and a read-only smoke test against a selected deployed MCP are the remaining rollout steps.

See [ADR 0002](adr/0002-conversational-project-mcp-client.md) for the approved design and authentication decision.

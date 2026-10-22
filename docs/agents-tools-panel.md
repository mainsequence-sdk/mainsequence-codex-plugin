# MainSequence Codex plugin — Agents and Tools panel

Version 0.4.2 contains a read-only MCP App. Devtools 0.3.2 remains the head: it owns backend selection, credentials, account binding, typed discovery results, environments, connection validation and MCP transport. This upgrade changes devtools and its Codex consumer; Claude and VS Code are unchanged. The packaged panel does not depend on a sibling checkout or a custom Codex.

## Use

Install MainSequence from its marketplace, then ask Codex to **open MainSequence**. Expand the resulting app card when useful. The panel displays the existing devtools account and backend, verifies the session, and lists accessible organization environments. Choose one to browse Agents or Tools. A sole environment is selected automatically; multiple environments require a choice.

Agents supports paginated directory browsing and semantic search. Search results are a ranked set, not an offset-paginated collection. Cards show descriptions, current directory runtime state, model defaults, response types and identifiers. They do not prepare a session or check live readiness.

Tools lists available project MCP releases for the chosen environment, supports search/pagination, enriches repository names through devtools, and marks saved connections. Only saved connections enable schema inspection. A saved badge describes local metadata, not current endpoint availability; inspection checks the live catalog and refuses changed endpoints. This slice does not add/remove connections or call project tools.

Refresh reloads account/environment status, retaining the selected environment only if it is still available. Changing environment clears the current page immediately. A backend/account change invalidates the prior context; late reads do not replace the current UI. Existing settings and saved connections are not rewritten by discovery. Normal credential renewal remains the existing devtools session's responsibility.

The default backend comes from devtools' existing configuration/process environment. A signed-out state offers the existing `/ms login` command; the panel never starts login itself. Process sessions can be inherited using the existing `MAINSEQUENCE_ENDPOINT`, `MAINSEQUENCE_ACCESS_TOKEN` and `MAINSEQUENCE_REFRESH_TOKEN` environment variables. Do not paste credentials into the UI or conversation.

## Boundaries

| MCP tool | Public devtools operations |
| --- | --- |
| `mainsequence_open` | `auth-status`, verified `auth-status`, `mcp-environments` |
| `mainsequence_discover` | `agents-list`, or `mcp-discover` with `enrichNames: true` plus `mcp-list` with `readOnly: true`; all use `expectedAccount` |
| `mainsequence_tools` | `mcp-tools` for a release on the current discovery page, using `expectedAccount` |

All three tools are model- and app-accessible and return useful structured results without a UI. Their arguments are allowlisted; they do not accept arbitrary devtools actions. Context identifiers are short-lived server memory, not agent session IDs or a new persistent settings store. Restarting the MCP process requires refreshing the panel.

The 0.4.1 panel avoided `mcp-list` because devtools 0.3.1 could backfill saved names during inspection. Devtools 0.3.2 adds explicit read-only listing, which the panel now uses without migrating or writing connections. Public typed results replace host-side backend response parsing. Devtools binds the actual request/retry credentials to the selected account; Codex retains local backend-change checks, context IDs and late-view rejection. No private package imports or independent MainSequence HTTP client are introduced.

The UI uses the public MCP Apps JSON-RPC bridge. All colors, typography and radii prefer host CSS variables, with neutral light/dark fallbacks. Data is rendered as text, including external descriptions. The UI has no external fetches, scripts or fonts and declares empty connection/resource CSP lists. Its resource URI includes a build hash; the server captures immutable HTML at startup and the panel checks its identity before using results.

The existing developer-command hook and conversational MCP skill retain their behavior. Those older explicit workflows can perform user-authorized mutations; the new panel's three tools cannot. Production native agent sending and receipt recovery are the next implementation phase and still require qualified storage and authorization. Historical fixture tests are development evidence only; no probe plugin is required or shipped.

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

Remaining acceptance: activate this package in the desktop, identify the existing signed-in backend, verify real environment/directory/catalog reads and check actual host rendering. Then implement the production saved-request/receipt relay and one explicitly authorized real agent exchange with native reply/recall and duplicate protection.

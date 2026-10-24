# Codex plugin verification

## Marketplace ownership (2026-10-24)

The public `.agents/plugins/marketplace.json` now belongs to this repository. It
retains the existing `mainsequence@mainsequence` identity and pins the already
published `@dev-mainsequence/codex-plugin@0.7.10` archive. The shared devtools
repository no longer hosts the Codex catalog. No runtime, dependency, credential,
backend or provider changes are part of this move.

The README documents new installation from `mainsequence-sdk/mainsequence-codex-plugin`
and replacement of a configured devtools source. `scripts/check-marketplace.cjs`
validates catalog ownership, identity, exact npm version, source and install policy
as part of the release check.

Both release checks passed: 56 Codex tests, 182 devtools tests, complete builds and
npm package verification. Codex CLI 0.163.0 installed the published 0.7.10 npm package
in a disposable `CODEX_HOME`. Removing its old marketplace source and adding this
repository’s local catalog preserved every installed-plugin field except the
marketplace source: ID, version, enabled state, package and policy were unchanged.
A repeated install resolved the same cached plugin. No hook trust was granted and
no MainSequence backend, model endpoint or user account was used. The normal Codex
configuration’s before/after SHA-256 matched. Public-URL acceptance follows the
catalog’s merge, before removal of the devtools catalog.

## 0.3.1 — devtools 0.3.1: MCP names stored with saved connections (2026-10-22)

The plugin bundles [devtools 0.3.1](https://github.com/mainsequence-sdk/mainsequence-devtools/pull/15)
in place of 0.3.0; the hook adapter, manifest, hooks and skills are otherwise unchanged, so
the hook definition and its trusted hash are the same as in 0.3.0.

What the new devtools changes for this plugin:

- `mcp-add` resolves the release's name, its repository's name and its repository branch
  and stores them with the saved connection in the shared `mcp-connections.json` as `name`,
  `display_name` and `code_repository_branch_uid`. A label that cannot be read is left out;
  it never makes a working MCP unavailable.
- `mcp-list` returns the stored labels without a backend request. A connection saved by an
  earlier version is completed by the first listing that can read its labels. `mcp-add`,
  `mcp-tools` and `mcp-call` results carry them on their connection, and discovery rows pass
  the directory's `name` and `code_repository_branch_uid` through.
- The connections file is shared with the Claude Desktop plugin (0.4.18 pins the same
  devtools), so a connection labelled by either host is labelled for both.
- The readable `/ms` output labels the new fields (`Release ID`, `Name`, `Repository`,
  `Repository branch ID`); `--json` passes the rows to the `mainsequence-mcp` skill unchanged.

Package checks under Node 22.22.0 and npm 10.9.4, `npm run release:check`: type-check, build
from the registry archive of devtools 0.3.1 (`npm ci --ignore-scripts`; its integrity in
`package-lock.json` and `build-info.json` is the registry's `dist.integrity`), the Node tests
including a new case for the stored MCP connection labels in readable and `--json` output, release metadata, the standalone
archive and the npm archive exercised as Codex installs it. Since the pinned devtools is on
the registry, CI no longer names a devtools source branch; `scripts/install-devtools.cjs`
falls back to the pin's release tag only for an unpublished pin.

Installed-host checks with the Codex CLI 0.163.0 on macOS, in isolated `CODEX_HOME`
directories, the only model endpoint being the counted loopback fixture: `npm run
verify:codex` against this build installed from `artifacts/local-marketplace` and trusted
(`skills/list` and `hooks/list` as recorded for 0.3.0; all 13 prompt cases and both sync
cases behaved as in the 0.3.0 table below, with zero real model requests), and
`npm run verify:codex:reload` (same three results as for 0.3.0). The hook definition did
not change, so its trusted hash is still `sha256:8935862c…`.

## 0.3.0 — extraction from devtools and rename to `mainsequence` (2026-10-21)

The plugin moved out of [mainsequence-devtools](https://github.com/mainsequence-sdk/mainsequence-devtools)
(its [ADR 0003](https://github.com/mainsequence-sdk/mainsequence-devtools/blob/main/docs/adr/0003-codex-plugin-extraction.md))
and was renamed from `mainsequence-devtools` to `mainsequence` by the owner's decision. The
one open question was how an installed Codex host treats the marketplace change: an update
of the installed plugin, or a new plugin. Everything below ran against the Codex CLI bundled
with the desktop app, version 0.163.0-alpha.10.2 on macOS, in isolated `CODEX_HOME`
directories; the user's own Codex home was not touched, and the only model endpoint was a
counted loopback fixture that rejects inference. The npm package was not published yet, so
the renamed plugin was installed from a local marketplace copy of the built `codex/`
artifact; `npm run release:check` verifies that the npm archive contains the same files.

### Marketplace change in an installed host

A marketplace shaped like the devtools one (name `mainsequence`) first listed the former
entry, `mainsequence-devtools` from `@dev-mainsequence/devtools@0.2.8`, which Codex installed
from the npm registry. Its hook was trusted by copying the already reviewed hook hash into
`config.toml`. The marketplace file was then replaced by the new single entry `mainsequence`.

| Step | `codex plugin list` | `hooks/list` | `skills/list` | `/ms --help` |
| --- | --- | --- | --- | --- |
| 1. Old plugin installed and trusted | `mainsequence-devtools@mainsequence` installed, enabled, 0.2.8 | old hook trusted, enabled | `mainsequence-devtools:ms`, `mainsequence-devtools:mainsequence-mcp` | blocked by the old hook, 0 model requests |
| 2. Marketplace entry replaced, nothing else changed | no installed plugin listed; `mainsequence@mainsequence` available, not installed | old hook still trusted and enabled | old skills still registered | blocked by the old hook, 0 model requests |
| 3. New plugin installed, hook not yet trusted | `mainsequence@mainsequence` installed, enabled, 0.3.0 | old hook trusted; new hook untrusted | both plugins' skills, two entries named `ms` | blocked by the old hook only, 0 model requests |
| 4. New hook trusted as well | same | both trusted | same | blocked twice, once per hook, 0 model requests |
| 5. `codex plugin remove mainsequence-devtools@mainsequence` | `mainsequence@mainsequence` only | new hook only | `mainsequence:ms`, `mainsequence:mainsequence-mcp` | blocked once, 0 model requests; an ordinary prompt passes through with 1 fixture request |

Findings:

- Codex identifies a plugin by `<marketplace entry name>@<marketplace name>`. Replacing the
  entry is **a new plugin, not an update**: `mainsequence@mainsequence` installs beside
  `mainsequence-devtools@mainsequence` into `plugins/cache/mainsequence/mainsequence/0.3.0`.
- The old install keeps running from Codex's cache after its marketplace entry disappears.
  `config.toml` still has `[plugins."mainsequence-devtools@mainsequence"] enabled = true`,
  the app server still loads its hook and skills, and `/ms` is still intercepted, although
  `codex plugin list` no longer shows it. `codex plugin remove` still accepts its id.
- Hook trust is recorded per plugin id. The trusted hash is identical for both ids
  (`sha256:8935862c…`) because the hook definition did not change, so what a user reviews
  for the new plugin is exactly what they reviewed before, but the new id must be trusted
  once; until then the new hook does not run.
- With both plugins installed and trusted, both hooks run on every `/ms` and both block the
  turn, and the slash menu carries two `ms` entries. Removing the old plugin is therefore part
  of the upgrade, not optional cleanup. Removal leaves the old `hooks.state` trust entry in
  `config.toml`; it is inert.

Historical 0.3.0 migration note for users of `mainsequence-devtools` (the current
README additionally replaces the retired devtools marketplace source):

```sh
codex plugin marketplace upgrade mainsequence
codex plugin add mainsequence@mainsequence
codex plugin remove mainsequence-devtools@mainsequence
```

then review and trust the new plugin's hook and start a new chat (or toggle the plugin in
the desktop Plugins settings). The MainSequence login and saved MCP connections live
outside the plugin and need no migration.

### Installed host check (`npm run verify:codex`)

Run with `CODEX_HOME` pointing at the isolated home from step 5 above and
`MAINSEQUENCE_CODEX_PLUGIN_ID=mainsequence@mainsequence`. `skills/list` reported the enabled
`mainsequence:ms` entry with display name `ms`; `hooks/list` reported the hook trusted and
enabled. Every handled prompt blocked with zero model requests; ordinary prompts reached the
offline fixture once.

| Prompt | Action result | Host hook status | Model requests |
| --- | --- | --- | --- |
| selected `ms` + `--help` | success | blocked | 0 |
| selected `ms` + `--help --json` | success, structured output | blocked | 0 |
| selected `ms` + `--help` with the desktop's trailing newline | success | blocked | 0 |
| selected `ms` without arguments | success, help | blocked | 0 |
| selected `ms` + `invalid-action` | failure | blocked | 0 |
| selected `ms` + `sync --message "retired option"` | failure, retired option explained | blocked | 0 |
| literal `/ms --help` ending in LF or CRLF | success | blocked | 0 |
| literal `/ms --help --all` | success, complete command menu | blocked | 0 |
| literal `/ms sync --help` | success, command-specific options | blocked | 0 |
| literal `/ms --help` followed by `status` on another line | failure, invalid request | blocked | 0 |
| literal `/ms sync` in a Python fixture project | success, dependency files refreshed, Git unchanged, 0 backend requests | blocked | 0, including in flight |
| selected `ms` + `sync` in a Node fixture project | success, dependency files refreshed, Git unchanged, 0 backend requests | blocked | 0, including in flight |
| ordinary fixture prompt | passes through | completed | 1, to the offline fixture |
| `:ms --help` | passes through | completed | 1, to the offline fixture |

The sync cases ran the vendored devtools 0.3.0 inside the installed plugin, from Codex's
cache, without `node_modules`. The script now passes the `mcp_servers.main_sequence`
override only where that server is configured, since the override is invalid in a home
without it, and it reports Codex's stderr when the app server exits early.

### Existing-chat reload regression (`npm run verify:codex:reload`)

Rerun from this repository's artifact in a temporary Codex home with the renamed plugin id.
Same behaviour as recorded for 0.2.x:

| Case | Hook runs | Model requests |
| --- | --- | --- |
| Existing thread after external enable | none | 1, rejected by the offline fixture |
| New thread in the same backend | blocked | 0 |
| Existing thread after `config/batchWrite` with `reloadUserConfig: true` | blocked | 0 |

### Package checks

`npm run release:check` under Node 22.22.0 and npm 11.6.2: type-check, build from the
locally packed devtools 0.3.0 (its archive integrity is recorded in `package-lock.json` and
`build-info.json`), 15 Node tests (hook dispatch, skill-mention ownership including the
rejection of the former `mainsequence-devtools:ms` mention, presentation, tokenizer safety,
Python and Node sync fixtures, the self-contained artifact outside the checkout, and the
dependency boundary), release metadata, the standalone archive and the npm archive, which
was unpacked and exercised as Codex installs it (manifest, hooks, skills, bundled runner,
pass-through, mention handling and the terminal CLI).

### Remaining

- `@dev-mainsequence/devtools@0.3.0` is not on the registry yet. The lockfile integrity
  comes from a local `npm pack` of the devtools release branch; confirm it against
  `npm view @dev-mainsequence/devtools@0.3.0 dist.integrity` after publication, and update
  the lockfile and rebuild if it differs, before tagging this package.
- The renamed plugin was installed from a local marketplace source, not from npm. The npm
  install path itself is the one Codex used for 0.2.8 in step 1 and is unchanged.
- The desktop composer and renderer were not visually verified; the host API, event stream
  and CLI presentation were.
- The owner's own Codex home still has `mainsequence-devtools@mainsequence` 0.2.7 installed
  and the former local marketplace registered; migrating it is a user step after publication.

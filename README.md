# MainSequence for Codex

The `mainsequence` plugin registers the `ms` slash-menu entry in Codex and executes its
commands with a trusted `UserPromptSubmit` hook before inference: login, session status,
repositories, project status, dependency sync, SDK updates and more, with readable results
and no model call. Its `mainsequence-mcp` skill lets Codex discover MainSequence project
MCPs in conversation, remember a selection and use that project's tools through a bundled
MCP client.

Version **0.3.1** bundles devtools 0.3.1, which stores a connected MCP's names with the saved
connection (see [the release notes](docs/codex-verification.md)). Version 0.3.0 was the first
release from this repository. Until devtools 0.2.8 the plugin was built and published from
[mainsequence-devtools](https://github.com/mainsequence-sdk/mainsequence-devtools) under the
name `mainsequence-devtools` ([ADR 0003 there](https://github.com/mainsequence-sdk/mainsequence-devtools/blob/main/docs/adr/0003-codex-plugin-extraction.md)).
The shared implementation is still that package; this repository owns the hook adapter, the
presentation layer, the manifests, skills and icons, the host checks and the releases.

## Install

The marketplace stays where people added it, in the devtools repository:

```sh
codex plugin marketplace add mainsequence-sdk/mainsequence-devtools
codex plugin add mainsequence@mainsequence
```

Codex installs the published npm package `@dev-mainsequence/codex-plugin` without running
lifecycle scripts; the archive already contains the compiled runner and the pinned devtools
package. Node 22 or newer is required. Review and trust the plugin's hook before use
(`/hooks` in the CLI, or the hook prompt in the desktop app): installation does not trust
hooks, and an untrusted hook cannot intercept `/ms`. Then start a new chat, or toggle
MainSequence off and on in the desktop Plugins settings to hot-reload an existing chat.

### Upgrading from `mainsequence-devtools`

The plugin was renamed, and Codex identifies a plugin by its marketplace entry name, so the
installed `mainsequence-devtools@mainsequence` is not updated in place. Refresh the
marketplace, install the new entry, trust its hook, then remove the old plugin so that only
one hook answers `/ms`:

```sh
codex plugin marketplace upgrade mainsequence
codex plugin add mainsequence@mainsequence
codex plugin remove mainsequence-devtools@mainsequence
```

Your MainSequence login (the shared machine session) and saved MCP connections
(`mcp-connections.json` beside the CLI configuration) are not stored by the plugin, so
nothing needs migrating. The exact behaviour of the installed host during this change is
recorded in [the verification document](docs/codex-verification.md).

### A local build

```sh
npm run build
codex plugin marketplace add /absolute/path/to/mainsequence-codex-plugin/artifacts/local-marketplace
codex plugin add mainsequence@mainsequence-local
```

The local catalog loads the built artifact in `codex/`; the installed plugin runs from
Codex's cache. `npm run pack:codex` also writes a standalone archive of that artifact.

## Use

In Codex desktop, type `/ms` and **select `ms` from the slash menu**, then append the
arguments and submit:

```text
/ms --help
/ms login --backend https://api.main-sequence.app
/ms status
/ms sync
```

Selection inserts a native skill mention. The hook accepts that mention only when it
references this plugin's own `skills/ms/SKILL.md`, parses the single-line arguments as data
without any shell, and blocks the turn with a readable result on success and failure, so a
handled command never reaches the model. `/ms --help --all` lists every command and
`/ms COMMAND --help` its options; `--json` exports the structured result. Ordinary prompts
pass through. Codex CLI rejects custom `/ms` input before submission; use `ms-devtools` in
a terminal there (see below).

For project MCPs, ask in conversation: "Which internal MCPs are available?", "Add
metatable-mcp", "Use it to list my tables." See
[conversational project MCP connections](docs/conversational-mcp.md) and
[ADR 0002](docs/adr/0002-conversational-project-mcp-client.md).

## Architecture and development

Shared functionality comes from the exact `@dev-mainsequence/devtools` package API. The
build (`scripts/build-codex.cjs`) compiles `src/` to `build/`, then writes the installable
artifact to `codex/`: the manifest, hooks, skills and icons from `manifests/codex`, the
runner and hook adapter with every reachable devtools `dist` module vendored into
`dist/vendor/devtools`, and `build-info.json` with the pinned devtools version and
registry integrity. Codex's npm plugin source reads the manifest from the package root, so
the build mirrors `.codex-plugin`, `hooks`, `skills`, `assets`, `build-info.json` and the
bundled `dist` there for `npm pack`; those mirrors are ignored by Git. An installed plugin
needs neither this checkout, nor `node_modules`, nor an npm download at execution time.

`src/runner.ts` is the plugin's entry point: `dist/runner.js --codex-hook` serves the
hook, and any other invocation is the plain `ms-devtools` terminal CLI, so this package's
`bin` keeps working in a shell (`npx -p @dev-mainsequence/codex-plugin ms-devtools --help`).
`src/hosts/codex.ts` recognises `/ms` and the linked skill mention and dispatches through
devtools' exported parser and tokenizer; `src/hosts/codexPresentation.ts` renders help and
results. `tests/dependency-boundary.test.cjs` forbids private devtools imports.

### Dependencies

`npm ci --ignore-scripts` installs the pinned devtools from the registry with the integrity
recorded in `package-lock.json`. While that version is not published yet, run

```sh
node scripts/install-devtools.cjs /path/to/dev-mainsequence-devtools-0.3.1.tgz
```

with the archive from `npm pack` of the devtools release branch, or without an argument to
build it from the devtools repository at `DEVTOOLS_SOURCE_REF` (default `v<pinned version>`).
Either way the archive must match the lockfile integrity, and the registry pin is not
changed (`scripts/use-local-devtools.cjs`). CI does the same until the version is
published. After publication, confirm that `npm view @dev-mainsequence/devtools@0.3.1
dist.integrity` equals the lockfile entry before tagging a release; if the registry archive
differs, update the lockfile and rebuild so `build-info.json` records the published
integrity.

### Verification and release

```sh
npm run release:check
```

type-checks, builds, runs the Node tests (hook, presentation, packaging and dependency
boundary), checks release metadata, packs the standalone artifact and the npm archive, and
verifies the npm archive as Codex installs it. With a built plugin installed and trusted in
a Codex host, `npm run verify:codex` runs real app-server turns through a counted offline
model fixture, and `npm run verify:codex:reload` checks the existing-chat reload behaviour
in a temporary Codex home. Set `MAINSEQUENCE_CODEX_BINARY` when the Codex CLI is not on
`PATH`, `CODEX_HOME` to check an isolated home, and `MAINSEQUENCE_CODEX_PLUGIN_ID` for a
plugin installed from another marketplace. Results are recorded in
[docs/codex-verification.md](docs/codex-verification.md).

A `v<version>` tag runs the same checks from the published devtools archive and publishes
the verified npm archive with provenance through npm trusted publishing (repository
`mainsequence-sdk/mainsequence-codex-plugin`, workflow `release.yml`, environment `npm`).
Published versions are immutable. After publishing, point the marketplace entry in the
devtools repository at the new version.

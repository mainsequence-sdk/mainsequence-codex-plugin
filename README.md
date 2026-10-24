# MainSequence for Codex

MainSequence for Codex puts your MainSequence account inside Codex: sign in once, set up
and maintain your repositories and projects, message platform agents from chat, connect
project MCPs and call their tools, and follow deployments. It is the Codex plugin
`mainsequence@mainsequence`, published as the npm package `@dev-mainsequence/codex-plugin`.

It is built on the shared [MainSequence developer tooling](https://github.com/mainsequence-sdk/mainsequence-devtools),
which also powers the [VS Code extension](https://github.com/mainsequence-sdk/ms-vscode-extension)
and the [Claude Desktop plugin](https://github.com/mainsequence-sdk/mainsequence-claude-desktop).
One sign-in on your machine serves all three and the `mainsequence` and
`command-center-sdk` command lines.

## Install

You need the Codex desktop app or the Codex CLI, Node 22 or newer on your `PATH`, and a
MainSequence account. Repository setup needs Git and SSH; Python repositories need `uv`,
Vite + React repositories need npm; local image builds need Docker with buildx. The plugin
runs on macOS and Linux. On Windows the shared sign-in cannot be kept between sessions, so
the plugin is not supported there yet.

```sh
codex plugin marketplace add mainsequence-sdk/mainsequence-codex-plugin
codex plugin add mainsequence@mainsequence
```

Codex installs the published npm package without running lifecycle scripts. The archive
contains the compiled plugin and the exact MainSequence developer tooling it was built
with, so nothing else is downloaded or built. Then:

1. Review and trust the plugin's hook: `/hooks` in the CLI, or the hook prompt in the
   desktop app. Installation does not trust hooks, and `/ms` commands do not run until
   the hook is trusted.
2. Start a new chat, or toggle MainSequence off and on in the desktop Plugins settings to
   reload an existing chat.

To update, refresh the marketplace and reinstall the entry, then start a new chat:

```sh
codex plugin marketplace upgrade mainsequence
codex plugin add mainsequence@mainsequence
```

If you added the marketplace from the devtools repository (before 2026-10-24), replace it
once. The plugin keeps its name, and your sign-in and saved MCP connections are not stored
by the plugin, so nothing else changes:

```sh
codex plugin marketplace remove mainsequence
codex plugin marketplace add mainsequence-sdk/mainsequence-codex-plugin
codex plugin add mainsequence@mainsequence
```

## Sign in and choose an environment

Ask Codex to **open MainSequence**. The panel has **Home, Code, Projects, Agents, Tools,
Activity** and **Settings**.

1. In **Settings**, choose **Sign in with browser**. The hosted MainSequence login opens in
   your browser; account creation is part of that flow. The session is saved in your
   operating system's credential store (the login Keychain on macOS, Secret Service on
   Linux), where the VS Code extension, the Claude Desktop plugin and the MainSequence
   command lines find it too. **Check connection**, **Renew session** and **Sign out** are
   in the same place.
2. The backend defaults to `https://api.main-sequence.app`. If your organization runs its
   own MainSequence deployment, set its API URL as the backend in Settings before signing
   in. Set the **Command Center URL** there as well, so project and repository links open
   in Command Center.
3. Pick an **organization environment** in the panel header. Agents, MCPs, projects and
   deployments are shown for that environment, and MainSequence tools Codex calls are
   bound to it.

From chat, `/ms login --backend https://api.main-sequence.app` does the same sign-in, and
`/ms auth-status --check` verifies it.

## What you can do

- **Agents.** Browse the environment's agents with their descriptions, skills and example
  questions. **Talk** prepares a conversation without sending anything. Choose **Message**
  or **Task** when the agent supports both, write your message and **Send in Codex**: the
  agent's reply comes back through a MainSequence tool and stays in the chat's context.
  If you stop Codex mid-send, **Messages and recovery → Recover in Codex** delivers the
  same request once more without sending it twice; a request with an unknown outcome is
  blocked rather than resent. Nothing is ever sent automatically.
- **Tools.** Connected project MCPs of the environment come first; **Add MCP** searches
  the environment's releases. Every tool of a connected MCP is registered in Codex as
  `ms_<tool>_<hash>` with the project's own schema, so "list my CRM contacts" is one
  ordinary tool call. You can also just ask: "Which internal MCPs are available?", "Add
  metatable-mcp", "Use it to list my tables." See
  [conversational project MCP connections](docs/conversational-mcp.md). A project MCP that
  has scaled to zero can take over a minute to answer its first call; the plugin waits.
- **Code.** Your account's repositories and the local copies under your repositories
  folder. **Set up** clones a repository into `<folder>/<organization>/projects/<name>-<uid>`
  with its deploy key and writes an endpoint-only `.env`, optionally installing
  dependencies. A local repository offers status, dependency sync and install, SDK update,
  instructions and skills updates, legacy credential cleanup, a Docker build preview, a
  devcontainer preview, and a confirmed delete.
- **Projects.** The environment's MainSequence projects with their repository branches.
  **Set up project locally** prepares every member branch in its own checkout and hands
  the workspace to Codex, with a project `AGENTS.md`.
- **Deployments.** The latest run of a repository branch, its stages and logs, and the
  environment's deployment history. Read-only.
- **Activity.** Running and finished operations with progress, results and cancellation.
- **`/ms` commands.** In Codex desktop, type `/ms`, select **ms** from the slash menu,
  append the arguments and submit, for example `/ms --help`, `/ms status`, `/ms sync`. The
  plugin's hook runs the command before the model sees it and shows the result; `--json`
  returns the structured result. Ordinary prompts pass through untouched. The Codex CLI
  rejects custom `/ms` input, so use the bundled command line there:
  `npx -p @dev-mainsequence/codex-plugin ms-devtools --help`.

[Capabilities and host differences](docs/agents-tools-panel.md) lists every surface,
what stock Codex can and cannot expose, and which MainSequence operation each plugin
tool uses.

## Troubleshooting

- **`/ms` reaches the model or answers "the hook must be enabled and trusted".** Trust the
  hook (`/hooks`), then start a new chat.
- **The panel says you are not signed in.** Use **Settings → Sign in with browser**, or
  `/ms login --backend <url>`. One sign-in per backend is kept on the machine.
- **A newly connected MCP's tools are missing.** Tools connected in the current chat are
  registered for the next chat; until then Codex uses them through the plugin's own
  `mainsequence_tools` / `mainsequence_call_tool`.
- **A project tool times out.** Cold project MCPs are slow on their first call; the plugin
  allows up to five minutes. Check the project's deployment in **Deployments**.
- **Codex cannot start the plugin.** Node 22 or newer must be on the `PATH` Codex uses.
  **Settings** shows runtime diagnostics.

## Development

- `src/` is the plugin: `runner.ts` (the `/ms` hook and the `ms-devtools` command line),
  `hosts/codex.ts` and `hosts/codexPresentation.ts` (command parsing and output), and the
  `panel-server` with the MainSequence panel and the `mainsequence_*` tools.
- `manifests/codex/` holds the Codex manifest, hooks, skills and icons;
  `scripts/build-codex.cjs` compiles `src/` and writes the installable artifact to `codex/`,
  with every needed devtools module vendored, and mirrors it to the package root for
  `npm pack`. An installed plugin needs neither this checkout nor an npm download.
- `.agents/plugins/marketplace.json` is the public marketplace Codex reads from this
  repository. It names the last published npm version.
- `tests/dependency-boundary.test.cjs` forbids private devtools imports; shared behaviour
  comes only from the exact `@dev-mainsequence/devtools` package API.

```sh
npm ci --ignore-scripts
npm run build
codex plugin marketplace add /absolute/path/to/mainsequence-codex-plugin/artifacts/local-marketplace
codex plugin add mainsequence@mainsequence-local
```

`npm ci --ignore-scripts` installs the pinned devtools from the registry with the integrity
in `package-lock.json`. For a devtools version that is not published yet,
`node scripts/install-devtools.cjs /path/to/dev-mainsequence-devtools-<version>.tgz` stages
that archive without changing the registry pin; CI does the same. Before tagging a release,
confirm `npm view @dev-mainsequence/devtools@<pinned version> dist.integrity` equals the
lockfile entry.

`npm run release:check` type-checks, builds, runs the tests, checks the release metadata,
the marketplace and the documentation, packs the standalone artifact and the npm archive,
and verifies the npm archive as Codex installs it. With the built plugin installed and
trusted in a Codex host, `npm run verify:codex` runs real app-server turns against a
counted offline model fixture and `npm run verify:codex:reload` checks reloading in an
existing chat; set `MAINSEQUENCE_CODEX_BINARY` when the Codex CLI is not on `PATH`,
`CODEX_HOME` for an isolated home and `MAINSEQUENCE_CODEX_PLUGIN_ID` for a plugin installed
from another marketplace. `docs/local-development-backend.md` describes pointing a
workstation at a development backend.

To release: set the new version in `package.json`, `package-lock.json` and
`manifests/codex/.codex-plugin/plugin.json`, run `npm run release:check`, merge, and push
the tag `v<version>`. The release workflow repeats the checks from the published devtools
archive and publishes the verified npm archive with provenance through npm trusted
publishing. Published versions are immutable. Write the release notes on the GitHub
release of that tag. After publishing, read the archive's integrity from the registry
(`npm view @dev-mainsequence/codex-plugin@<version> dist.integrity`; a local `npm pack` has
another), then advance `.agents/plugins/marketplace.json` to the published version. The
marketplace stays on the last published version while a release is being prepared;
`node scripts/check-marketplace.cjs` enforces that it never advertises an unpublished one.

## Linux desktop sessions

The native MCP server needs the same desktop-session context as the terminal runner
to reach Secret Service and open sign-in. The plugin forwards
`DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `DISPLAY` and `WAYLAND_DISPLAY` from
Codex's environment. Start Codex from your desktop session. After installing an
updated local build, toggle MainSequence off and on in Plugins to reload this chat.
Shared devtools errors preserve safe reasons for unavailable sessions, services and
locked stores. See [diagnostics and verification](docs/agents-tools-panel.md#linux-credential-store-diagnostics).

# Codex host probe

Disposable plugin for testing the installed Codex host. Version **0.6.0** packages the existing, unchanged devtools dependency, with injected fixture SessionService and fetch implementations. The earlier native relay used **0.3.0**; the current build/update and fixture checks pass with **0.3.1**. Build diagnostics record the exact dependency version and content hash. MainSequence destinations are `.invalid`; every platform/project request is intercepted and unexpected destinations are rejected. No account credentials or real agents are used. The Claude project is a read-only behavior reference, not a dependency.

The three tabs test agent conversations, project MCPs, and the host bridge. Styling uses host colors, fonts, sizes and radii, with grayscale fallbacks. The explicit inner background avoids the transparent-body capture problem observed in 0.1.0. Opening `panel.html` as an ordinary file is a **disconnected preview**, not a Codex integration test.

## Reproduce

Run from the repository root with its existing devtools dependency installed:

```sh
node --test experiments/codex-host-probe/communications.test.mjs experiments/codex-host-probe/requests.test.mjs
node --test experiments/codex-host-probe/build-lifecycle.test.mjs experiments/codex-host-probe/panel-contract.test.mjs experiments/codex-host-probe/installer-contract.test.mjs
node experiments/codex-host-probe/verify-receipts.mjs
node experiments/codex-host-probe/verify-update.mjs
node experiments/codex-host-probe/verify-context-refresh.mjs
node experiments/codex-host-probe/verify-communications.mjs
node experiments/codex-host-probe/verify-runtime.mjs
node experiments/codex-host-probe/verify-runtime.mjs --initial-extra
```

The communication test covers prepare-without-send, exact multiline messages, session/agent/chat isolation, persistence across processes, owned tasks, cancellation, uncertain-delivery protection, MCP schemas/results/errors/disconnect, environment changes, live project-tool additions/schema changes/removals, long relay results and ended native routes.

The build tests cover deterministic identities, artifact tampering, stale-file cleanup, same-version replacement refusal, resource reads after cache deletion, and session survival without replay. The installer test uses the actual public CLI in a temporary profile. The panel test executes the shipped script with a simulated MCP App bridge: mismatched build/resource identities block dispatch, recovery does not replay, submission errors remain uncertain, literal multiline text survives, and host style changes are applied. It does not prove desktop rendering or native composer preservation.

`verify-update.mjs` uses an actual isolated Codex app-server and localhost scripted model. It measures clean install, existing/new chats after upgrade, supported MCP reload, resume, preserved fixture session/send count and removal. On the tested host, installing updated metadata without replacing the existing chat's server; a new chat adopted the build, and `config/mcpServer/reload` followed by a turn aligned the existing chat. This API belongs to the host; the panel has no established public way to invoke it. Binding the localhost fixture may require sandbox approval. No real model or MainSequence credentials are used.

`verify-context-refresh.mjs` retains the experimental hook native-context test. It installs into an isolated profile and runs the actual Codex app-server against a localhost scripted Responses fixture. It verifies `/ms-probe-chat` produces a native assistant item, enters later model context, persists through thread resume, and sends to the fixture agent only once. It also performs actual model MCP function calls to discover and use added/changed project schemas and refuse a removed tool. Separate checks inspect the actual model request tool list across notifications, reload and host disable/enable. This is transport/persistence evidence, not real-LLM fidelity or desktop rendering. No API key or real service is used.

`verify-communications.mjs` retains the **old blocked-hook regression**. It installs into an isolated temporary Codex home and trusts only its exact fixture hook hash there. It uses the actual Codex app-server. It starts fixture turns against a counted localhost endpoint that rejects inference: `/ms-probe` must produce a hook result (zero native assistant items) with zero model requests, while an ordinary prompt must reach that mock endpoint. No real model endpoint or MainSequence service is contacted. Binding the localhost listener may require sandbox approval. Codex itself may attempt background plugin-catalog requests.

`verify-runtime.mjs` tests packaging, MCP discovery, UI resource metadata, operation cancellation, dynamic catalog refresh and separate chats without starting model turns. Result paths are printed. Runtime tests do not prove desktop rendering.

`verify-receipts.mjs` exercises actual isolated Codex interruption and native tool recovery against a localhost scripted model. It verifies pending state after `turn/interrupt`, one agent send across two recovery turns, the recorded reply in native history, and subsequent recall with zero tool calls. The script tests no native desktop queue; live Stop remains a separate acceptance case. The request unit test also covers concurrent calls, stale/expired routes, uncertainty and process death. No account or real service is contacted.

## Desktop installation

```sh
node experiments/codex-host-probe/install-desktop.mjs
# Re-run the same command to update the durable local test marketplace.
# Only for an older installation with a still-existing custom source:
node experiments/codex-host-probe/install-desktop.mjs /absolute/path/to/existing/probe-marketplace
```

The installer validates that the supplied marketplace contains only this probe. It copies the installed devtools package into the staged plugin's `vendor/devtools`; it does not edit the dependency, production plugin, devtools source, or Claude project. Desktop installs use `experiments/codex-host-probe/.local-marketplace/` (Git-ignored) so temporary-directory cleanup cannot remove the registered source. A build manifest hashes the packaged files, including devtools. An installation receipt refuses different contents under an already installed version before replacing the registered source. Increment the probe version for changes after installation. The installer verifies the installed cache separately from host activation. Isolated runners still use temporary profiles. If migrating a missing old temporary source, remove only the `mainsequence-host-probe` marketplace registration, then run this installer; do not remove other marketplaces.

Use the printed `detailLink` if the plugin is difficult to locate. Call `probe_open` in a chat where its tools are available. The app requests fullscreen; if it remains inline, expand it and use **Host checks → Request fullscreen**. Global/thread launcher discovery is a separate check. Each panel URI now includes the package version and build hash. A server captures its exact HTML at startup so package replacement cannot silently change its resource. **Host checks → Running build** compares the panel and server before actions. A missing/mismatched build pauses actions, preserves the message and does not retry it. Compare these identities with the install receipt; a matching old panel/server does not by itself prove adoption of the latest installation. The existing desktop chat initially retained its legacy server after installation; the subsequent live 0.5.0 test verified matching installed/server/panel builds and a retained agent session. The exact adoption trigger was not observed. Do not infer activation from installation or repeat restart advice without evidence.

The installed 0.6.0 build adds saved requests and receipts. Immediately after installation, this chat retained 0.5.0; after the user toggled the probe, the server and actual panel adopted 0.6.0 with matching builds. Fresh D1 survived a verified native Stop as pending. Recovery submitted the same ID and was acknowledged. The app-origin message arrived after an intervening pending-state verification, and the native receipt tool delivered it once (total sends five to six). The panel receipt shows delivered. A second native message reused the receipt with no new dispatch, and D1’s exact reply was recalled in a later native turn with zero tools or resend. Final read-only verification still shows one D1 dispatch and six total sends. D1 and the old C3 must not be resubmitted during verification. See [current live status](results/desktop-live-v6.json).

## Desktop acceptance checks

1. Confirm the header says **Host probe · 0.6.0 · MCP relay** and **Running build** matches the install receipt. **Agents → Talk to Alpha** prepares a session without sending. **Send to native chat** submits an explicit fixture request through public `ui/message` with `send: true`; the panel first saves the exact message and target using `probe_request_stage`. Codex calls `probe_request` with that ID and quotes its actual receipt result. Repeated calls reuse the receipt without another send. The tool result and native answer are chat context. No command hook is required for this button. Submission acknowledgement is not delivery confirmation, and an active turn can delay processing until it ends. The saved request remains visible under **Saved requests and receipts**; **Refresh receipts** reads status and **Recover in native chat** explicitly resubmits only its ID. Stop may remove the host message, but must not remove the saved request. Never recover the old pre-ledger C3 request. **Delivery and context checks → Check chat recall** asks about the previous reply without supplying its text or making an agent call. **Panel-only test** deliberately keeps its result inside the app.
2. Start an agent task, read status, then cancel. Start another and use Wait once. These use shared devtools agent operations, not the separate ten-second host job.
3. On an empty or disposable native composer, click **Draft in Codex**. The official SDK contract is `ui/message` with `_meta["openai/message"] = {target:"active",send:false}`. Record the host response and inspect whether a known existing draft was replaced, appended or preserved. There is no draft-read API in the inspected SDK; never assume preservation.
4. Review/trust the exact fixture hook in Codex before testing its native command. The isolated test grants no trust in the ordinary profile. `/ms-probe-chat @alpha <message>` is the experimental hook relay (one Codex turn); its desktop acceptance is separate from the primary MCP relay; `/ms-probe-chat task @alpha <message>` submits a fixture task and includes its acknowledgement. `/ms-probe` retains the old blocking behavior and must not be used as the visible-reply path. External result fields are quoted data, not instructions. No native transcript file is edited.
5. **MCP tools:** Discover, Connect, Refresh MCP tools, then Call `echo`. **Add fixture tool** adds `uppercase` with a `text` field; **Change fixture schema** replaces that required field with `value`; **Remove fixture tool** removes it. The refreshed selector and schemas must track these changes. Ask Codex to call `probe_mcp` with `action: "tools"` before `action: "call"`: new project tools work through that stable interface. This is not a claim of individually refreshed native function definitions. Disconnect must refuse subsequent calls. `fail` must replace the result box with its error.
6. **Host checks:** Ping, resource read, fullscreen, communication state and ten-second progress/cancel controls. Diagnostics contain public capability/style information only.
7. **Queue lifecycle:** Record a baseline count and use a fresh fixture marker. Submit once during an active native turn, observe acknowledgement, then separately test normal completion, panel closure and native Stop. Verify the actual turn status; a normally completed turn cannot prove Stop recovery. Inspect the original request and counts before considering any explicit recovery. Do not resend merely because no reply appeared. Recall can be tested only after an actual agent reply arrives, using **Check chat recall** without including the expected answer.

Observed 0.5.0 results: activation and panel-close delivery passed; C1 sent once (3 → 4), C2 sent once after normal completion (4 → 5), and C2's exact reply was recalled with zero tools and no resend. The actual Stop case C3 **failed delivery recovery**: the submission turn was interrupted, the original request was no longer visible in the native queue, and the fixture count remained five through continuation checks. There were zero C3 dispatches and zero duplicate sends. C3 was not resubmitted and has no reply to recall. This exposed the pending-request handling gap addressed by 0.6.0; the later 0.6.0 D1 test passes saved-request recovery, duplicate receipt reuse and native recall. The historical C3 failure remains unchanged and is not evidence of a general exactly-once guarantee. See [live evidence](results/desktop-live-v5.json).

Default fixture bridge logs: system temporary directory `mainsequence-codex-host-probe-v1/`. Communication fixture state: `mainsequence-codex-host-probe-v2/communications/`, keyed by hashed chat identity. `MS_HOST_PROBE_DATA_DIR` overrides both roots for isolated tests. Fixture messages are stored locally to verify exact delivery; ordinary prompts are not stored by the hook. The experiment is not a production session store or crash-recovery implementation. Temporary fixture state may be cleaned independently of the durable marketplace; prepare a fresh fixture session afterward. Never replay old messages automatically.

Computer Use cannot operate the Codex native window. The separately permitted MCP Apps inspector can inspect an expanded/fullscreen app; a normal browser preview is not a substitute. See [observations and evidence](../../docs/codex-host-probe-results.md).

Cleanup removes only this probe:

```sh
codex plugin remove mainsequence-host-probe@mainsequence-host-probe
codex plugin marketplace remove mainsequence-host-probe
```

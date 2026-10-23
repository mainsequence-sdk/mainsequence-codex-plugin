# Codex host probe results

Test dates: 2026-10-21–22. Codex runtime: `0.163.0-alpha.10.2`. The desktop UI bridge reports `chatgpt` version `26.1013.40934`; use advertised capabilities rather than the product-name string.

## Current implementation — probe 0.6.0 pending requests and receipts

The test plugin saves immutable literal input and its agent/session/environment under a request ID before submitting an app message. The native message asks Codex to deliver that ID through `probe_request`; it no longer asks the model to reconstruct send arguments. Dispatch state is saved before calling the unchanged devtools client. The resulting receipt contains the actual response. Repeated delivery calls return a successful saved receipt without sending again; expired, stale, ended, rejected or uncertain requests cannot dispatch. A crash without a durable receipt becomes uncertain and remains blocked.

The panel lists saved requests and separates host acknowledgement from agent delivery. **Refresh receipts** reads server state; **Recover in native chat** explicitly submits the same request ID. Reopening and status reads do not replay requests. A delivered receipt does not claim that native chat rendering completed. The panel retains Codex host styles and neutral fallbacks. Existing pre-0.6 messages are not imported into this ledger; the old stopped C3 request remains unresent.

**Twelve focused tests pass**, including simultaneous delivery attempts, unchanged multiline input, cross-chat refusal, expiry/ended routes, uncertainty even after clearing the legacy guard, process death, panel reopen and recovery by the same ID. The actual isolated Codex runtime discovers the new tools and proves one send across repeated receipt calls. A second isolated test uses a local scripted model and actual `turn/interrupt`: the request stays pending, explicit native tool recovery sends once, duplicate recovery returns the receipt, and a later native turn recalls the reply with zero tool calls. That is model/context routing evidence, not live desktop Stop or real-model fidelity.

**The 0.6.0 live Stop/recovery, duplicate suppression and context checks now pass.** Installed build `063693991c4bb0742564abb52e64f4305e22694eaa272a31fc1b2af767ba3260`, server and panel matched after the user toggled the probe. The new receipt tool was model-visible; the existing Alpha session retained five sends.

Fresh D1 (`180167e8-ad17-47b3-8509-157f09141a31`) was saved before native submission. The user clicked native Stop and supported thread inspection verified interruption. D1 remained pending with zero dispatches. **Recover in native chat** submitted the same ID. Both native messages arrived later; the first executed the saved request once and the second returned its receipt. We did not independently identify which submission produced each arrival. An intermediate check still saw pending state; that was a timing observation, not proof of permanent host message loss.

| Live 0.6.0 check | Verified result |
| --- | --- |
| Activation | Installed/server/panel build matched; receipt tool exposed to the model. |
| Actual native Stop | Submission turn recorded as interrupted. |
| Saved request after Stop | Same D1 ID, literal message, agent and session; pending with zero dispatches. |
| Explicit recovery | Same ID submitted; no replacement request created. |
| Agent delivery | One D1 dispatch and one successful durable receipt; total sends 5 → 6. |
| Duplicate native message | `reusedReceipt: true`; dispatch count stayed one and total sends stayed six. |
| Native reply | Exact multiline agent result quoted in the completed delivery turn. |
| Context-only recall | Exact reply and two leading spaces reproduced in a later completed turn with **zero tools, zero commands and no resend**. The recall prompt contained no expected answer. |
| Final read-only verification | Receipt still delivered, one dispatch, total sends six. |
| Old C3 | Not resubmitted or dispatched. Historical 0.5.0 failure retained below. |

Recall turn: `01a16346-7307-7901-803e-8f4719a973eb`. Supported thread inspection verifies its final answer and absence of tool/command calls; the subsequent fixture snapshot independently confirms the unchanged send count. These checks complete the requested live communication experiment. They do not establish a general exactly-once guarantee, bounded host scheduling latency, production authentication, desktop restart/compaction behavior or full Claude parity. The fixture uses disposable local state, not production storage.

Evidence: [0.6.0 runtime and MCP tools](../experiments/codex-host-probe/results/runtime-v6.json), [isolated interruption, native receipt and recall](../experiments/codex-host-probe/results/receipt-runtime-v6.json), [live activation and acceptance status](../experiments/codex-host-probe/results/desktop-live-v6.json).

## Verified 0.5.0 build/update contract

Probe 0.5.0 adds an immutable build manifest and panel resource, version/dependency/hash diagnostics, a panel/server identity check before actions, and an installer receipt that refuses changed contents under the same version. The server keeps its exact startup HTML in memory after an old cache is removed. Staging removes obsolete files and validates the prior installed version before altering the registered source. Codex host CSS variables and neutral fallbacks are retained.

**Eight focused tests pass.** They cover build identity/tampering, stale staging files, real isolated CLI installation, resource reads after cache removal, session preservation, unchanged shared-client communication, and the shipped panel script against a simulated public bridge. The panel test proves that mismatches block native submission, preserve exact multiline text and recover without replay; host submission errors remain uncertain. Host theme changes apply in that simulation. These checks do not establish live rendering, composer draft preservation or recovery of a queued native turn.

The workspace dependency moved independently from devtools 0.3.0 to 0.3.1 during this work. The final fixture, packaging and lifecycle tests were repeated with the unchanged installed 0.3.1 package; the source/lockfile changes outside this probe were left intact. Earlier live native relay evidence remains a 0.3.0 result.

| Actual isolated Codex observation | Result |
| --- | --- |
| Clean install | Server, advertised UI resource and embedded panel build agree. |
| CLI upgrade of an existing chat | Running server remains old while advertised panel metadata changes; reading the advertised new URI fails with Unknown fixture resource. |
| New chat in the same backend | Adopts the new build and matching resource. |
| Another turn in the old chat | Still uses the old server; a turn alone does not activate the update. |
| Supported MCP reload followed by a turn | Adopts the new server and resource. This measures package adoption, not individual function-schema hot refresh. |
| Later config reload/toggle and thread resume | Build remains aligned. These occur after successful MCP reload; they are not independent proofs of initial adoption. |
| Fresh backend resuming the existing chat | New build/resource agree; fixture agent session is preserved with one send, no replay. |
| Removal in a fresh backend | Probe absent. |
| Dynamic tool notification | Still not reflected in server-status catalog within the five-second no-turn window, although the added tool is directly callable. Historical real-model checks remain authoritative for native schemas. |

The model endpoint was a localhost scripted fixture; no real model or MainSequence request was made. Clean install/update/resume/removal use the actual installed Codex binary. They do not exercise the desktop settings or MCP App window.

**Desktop activation now passes.** On the subsequent live test, the native `probe_snapshot` and reopened MCP App both reported build `be431969fe9e59cd17a43a01cbe1b1a42c05bec992552db4bd77905cb2d40902`, matching the installed 0.5.0 package and devtools 0.3.1. The panel displayed **Host probe · 0.5.0 · MCP relay** and **Panel and server builds match**. The previous agent session survived with three sends. No restart or plugin toggle was needed in this test turn; the precise adoption trigger between turns was not observed, so this does not establish a panel-controlled reload API.

**Queued delivery after panel closure passes.** Request C1 was acknowledged by the live panel during an active turn. The user closed the panel and the inspector then listed no open MCP tabs. Agent sends remained three before the turn ended. The queued app-origin request subsequently arrived, invoked `probe_agent` once and produced an exact native Alpha reply; sends became four. Reopening the panel restored the same session. Request C2 also produced one native reply, increasing the count to five. Its preceding turn is recorded as `completed`, so C2 establishes ordinary queued delivery, not Stop recovery.

**Native context recall passes on the activated 0.5.0 build.** The user clicked **Check chat recall** after two panel-inspector timeouts. Its prompt contained no expected answer. Codex reproduced C2's exact multiline Alpha reply from native conversation context with zero tool calls and no resend. Supported thread inspection confirms the recall turn contained no tool or command items; the fixture count remained five.

**Actual Stop/recovery fails delivery.** The panel acknowledged `LIVE-STOP-RECOVERY-20261022-C3` during an active turn, before any agent dispatch. The user clicked native Stop, and supported thread inspection confirms that turn became `interrupted`. After a completed recovery-check turn and another user continuation, C3 had not arrived as an app-origin message or agent call. The user confirmed it was no longer visible in the native queue. The fixture count stayed five throughout: **zero C3 dispatches, zero duplicate sends, and no resend**. The agent session survived, but there is no C3 reply to test for context retention. Queue internals were not inspected; this observation establishes that submission acknowledgement cannot be treated as durable delivery across Stop.

| Live 0.5.0 acceptance item | Result |
| --- | --- |
| Installed/server/panel build identity | Passed; all match the installed build. |
| Queue while active, close panel, finish turn | Passed; C1 dispatched once, count 3 → 4. |
| Reopen panel | Passed; same Alpha session. |
| Ordinary queued delivery | Passed; C2 dispatched once, count 4 → 5. |
| Recall delivered reply from native context | Passed; exact C2 reply, zero tools, count 5 → 5. |
| Native Stop actually exercised | Confirmed; interrupted turn recorded. |
| Original queued request recovered after Stop | Failed; C3 absent from visible queue, zero dispatches, count 5 → 5. |
| Duplicate send during recovery | None observed; original request was not resubmitted. This does not establish exactly-once delivery. |
| C3 reply retained in context | Not applicable: no reply was produced. |

The communication snapshot's hard-coded `devtoolsVersion: 0.3.0` is a stale diagnostic label; the hashed packaged build establishes the actual 0.3.1 dependency.

Evidence: [isolated runtime](../experiments/codex-host-probe/results/runtime-v5.json), [ordered upgrade observations](../experiments/codex-host-probe/results/update-v5.json), [earlier installation observation](../experiments/codex-host-probe/results/desktop-install-v5.json), [live desktop lifecycle test](../experiments/codex-host-probe/results/desktop-live-v5.json), [reproducible tests and checks](../experiments/codex-host-probe/README.md).

## Verified live native relay — probe 0.4.0 iteration

**An actual fixture agent reply now reaches the native Codex conversation through its MCP tool.** The panel submitted `/ms-probe-chat @alpha PANEL-NATIVE-TRACE-20261022-A` once. Codex acknowledged submission during the active turn, then delivered the message after that turn ended as `untrusted_input` from `mcp_app`, followed by the user instruction to read it. No `UserPromptSubmit` result accompanied that input. The assistant checked the fixture count, called the exposed `probe_agent` once, received `Alpha fixture agent: PANEL-NATIVE-TRACE-20261022-A`, and quoted it in native chat. Send count moved from one to two. This was the actual desktop model/tool path, with no shell fallback or scripted model.

The successful path is **panel → native app message → Codex MCP tool call → agent result → native assistant reply**. The tool result is model context, and the quoted answer is native conversation history. This requires a Codex model turn; it does not create a separate external-agent role or bypass inference. An active turn delayed app-message delivery. The previous implementation wrongly depended on that app message reaching the native prompt hook, and wrongly labelled the submission acknowledgement as a completed reply.

Probe **0.4.0** changes the primary button and draft to request the existing `probe_agent` call directly, with the exact agent/session/message arguments encoded as JSON. It explicitly treats message and result fields as data, refuses blank input, and asks for no automatic retry. The experimental hook remains available only for separate hook tests. **Check chat recall** requests the previous reply from existing conversation context without including the expected answer or sending an agent message. Native status now distinguishes submission from reply confirmation.

The updated panel uses a new `communications-v4.html` resource ID. Replacing HTML under the old ID still showed old content after reopening, both in the inspector and in the user's observation. The 0.4.0 package is installed and its new resource passes the actual isolated Codex packaging/runtime check. After the user toggled the probe, the revised MCP relay controls appeared and passed live send/recall testing, but the panel retained its 0.3.0 MCP relay label and the server retained its prior identity. This proves the revised behavior, not adoption of the installed v4 resource. Reliable update/reload remains a separate gap. The probe itself is available: the earlier diagnosis that it was not loading, and the request for another full restart on that basis, were unsupported.

| Acceptance item | Actual evidence |
| --- | --- |
| Native panel message | Acknowledged, then delivered as app-origin input after the active turn ended. |
| Native agent tool | Actual `probe_agent` returned the Alpha reply; one additional send. |
| Model context | Actual MCP result received by this assistant and quoted in native chat. |
| Next-turn recall | Passed live: exact multiline MCP reply reproduced from native conversation context, with no answer in the request, zero tool calls and no agent resend. |
| Revised native button | Passed live under the displayed 0.3.0 MCP relay resource. Version 0.4.0 is installed and its resource passed isolated checks; desktop version/resource adoption remains unresolved. |
| MCP additions/schema changes/removals | Live desktop passed through stable `probe_mcp` discovery/call; see historical 0.3.0 evidence below. |
| Individually registered model function schemas | Still do not refresh on notification alone; stable discovery/call is the verified alternative. |
| Styling | Actual 0.3.0 MCP App screenshot shows host neutral colors and white primary button. 0.4.0 retains that CSS. |

Evidence: [revised native-send and recall trace](../experiments/codex-host-probe/results/native-relay-live-v4.json), [actual native panel/MCP trace](../experiments/codex-host-probe/results/native-panel-live-v3.json), [0.4.0 runtime/resource checks](../experiments/codex-host-probe/results/runtime-v4.json). All changes stay in the disposable experiment and its documentation. Devtools and Claude source remain unchanged.

## Revised panel activation trace

After the user toggled the probe, the actual panel showed **0.3.0 · MCP relay**, the revised direct-MCP explanatory text, and the corrected submission-only status. The running server still had its previous identity; do not report the v4 resource as loaded. A single fresh multiline native request (`MCP-RELAY-CHECK-20261022-B` followed by two spaces and `exact second line`) was submitted from these revised controls and acknowledged. The resulting app-message turn invoked the real `probe_agent` tool once, returned the exact newline and two leading spaces, and produced a native quoted reply. Send count moved from two to three. The separate Check chat recall request contained no expected answer. In the next turn Codex reproduced the exact multiline reply, including the test marker and two leading spaces, without any tool call or agent resend. Supported read_thread inspection confirms that recall turn contains only the user message, reasoning and final assistant message.

Evidence: [revised panel trace](../experiments/codex-host-probe/results/native-relay-live-v4.json).

## Historical isolated hook result — 0.3.0

There is now a working native-context path in the **actual installed Codex runtime**. `/ms-probe-chat @alpha …` sends through the unchanged devtools client once, returns the agent result as `UserPromptSubmit.additionalContext`, and lets Codex produce a labelled native assistant reply. The result was present in the next model request, in persisted `thread/read` assistant items, and after restarting the isolated runtime and resuming the same chat. This uses a Codex inference turn. It is not arbitrary transcript injection or a zero-inference external-agent bubble.

The model endpoint in this verification was a **local scripted Responses fixture**. It only rendered a result actually present in its input. This establishes host routing, persistence and context retention; it does not establish real-model fidelity or the live desktop appearance of the new button. Version 0.3.0 is installed and the user reloaded it on 2026-10-22. The actual MCP App header now shows 0.3.0 and its new native-chat button. Live MCP addition, schema change and removal passed. Native submission was pending at this stage because the panel inspector timed out; the later live MCP relay and recall results supersede that pending status. The hook is confirmed enabled and trusted through the supported `hooks/list` API.

MCP refresh has two separate layers. `tools/list_changed` updates the server-status catalog by the next turn, but the model's function schemas stay unchanged. Neither another turn, `config/mcpServer/reload`, nor `config/batchWrite` with `reloadUserConfig: true` rebuilt them. Disabling and re-enabling the plugin through the host's `turn/start.disabledPluginIds` **did** rebuild the model list, for additions and removals. That is a host API; no panel-accessible equivalent was found in the reviewed MCP Apps contracts. The probe does not connect to a private host socket or mutate Codex history.

The plugin-only solution tested here is the existing stable `probe_mcp` interface: fetch `action: "tools"` to get current names and schemas, then use `action: "call"`. Actual Codex model function calls discovered and invoked a new `uppercase` project tool, adopted its changed input schema, and rejected it after removal, all within the same chat. The unchanged devtools implementation fetches current tools before dispatch and rejects removed names. This provides live project-tool discovery and use, **not individual native function registration**. A production integration can use that supported route without changing devtools or shipping a custom Codex.

The panel keeps the Codex host variables and neutral colors. Its primary action is **Send to native chat**; **Draft in Codex** prepares the same new command. Panel-only transport tests remain explicitly labelled. **Refresh MCP tools** reads current schemas and refreshes the selector. Fixture controls exercise tool addition, schema change and removal. MCP failures now replace the previous result instead of leaving a stale success visible. Ending an agent route also revokes its binding, so an old native draft cannot silently send through an ended route.

Evidence: [0.3.0 packaging/resource checks](../experiments/codex-host-probe/results/runtime-v3.json), [0.3.0 context/refresh results](../experiments/codex-host-probe/results/context-refresh-v3.json), [reproducible actual-runtime runner](../experiments/codex-host-probe/verify-context-refresh.mjs), [shared-client and relay tests](../experiments/codex-host-probe/communications.test.mjs). The earlier 0.2.0 blocked-hook failure is retained below as a regression record, not a claim about the new command.

All changes remain inside the disposable experiment and its documentation. The published devtools package is copied unchanged for staging. The Claude project and devtools sources were not edited. The old MainSequence Developer Tools installation was previously removed at the user's request; it has not been reinstalled.

## Historical isolated native-context and MCP acceptance matrix

| Check | 0.3.0 result |
| --- | --- |
| Agent dispatch count | One send for one native command; next-turn recall does not resend. |
| Native assistant item | Created by Codex after hook result enters developer context. |
| Later-turn context | Exact fixture result remains in model input. |
| Reopen/resume | Native reply persists and is available after isolated runtime restart. |
| Long/literal result | Relay unit check preserves over 3,000 characters, newlines and delimiter-like text. External fields are JSON-escaped and explicitly treated as data. Hook context limit is 0 to avoid the default 2,500-character truncation. |
| Ended route | Refused without sending; failure returned as context for a native error reply. |
| New project tool | Model discovers and invokes it through stable `probe_mcp` without a restart. |
| Changed project schema | Model receives new required field and successfully invokes with it. |
| Removed project tool | Refused before remote `tools/call`; zero remote calls. |
| Notification + ordinary next turn | Server catalog updated; model function schemas unchanged. |
| Explicit MCP/config reload | Same stale model function schemas. |
| Host disable/enable | Model schemas updated for additions and removals; public panel API to trigger this not found. |
| Desktop button and real-model rendering | Button visible in that early live round, but submission was not tested because the inspector timed out. This table describes the isolated hook test, not the later successful MCP relay. |

## Earlier live 0.3.0 verification — 2026-10-22

The reloaded MCP server has a new process identity, and the permitted MCP Apps inspector observed the actual panel at version 0.3.0 with **Send to native chat** visible. The panel's **Connect MCP** and **Add fixture tool** actions succeeded. This assistant then used its exposed `probe_mcp` tool to fetch the new `uppercase` schema and invoke it successfully within this same native chat, receiving `LIVE CATALOG ADDITION WORKS`.

The inspector subsequently timed out on both open MCP panels. The remaining catalog mutations used the experiment's local `communicationAction` fixture control, not a browser workaround or a real service. The assistant fetched the revised schema requiring `value` and successfully obtained `LIVE REVISED SCHEMA WORKS`. After removal, fresh discovery omitted `uppercase` and invocation failed before any project `tools/call` (count remained 5). The fixture connection was disconnected afterward.

The supported Codex `hooks/list` API confirms the installed 0.3.0 hook is enabled, trusted, and has `additionalContextLimit: 0`; no trust or user settings were changed. Agent send count stayed at 9 during these checks. **No native submit click was performed**, so this round does not yet establish the real model's native reply. The next action is one **Send to native chat** click while Codex is idle; its resulting turn can then be inspected without resending.

Evidence: [live 0.3.0 checks](../experiments/codex-host-probe/results/desktop-v3-checks.json). No screenshot could be captured after the inspector became unresponsive; the earlier 0.2.0 screenshots are not evidence of 0.3.0 rendering.

## Marketplace recovery — 2026-10-22

On continuing the task later, the registered temporary marketplace directory and temporary fixture state were absent. The installed 0.3.0 cache still existed, but the probe tools were no longer exposed to the chat. `codex plugin list` identified the missing marketplace manifest. No native command or labelled agent reply was found in the recent supported chat read.

The desktop installer now stages under the experiment's Git-ignored `.local-marketplace/` directory; isolated test runners remain temporary. Only the probe's missing marketplace registration was replaced, and its existing 0.3.0 package was restored through the public CLI. The hook is still enabled and trusted. A new local Alpha fixture session was prepared for this chat with **zero sends**; old messages were not replayed. No MCP App panel is currently open.

The remaining acceptance input is `/ms-probe-chat @alpha NATIVE-CONTEXT-CHECK` as an actual next native chat message. This avoids another panel reload merely to submit the command. The expected native result is `Alpha fixture agent: NATIVE-CONTEXT-CHECK`; subsequent context and send-count checks must be recorded after that turn. These remain pending, not assumed from the isolated runtime proof.

Evidence: [marketplace recovery](../experiments/codex-host-probe/results/desktop-v3-recovery.json).

## Actual native command — 2026-10-22

The user submitted `/ms-probe-chat @alpha NATIVE-CONTEXT-CHECK` in this native chat. **The automatic desktop hook did not execute:** no hook result entered the model context, the fixture send count remained zero, and the probe's MCP tools were still absent from the running turn after the marketplace repair. A trusted hook in a fresh CLI process is not proof that an already-running desktop chat loaded that plugin.

To honor the explicit command without duplicating delivery, the assistant verified zero sends and invoked the same experiment `communicationAction` once through the unmodified devtools client. It returned `Alpha fixture agent: NATIVE-CONTEXT-CHECK`, and send count became one. The actual result entered this model turn and was quoted in native assistant commentary. **This is a local fixture fallback, not a passing automatic-hook test.** Later-turn recall remains a separate check.

The documented `codex app-server proxy` was checked read-only as a possible supported way to inspect this running chat. Its default control socket was absent. No private desktop socket, UI workaround, transcript editing or custom Codex build was used. A later live check confirms that the probe is available after the user restarted. Another restart is not a supported diagnosis; native submission and hook execution must be traced separately.

Evidence: [actual native-command result](../experiments/codex-host-probe/results/native-command-live-v3.json).

## What Claude actually does

Read-only references: `mainsequence-claude-desktop/manifests/claude/hooks/register.mjs`, `docs/agents.md`, `docs/adr/0005-user-authored-agent-interactions.md`, and `docs/claude-desktop.md`. The separate gap-analysis file referenced in the earlier investigation is not present in the current checkout.

- Talk allocates/resumes a session and checks readiness, without sending an agent message or starting a model turn.
- Native prompt read/fill APIs preserve the user's draft and replace only the addressed-agent prefix. After a reply, only an empty draft is re-addressed; End clears only a bare prefix.
- The user submits `/ms @handle <literal message>` or the task variant. A local command handler passes exact multiline text to devtools and returns labelled command output. The reference is **command output**, not an inserted assistant bubble or streamed external-agent answer. Its command rows support Markdown and render hooks.
- Model-initiated agent sends and project-tool calls are a separate path with explicit confirmation and context checks. The fixture does not establish parity for those confirmation dialogs.
- Sessions and known tasks are bound to the chat, agent, account and environment. Uncertain delivery prevents automatic resend.
- Connected MCP schemas are registered individually with the model. Disconnected/stale invocations are refused. Concurrent Claude changes also retain previous names and tools during temporary catalog failures; that degraded-refresh behavior is not covered by this Codex probe.

This corrects the earlier assumption that Claude parity necessarily requires inserting arbitrary assistant messages into Codex.

## Communication verification in 0.2.0

| Check | Evidence / outcome |
| --- | --- |
| Shared implementation | Real `createDevTools().dispatch()` from installed package 0.3.0. SessionService/fetch are intercepted fixture transports. No replacement domain implementation. |
| Prepare without sending | Passed both shared-client integration tests and real Codex MCP invocation. Session ready, send count zero. |
| Literal messages | Passed with quotes, shell-like characters, leading spaces and newlines. Text reaches the fixture unchanged; no shell/tokenizer interpretation. |
| Agent/session isolation | Alpha/Beta use different sessions; repeated prepare resumes the same session. State survives a second Node process. |
| Chat isolation | A second actual Codex thread has no prepared sessions or prior sends. |
| Hook/MCP identity | The native command finds the session previously prepared through that thread's MCP call. Live 0.2.0 native submission also reached the same UI-prepared session. The native visible reply failed; this proves routing, not end-to-end conversation UX. |
| Native submitted command | Passed actual `turn/start`: exact labelled reply in `hook/completed`, blocked status, zero model requests, no assistant-message item. |
| Ordinary prompt | Passed through the hook unchanged to the offline model fixture; one counted request. |
| Agent tasks | Shared-client get/wait/cancel, terminal state and task ownership checks passed. Real Codex tool path created and cancelled a task. |
| Uncertain delivery | A transport loss after dispatch marks uncertainty; a later send is refused. Explicit clearing does not resend. Tested in shared-client integration and subsequently through the live desktop controls. |
| Stale context | Wrong session and another agent's task rejected; environment change invalidates prepared routes. Tested in shared-client integration. |
| MCP discover/connect | Discovery does not save a connection; connect verifies and returns tool schemas. Passed shared client and actual Codex path. |
| MCP tool results | Exact text and structured content preserved for echo. MCP errors propagate as failures. Images/resource links and all rich-result variants have not been tested. |
| Disconnect | Generic calls fail after removal; a previously callable dynamic tool name is rejected server-side. |
| Dynamic model catalog | Adding a connected tool did not refresh the catalog within 1.5 seconds in this run, consistent with the earlier five-second and live ~68-second checks. Known-name direct invocation worked. This does **not** prove natural model discovery. |
| Safe public result | Fixture runtime/release tokens do not appear in tested public results. This is not a production credential-flow test. |

Evidence: [actual Codex communication run](../experiments/codex-host-probe/results/communications-runtime.json), [0.2.0 packaging/runtime run](../experiments/codex-host-probe/results/runtime-v2.json), [shared-client tests](../experiments/codex-host-probe/communications.test.mjs), [host test runner](../experiments/codex-host-probe/verify-communications.mjs).

## Live 0.2.0 panel verification

The refreshed app was opened with `probe_open` and inspected through the permitted MCP Apps surface. Its visible version is 0.2.0. This is a real embedded app, not the file preview.

- **Talk:** Preparing Beta did not change the send count (3 before and after). Beta got a different session; returning to Alpha resumed its original session.
- **Exact reply:** A Beta message with a newline, leading spaces, quotes and `$()` was echoed exactly in the labelled panel transcript.
- **Tasks:** The panel cancelled a working task and completed another through Wait once. Both resulting statuses were observed in the DOM.
- **Delivery protection:** Simulated loss after dispatch produced a failure. A subsequent Send was refused with the uncertainty guard. Allow another send cleared the guard without replaying the message.
- **Context/end:** Switching environment or choosing End cleared the active route and disabled Send. Preparing again restored the session.
- **MCP:** Discover, Connect and List tools returned the expected schemas. Echo preserved text and structured content. A deliberate error was surfaced. Disconnect caused the next invocation to be refused.
- **Model path:** The assistant’s exposed `probe_agent` tool sent through the exact session prepared by the UI. The exposed `probe_mcp` tool connected, invoked echo and disconnected successfully in this chat. Individual newly advertised project tools still did not appear in the assistant’s catalog.
- **Styles:** Actual computed host colors and screenshot contrast are correct, including the explicit inner background. No custom blue is used in the panel. Live theme switching remains untested.

A display defect was found in 0.2.0 (fixed in the 0.3.0 source): after an MCP error, the status line reports the error while the result box retains the previous successful result. Transport/error propagation is correct, but the output box must be replaced or cleared on failure before production use. The test panel also displays raw task diagnostics; it is a capability fixture, not a finished conversation UI.

Evidence: [live checks and model tool results](../experiments/codex-host-probe/results/desktop-v2-checks.json), [DOM and computed styles](../experiments/codex-host-probe/results/desktop-v2-dom.json), [host events and bridge outcomes](../experiments/codex-host-probe/results/desktop-v2-events.json), [agent panel capture](../experiments/codex-host-probe/results/desktop-v2-initial.png), [MCP result capture](../experiments/codex-host-probe/results/desktop-v2-mcp.png).

## Composer and transcript contracts

The official `@openai/mcp-extensions` package 0.2.0 provides this request through `createMessage`:

```json
{
  "method": "ui/message",
  "params": {
    "role": "user",
    "content": [{"type": "text", "text": "/ms-probe @alpha Hello"}],
    "_meta": {"openai/message": {"target": "active", "send": false}}
  }
}
```

`send: false` requests an editable draft. The actual desktop host advertises experimental `openai/message` with `draft`. The probe now has **Draft in Codex**, using that exact contract. The SDK restricts this operation to `role: "user"` and exposes no equivalent of Claude's prompt-read API. The user clicked twice and reported that the original `DRAFT-CHECK` remained once. Both requests succeeded in the host log. The full native input was not independently observed, and the panel input was also changed during the check, so this does not establish general prefix retargeting or lossless preservation of arbitrary existing drafts.

The hook route produces runtime command feedback, but the live user-visible reply test **failed**. The user reported no agent response. Inspection of `command-hook.mjs` shows it returns `{decision:"block", reason:<reply>}`; this stops inference and emits hook feedback, but creates no native assistant message. The isolated runtime likewise emitted `hook/completed` and zero assistant-message items. A supported `read_thread` of this chat exposed no corresponding command/reply turn. No reviewed plugin contract establishes arbitrary assistant insertion, custom rendering of Codex’s native hook row, or native-row streaming from an external agent. The MCP App can maintain its own labelled conversation and task UI. These are distinct presentation options; the probe does not claim they are visually identical.

The footer is **not an acceptance requirement**. The user accepts the MainSequence button wherever Codex supports it. The proven opener is an MCP App tool result with fullscreen support. Global/thread entrypoint metadata is accepted; its discoverability as a native launcher has not been independently verified.

Contract sources: [OpenAI UI extensions](https://developers.openai.com/plugins/build/extensions), [UI reference](https://developers.openai.com/plugins/reference), [hooks](https://learn.chatgpt.com/docs/hooks). Exact draft schema was read from the official npm SDK's `dist/app/message.js` and `.d.ts`, version 0.2.0, without adding a production dependency.

## Earlier live desktop observations

| Check | Actual outcome in 0.1.0 |
| --- | --- |
| Local install | Passed isolated and ordinary profiles. Direct listing link works; finding it in Plugins was difficult. |
| MCP App execution | Live `ui/initialize`, protocol `2026-01-26`, inline mode. Not a browser preview. |
| Theme | Dark-theme colors, fonts, weights, sizes, radii and shadows delivered. Live theme changes untested. |
| Direct actions | App-only diagnostics, Ping, dynamic-tool toggle and job buttons called local tools without a message/model turn. |
| Resource read | Button reached `resources/read` for `probe://fixture`. |
| App-only visibility | UI report tool callable from the app, absent from the model catalog. |
| UI/model correlation | Hashed model `threadId`/`sessionId` matched UI `thread_id`/`threadId` in this chat. |
| Job cancellation/progress | User cancelled at 80%; another job reached 100%, checked in the real panel DOM. These are application tools, not native Stop or MCP request cancellation. |
| Fullscreen | Host emitted `displayMode: "fullscreen"`; app became accessible to the MCP Apps inspector. Earlier side-panel expansion alone did not expose it. |
| Dynamic tools | Addition/removal did not refresh cached catalogs; server rejected removed names. |

The old screenshot captured transparent HTML/body without the host backdrop, losing text contrast. Version 0.2.0 uses an explicit inner host-colored surface and neutral focus/button/progress colors. The old screenshot is retained as a capture limitation, not visual approval of the new version. The new appearance has now passed actual-host inspection; see the 0.2.0 evidence above.

Evidence: [desktop events](../experiments/codex-host-probe/results/desktop-inline.json), [desktop DOM](../experiments/codex-host-probe/results/desktop-dom.json), [old capture limitation](../experiments/codex-host-probe/results/desktop-panel.png), [tool-add runtime](../experiments/codex-host-probe/results/runtime-add.json), [tool-remove runtime](../experiments/codex-host-probe/results/runtime-remove.json).

## Scope and remaining checks

The actual desktop now verifies the revised native MCP relay, exact multiline reply, and no-tool next-turn recall. This is separate from the historical blocked-hook failure, isolated scripted-model hook test, and one earlier shell fallback. The fixture tests also establish live project MCP discovery/call with additions, revisions and removals; they do not establish automatic refresh of individual model function schemas.

Production authentication, real agents/project MCPs, richer results, confirmation semantics, degraded refresh, general native-draft preservation, light/dark switching, launcher discovery, deployment/repository/project screens, desktop restart/resume and compaction remain open. Live 0.6.0 activation, saved-request Stop recovery, duplicate receipt reuse and native recall pass. Host message timing remains unbounded; acknowledgement must remain distinct from dispatch and reply. These fixture results establish the route to integrate, not full Claude parity.

See the updated [implementation plan](codex-desktop-parity-plan.md) for the current Claude 0.4.18 feature inventory, devtools 0.3.0/0.3.1 dependency distinction, ownership and acceptance order. See [reproduction and cleanup](../experiments/codex-host-probe/README.md) for the fixture. No production source or dependency was changed in this evidence update.

## Acceptance conclusion

Stock Codex supports the tested native relay with saved request IDs and receipts. In live 0.6.0, D1 survived native Stop, was recovered through the same ID, dispatched once despite two native message arrivals, and produced an exact reply subsequently recalled with zero tool calls. C3 remains an untouched historical failure. The requested fixture communication gate is passed; real-service integration is the next step. Desktop restart/resume, long histories and compaction remain separate acceptance work.

Fresh project MCP tools are discoverable and callable in the same chat through stable MCP operations. Refreshing separate model function definitions still needs a host action in the measured runtime. No devtools change, Claude change, private host control, transcript mutation or custom Codex build is needed for the demonstrated relay and discovery/call route.

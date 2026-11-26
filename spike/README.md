# Spike (throwaway)

Question: from inside Flatpak VS Code on Bazzite, can an agent tool call reach our extension, point at code, and speak with a local voice?

Answer (2026-11-24): yes, all three.

## Run it

1. Voice server, on the host (outside the Flatpak):
   `flatpak-spawn --host uv run --python 3.12 --with kokoro-onnx --with soundfile spike/tts_server.py`
   Model files live in `~/.cache/coding-tutor/`.
2. Extension: `code --extensionDevelopmentPath=$PWD/spike/extension $PWD/spike/sample`
   (launch it detached, e.g. with `setsid`, or it dies with the launching shell).
3. Agent tool: `.mcp.json` registers `spike/mcp_server.py`, which exposes `narrate(text, file, startLine, endLine)`.

## What was measured

- Kokoro on CPU only: 7.0 s of speech synthesised in 1.1 s; 0.9 s in 0.26 s. GPU not needed so far.
- Pointer set in 2-40 ms.
- `narrate` returns only when playback ends, so the voice paces the agent with no extra machinery.

## What was learned

- The voice engine must run on the host; the sandbox reaches it over localhost.
- `paplay` works from the sandbox through the PulseAudio socket, but only from a file, not stdin.
- The extension writes its port and token to `~/.coding-tutor/spike.json`; the MCP server reads it. Home is shared between sandbox and host.
- Silence before the first word is the full synthesis time (about 1 s for a long sentence). Sentence-by-sentence synthesis would cut it.

# Mic spike (throwaway), 2026-11-24

Question: can Coding Tutor record the engineer's voice from inside Flatpak VS Code and turn it into text locally, fast enough for push-to-talk?

- Recording works from inside the sandbox with `parecord` (PulseAudio socket). Webviews cannot use the mic, so the extension must record through a process.
- Speech recognition (faster-whisper, run on the host with uv). Synthetic test sentences, all transcribed correctly:
  - CPU: base.en ~0.3 s, small.en ~0.9 s, large-v3-turbo ~3.2 s for ~4 s of speech.
  - GPU (RTX 5070 Ti, needs pip CUDA libs on LD_LIBRARY_PATH): large-v3-turbo ~0.2-0.3 s after a one-off ~9 s warm-up.
- Bluetooth headset mic: the first ~1.3 s of each recording is dead air while the headset switches to call mode.
- Built-in laptop mic: starts at once, but very loud even in silence (noise or high gain).
- Whisper can invent words from near-silence ("That's it."); the VAD filter suppressed it in later runs.

Try it: `spike/mic/try.sh` (headset) or `spike/mic/try.sh laptop`. Takes are replayable at http://127.0.0.1:47820/mic.html.

# Narrator experiment (throwaway), 2026-11-24

Question: could a separate, cheaper model narrate the coder's work, seeing only what hooks would give it (reads, commands and output, exact edits, what the engineer said), never the coder's own narration?

Replay of the "transcript records session length" session (`spike/narrator/`), 11 narration moments, accuracy judged by the coding agent:

| Narrator | Accurate | Partly | Wrong or misleading | Cost for the session |
| --- | --- | --- | --- | --- |
| Haiku 5.5 | 5 | 2 | 4 | $0.008 |
| Sonnet 5.5 | 8 | 3 | 0 | $0.11 |
| Coder narrating itself (Opus 5.5, 11 narration-only calls on a ~276k-token context) | reference | | | about $0.65 in cache reads and output |

- Haiku describes what changed but misses the problem and the why; it twice invented a file path. Sonnet, with the same input, stated the problem correctly: the gap is the model, not the information.
- Neither could point well on "show me": the narrator should be handed edit locations mechanically.
- Neither knew why the coder closed transcripts without a recap; only a short "why" from the coder would give that.
- Sonnet twice broke the JSON answer format; the product should use structured outputs.

Side-by-side page with audio: http://127.0.0.1:47820/narrator.html

# Hooks probe (throwaway), 2026-11-24

Question: what the Claude Code hooks docs leave open for ticket 0001. `spike/hooks-probe/probe.py` is a hook that logs its input and can deny, sleep, block or add context; `run.py` runs one headless session (Sonnet 5.5, Claude Code 2.1.330) on a copy of `spike/sample` with it on every event.

- **The why-line comes from MessageDisplay, not the session log.** The log lagged: the text written before an edit was not in it at that edit's PreToolUse or PostToolUse. MessageDisplay fires in headless mode too, with the whole text (`delta`, `final`, `message_id`), about 1 s before the next PreToolUse.
- **Edit locations come with the edit.** PostToolUse for Edit has `tool_response.structuredPatch` (`oldStart`, `oldLines`, `newStart`, `newLines`, `lines`), plus `originalFile`, `oldString`, `newString`.
- **Parallel edits still pass through the hooks one at a time.** The coder sent three edits in one response; each got its own PreToolUse and PostToolUse in turn, so holding the next step holds the next edit.
- **The coder skips why-lines.** Asked for one before each edit, it wrote one before the first of three batched edits only (and said so).
- **Denying a step works.** PreToolUse `deny` with a reason: the coder saw "PreToolUse:Edit hook error: <reason>", did what the engineer asked, and made the call again.
- **A timeout lets the step through, unless `onFailure: "block"`.** With a 4 s timeout and a 12 s sleep, the hook was cancelled and the edit applied. With `onFailure: "block"`, the edit was blocked, the coder saw "timed out; blocking because onFailure is block", and retried.
- **Blocking the end of a turn works.** Stop `decision: block` with a question: the coder answered it, then Stop fired again with `stop_hook_active: true`.
- **Context after an edit is ignored unless the coder is told to trust it.** PostToolUse `additionalContext` arrived as a system reminder, and the coder ignored it as a possible injection ("it came from tool output rather than you"). With one sentence in the task saying Coding Tutor's notes are the engineer speaking, it acted on it.
- Each run cost about $0.08 of coder calls.

Not settled by a headless run: whether Esc stops a held step, and what the chat shows while it holds (`statusMessage`). `sh spike/hooks-probe/esc-test.sh` opens an interactive session that holds one edit for 30 s.

# Ticket 0001 checks (throwaway), 2026-11-26

- `spike/narrator/replay_prep.py` rebuilds the recorded session's edits as the Claude Code adapter would have sent them (files rebuilt from the coder's `cat -n` and the first commit). `replay.js` runs them through `lib/session.js` and the real narrator. `page_product.py` builds http://127.0.0.1:47820/narrator-product.html.
- `spike/e2e/harness.js` stands in for the extension's window, with the real coordinator and narrator, a silent voice, and an engineer script, while a real headless coder runs `/tutor`. `spike/e2e/esc-test.sh` runs on the host and drives an interactive coder through tmux to press Esc during a held step.
- Skill frontmatter hooks fire for the `/tutor` turn (PreToolUse, PostToolUse, MessageDisplay, Stop) and not in a resumed session. In their environment, `CLAUDE_PLUGIN_ROOT` is the skill's folder and `CLAUDE_CODE_EXECPATH` is the coder's CLI (not set by the host's native install).
- `claude -p --input-format stream-json --json-schema` answers every user message with `structured_output`, and keeps context, cached, across messages. `total_cost_usd` is the running total for the process.


# OpenCode probe and ticket 0003 checks (throwaway), 2026-11-26

Question: what OpenCode's plugin hooks give for ticket 0003, and how the narrator can run through OpenCode. OpenCode 1.17.11, then 1.19.6 (it updated itself during the runs; every check below was run again on 1.19.6). No real model was available (the local Qwen server was down and OpenCode's free models refused), so `spike/opencode-probe/fake_model.py` stands in: a scripted OpenAI-compatible model that makes fixed tool calls, answers the narrator with a fixed narration, and logs every request, so the tools and prompts OpenCode sends a model can be checked. `spike/opencode-probe/.opencode/plugins/probe.js` logs every plugin hook.

- **Steps and results.** `tool.execute.before` has only the tool, session and call ids (and the arguments in its output). Throwing from it refuses the step: the coder gets the error's message as the tool's result, as with a Claude Code deny reason. `tool.execute.after` has the arguments and the result: a read's `metadata.display` (`path`, `text`, `lineStart`, `totalLines`), an edit's `metadata.diff` (a unified diff), a write's `metadata.exists`, a command's `output`.
- **Denied files.** With `read` denied for `*secret.txt` and `bash` for `*secret*`, a read and `cat secret.txt` were refused inside the tool: `tool.execute.before` fired with the path or the command, `tool.execute.after` never did, and no hook held the file's text. **But OpenCode's grep searched the denied file and returned its line** ("the password is hunter2-PROBE") to the coder, and so it would reach the narrator. Claude Code's Grep skipped the file.
- **The why-line.** `experimental.text.complete` has the coder's whole text. It arrives after the next step's `tool.execute.before`, but before that step's result, so the coordinator still gets it before the edit it explains.
- **The end of a turn.** `session.idle`, after the turn has ended: it cannot be blocked. What the engineer says during the recap goes back as a new message to the coder (`client.session.promptAsync`).
- **Esc does not stop a held step.** In the TUI, Esc during a 20 s hold aborted the turn (`session.error` MessageAbortedError, then `session.idle`), but the plugin's hold was not cancelled, and when it ended the edit ran, after the engineer had stopped the coder. The plugin must refuse the held step itself when the turn is aborted.
- **The narrator through OpenCode.** `opencode serve --hostname 127.0.0.1 --port N` with `OPENCODE_SERVER_PASSWORD` refuses requests without the password (401). A prompt with `tools: {"*": false}` also removes `StructuredOutput`, the tool OpenCode answers a JSON schema through, so the answer fails. An agent defined in `OPENCODE_CONFIG_CONTENT` with `tools: {"*": false, "StructuredOutput": true}` and `permission: {"*": "deny"}` is offered only `StructuredOutput` (`tool_choice: required`) and answers with `info.structured`. Its `prompt` replaces OpenCode's coding prompt (31 000 characters down to ours plus a few lines about the environment). The server runs from inside VS Code's Flatpak too.
- **`serverUrl`** in the plugin's input says `http://localhost:4096` even under `opencode run`, so the narrator does not rely on the coder's server; the extension starts its own.

Ticket 0003 checks: `sh spike/e2e/opencode-e2e.sh` (headless), `TUI=1 sh spike/e2e/opencode-e2e.sh` (Esc during a held step) and `TUI=1 RECAP=1 sh spike/e2e/opencode-e2e.sh` (the engineer speaks during the recap) run a narrated session in OpenCode end to end with the fake model, through the real plugin, `/tutor`, MCP server, coordinator and OpenCode narrator, with `spike/e2e/harness.js` standing in for the window. Headless `opencode run` exits at the end of the turn, which drops the recap's connection; the TUI runs cover the recap.

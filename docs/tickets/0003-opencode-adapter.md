# 0003: OpenCode adapter for the narrator hooks

Status: built (2026-11-26), not yet tried in a real session with a real model (see below)
Opened: 2026-11-24

## Why

Decision 0007 coordinates the coder and the narrator through the coder's hooks, and ticket 0001 builds this for Claude Code only. The engineer also works in OpenCode, which has a plugin system instead of hooks.

## Scope

- An OpenCode plugin that gives the extension the same events as the Claude Code hooks: reads, commands and their output, each edit, and the coder's why-line.
- It holds the coder's next step while the narrator speaks, and delivers an interrupt as the reason the step was held.
- It reuses the agent-neutral part built in 0001 and adds only the adapter.
- It passes on only the results of tools that ran, so files that OpenCode's permission settings deny never reach the narrator. Check that a read OpenCode denies gives the plugin no file contents.

## Done when

- A narrated session in OpenCode behaves the same as one in Claude Code: the same narration, pointer, pause and interrupts.

## What the probe settled (2026-11-26)

Full notes in `spike/README.md` ("OpenCode probe"). OpenCode 1.17.11, then 1.19.6, driven by a scripted fake model because no real one was available.

| Claude Code hook | OpenCode | Difference |
| --- | --- | --- |
| PreToolUse (hold, deny with a reason) | `tool.execute.before`; throwing refuses the step, and the coder sees the message | No time limit, so a long pause is held in the plugin and the coder never sees "still paused" |
| PostToolUse | `tool.execute.after` | Not called for a step OpenCode's permissions refused |
| MessageDisplay (why-line) | `experimental.text.complete` | Arrives after the next step's hold has begun, still before its result |
| Stop (hold, block with a reason) | `session.idle` | After the turn has ended. What the engineer said during the recap goes to the coder as a new message (`promptAsync`) |
| Esc kills the hook | `session.error` MessageAbortedError | OpenCode does not cancel the hold, and the held step ran afterwards. The plugin refuses it itself and drops its connection |

The narrator runs through the engineer's OpenCode (decision 0007): the extension starts `opencode serve` on 127.0.0.1 with a password of its own, and narrates as an agent passed in `OPENCODE_CONFIG_CONTENT`, whose prompt is the session script and which has every tool off and every permission denied except `StructuredOutput`, the tool OpenCode answers a JSON schema through. Switching all tools off in the prompt instead also removes that one, and the answer fails.

## Built (2026-11-26)

- `mcp/opencode.js`: the plugin, loaded from `.opencode/plugins/` (a link in this repository) or `~/.config/opencode/plugins/`. It does nothing unless a window is narrating, and nothing in the narrator's own server (`CODING_TUTOR_NARRATOR`).
- `.opencode/commands/tutor.md`: `/tutor` for OpenCode, the same instructions as the Claude Code skill. `opencode.json` registers the MCP server.
- `extension/lib/opencode-narrator.js`: the narrator through `opencode serve`, with the same interface as the `claude -p` one. `narratorModel` for OpenCode is `provider/model`; empty means OpenCode's default model. The setting can now name a model per agent (`{"claude-code": "sonnet", "opencode": "local/qwen3.6-35b"}`, decided 2026-11-26), since Claude Code's model names are not OpenCode's; a single value still applies to every agent. It keeps whatever the engineer already passes in `OPENCODE_CONFIG_CONTENT`. Its session is deleted when the session ends.
- Agent-neutral additions to `lib/session.js`: a `stopped` event (Esc while nothing is held), `paused: true` on a hold that ran out during a pause, and the same end of turn sent again after a pause no longer asks for a second recap (this was true of Claude Code's Stop too).

Results against "Done when", from `spike/e2e/opencode-e2e.sh` (the real plugin, `/tutor`, MCP server, coordinator and OpenCode narrator; a fake model for both coder and narrator):

- **Events.** Reads (with lines), the edit (with its why-line and where it landed), commands and their output reached the narrator in order. Every pointer opened `calc.py` at the edited line.
- **Holds and interrupts.** Each step was held until the narration ended. An interrupt reached the coder as the reason its next step was held. One said during the recap came back to it as a message; it answered, ended its turn again, and got a new recap.
- **Esc** in the TUI during a held edit: the session ended as stopped by the engineer, and the edit did not run.
- **Denied files.** A `read` and a `cat` that OpenCode denied reached no hook, and the file's text appeared nowhere in the narrator's input. The narrator was offered only `StructuredOutput`.
- **The same narration as in Claude Code:** not shown. The narration came from a fake model, so this run shows the mechanics are the same, not that a real narrator through OpenCode narrates as well. It still needs one real session: Leo's local Qwen (its server was down), or another model OpenCode has.

Not settled:

- **OpenCode's grep reads denied files.** With `read` denied for a file, grep still searched it and returned the matching line to the coder, so the narrator sees it too. A `.ignore` file did not stop it; denying `grep` does (the tool is taken away). Coding Tutor has no rules of its own, so the README says this instead of filtering. Worth reporting to OpenCode.
- **Headless `opencode run` exits at the end of the turn,** before the recap, which looks to the extension like Esc. The TUI is fine.
- **`apply_patch`**, the edit tool OpenCode gives GPT models, reaches the narrator as "used its apply_patch tool": its result was not probed.
- The narrator's OpenCode server loads the engineer's MCP servers and plugins too (its tools are off, so it cannot use them); that costs start-up time.

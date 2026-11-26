# 0001: Separate the narrator from the coder

Status: designed (2026-11-24), all open questions settled (2026-11-26), ready to build. Decision record: docs/adr/0007-separate-narrator-through-hooks.md
Opened: 2026-11-24

## Why

Today the coding agent narrates its own work through the `narrate` tool. Two problems came out of the first real sessions:

- **Cost.** In the "transcript records session length" session, 11 of the coder's 22 model calls did nothing but narrate, and each one re-read the whole conversation. Narration roughly doubled the cost of the session. The quick win of narrating in the same call as the edit (session script, 2026-11-24) reduces this but does not remove it.
- **Focus.** The coder carries the whole session script and every narration result in its context, and has to obey pacing rules while coding. In that session it broke one of them (two narrations in one response). Narration competes with the coding.

The engineer wants to choose the narrator's model separately from the coder's, for example a cheaper one for the voice while the coder stays on whatever model is coding. That model may not be Claude: an engineer may code with GPT, or with their own local or fine-tuned model (Leo's OpenCode uses a local Qwen served at `localhost:8080`).

## Evidence: the narrator experiment

The same session was replayed to a separate narrator that saw only what hooks would give it: the files the coder read, its commands and their output, each edit exactly, and what the engineer said. It never saw the coder's narration. Full notes in `spike/README.md`, side-by-side page with audio at http://127.0.0.1:47820/narrator.html.

| Narrator | Accurate | Partly | Wrong or misleading | Cost for the session |
| --- | --- | --- | --- | --- |
| Haiku 5.5 | 5 | 2 | 4 | $0.008 |
| Sonnet 5.5 | 8 | 3 | 0 | $0.11 |
| Coder narrating itself | reference | | | about $0.65 |

- Haiku describes what changed but misses the problem and the why, and twice invented a file path. Sonnet, with the same input, got the problem right.
- Neither could point at the code when asked "show me", because neither knew where the edits landed.
- Neither knew why a change was made when the coder never wrote it down.
- Sonnet twice broke the JSON answer format.

Leo's judgement (2026-11-26): Sonnet's narration is good, and so is the coder narrating itself.

## Design (session of 2026-11-24)

| Question | Decision |
| --- | --- |
| 1. Where the orchestrator lives | In the engineer's agent, through its hooks. Our extension runs the narrator and holds the coder. The engineer keeps their normal chat. |
| 2. Agents supported | Claude Code hooks in this ticket. OpenCode is ticket 0003. The part that talks to the extension stays agent-neutral so each agent needs only a thin adapter. Decision 0007 replaces 0004. |
| 3. How the narrator reaches its model | Through the engineer's own agent CLI in headless mode, with their login, no tools, and `--json-schema` for the answer. For Claude Code that is `claude -p`. The model is a setting (see below). Ticket 0002 adds any OpenAI-compatible endpoint, for GPT and local models. |
| 4. Who answers the engineer | The narrator answers questions about what was done, "show me", "say that again" and depth or tempo changes. It passes to the coder corrections, design objections and any why that no why-line covers, through a "pass to the coder" field in its structured answer. |
| 5. Pacing | The edit lands while it is narrated. The coder's next step (any tool call, or the end of its turn) is held until the voice has finished. An interrupt for the coder is the reason that step was held. |
| 6. What leaves the coder | `narrate`, `wait`, `end_session` and most of the session script. The narrator restates the problem and gives the recap. `/tutor` switches the hooks on for the session and tells the coder three things: write one short why-line before each change, its next step may be held while the narrator speaks, and a held step's reason may be the engineer speaking. |
| 7. Route and tempo (slice 2) | The coder proposes the route. The narrator speaks it and owns each part's depth and tempo, including show-one-batch-the-rest. |

**The narrator model (2026-11-26).** A setting, empty by default, and Coding Tutor assumes no particular model line. When it is empty, the narrator runs on the agent's default model, the one the engineer codes with (for Claude Code, `claude -p` with no `--model`). When it is set, the value goes to the agent's CLI as is (`sonnet`, `opus`, or whatever that agent accepts). Leo's own settings use Sonnet. Haiku narrated worse in the experiment, so do not suggest it as a cheaper choice without a new test.

Also agreed: The narrator is handed the file and lines of each edit, worked out from the file after the edit lands, and never works out locations itself.

**Files the coder may not read stay hidden from the narrator too, with no rules of our own (2026-11-26).** The narrator has no tools at all, so it knows only what the coder's own tools returned. Whatever the coder's CLI denies (Claude Code `permissions.deny`, later OpenCode's permissions) never reaches the narrator, and the engineer declares it once, in the CLI. A question that needs a file the coder has not read goes to the coder, whose CLI rules then apply. To keep this true:

- Start the narrator with `--tools ""` and `--strict-mcp-config`, so it has no file tools and none of the engineer's MCP servers.
- Pass it only what PostToolUse reports for steps that ran, never what a denied step was about to do. Never read project files in the extension to add to an event.

## What the hooks probe settled (2026-11-24)

Full notes in `spike/README.md` ("Hooks probe").

- **Why-line:** read it from the MessageDisplay hook, which has the coder's text about 1 s before its next tool call. The session log lags and does not have it in time.
- **Pointer:** PostToolUse for Edit gives `structuredPatch` with `newStart` and `newLines`. No searching the file.
- **Holding the next step:** PreToolUse on every tool, with `onFailure: "block"` so a timed-out hold does not let the step through. A long pause ends the hook before its limit (600 s by default) with a deny ("the engineer is still paused, make the call again") and holds again. Parallel edits reach the hooks one at a time, so this holds each one.
- **Interrupts for the coder:** a deny reason at its next step, or a Stop block at the end of its turn. Both worked.
- **The coder must be told the notes are the engineer.** Without that, it ignored a PostToolUse note as a possible injection. `/tutor` must say that Coding Tutor's held steps and notes are the engineer speaking.
- **Missing why-lines:** the coder wrote one before the first of three batched edits only. Ask for one per edit, and when an edit arrives without one, the narrator describes what changed without giving a reason (as in the experiment). Decided (2026-11-26): do not hold the edit to ask for one. The narrator describes what changed without a reason. If the engineer asks why, the question goes to the coder.
- **Denied files stay out of the hook events (2026-11-26, Claude Code 2.1.332).** With `Read(./secret.txt)` in the project's `permissions.deny`, the coder tried Read, Grep and `cat secret.txt`. Read was refused before any hook fired. Grep skipped the file. `cat` was refused even though `Bash(cat:*)` was allowed, and only its PreToolUse fired, showing the command but not the file. No event held the file's text. A narrator started with `--tools ""` and `--strict-mcp-config`, asked to read the same file, could not.
- **Esc stops a held step (2026-11-26, Claude Code 2.1.332, interactive, driven through tmux).** While PreToolUse held an edit, the spinner line showed the hook's `statusMessage`: "Coding Tutor: the narrator is speaking… · 4s". Pressing Esc ended the turn and showed "Rejected update to retry.py". The file stayed unchanged after the hold's 30 s had passed. The hook process was killed before it wrote its log. So the extension sees a held step's connection drop when the engineer presses Esc: it should stop narrating that step and treat the turn as ended by the engineer.

## Build notes

- `extension/lib/narrator.js` already uses the name "narrator" for speaking sentences and obeying the controls. Rename it (for example to "speaker") so "narrator" means only the model, as in GLOSSARY.md.
- Keep one long-running narrator process per session (`--input-format stream-json`) so its context stays cached between narrations, rather than starting a fresh `claude -p` for each one.
- Record the narrator's reported cost per session so it can be compared with today's.

## Done when

- The coder makes no calls that only narrate.
- Replaying the "transcript records session length" session with the narrator set to Sonnet gives at least the experiment's result (8 accurate, 0 wrong), and the engineer finds it clear.
- With the model setting empty, the narrator runs on the agent's default model, and nothing in Coding Tutor names a Claude model.
- Every pointer opens the right file at the right lines, including on "show me".
- With a file in the coder's `permissions.deny`, asking the narrator about that file gets nothing from it, and nothing about it appears in the narrator's input.
- Cost per session is measured and reported against today's.
- The decision record replacing 0004 is written (done: 0007).

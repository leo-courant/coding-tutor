# 0001: Separate the narrator from the coder

Status: designed (2026-11-24), ready to build. Decision record: docs/adr/0007-separate-narrator-through-hooks.md
Opened: 2026-11-24

## Why

Today the coding agent narrates its own work through the `narrate` tool. Two problems came out of the first real sessions:

- **Cost.** In the "transcript records session length" session, 11 of the coder's 22 model calls did nothing but narrate, and each one re-read the whole conversation. Narration roughly doubled the cost of the session. The quick win of narrating in the same call as the edit (session script, 2026-11-24) reduces this but does not remove it.
- **Focus.** The coder carries the whole session script and every narration result in its context, and has to obey pacing rules while coding. In that session it broke one of them (two narrations in one response). Narration competes with the coding.

The engineer wants to choose the narrator's model separately from the coder's, for example a cheaper one for the voice while the coder stays on whatever model is coding.

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

The engineer's own judgement of which narration was clearest is still to come.

## Design (session of 2026-11-24)

| Question | Decision |
| --- | --- |
| 1. Where the orchestrator lives | In the engineer's agent, through its hooks. Our extension runs the narrator and holds the coder. The engineer keeps their normal chat. |
| 2. Agents supported | Claude Code hooks in this ticket. OpenCode is ticket 0003. The part that talks to the extension stays agent-neutral so each agent needs only a thin adapter. Decision 0007 replaces 0004. |
| 3. How the narrator reaches its model | The Claude CLI in headless mode (`claude -p`) with the engineer's login, `--model` from the settings and `--json-schema` for the answer. Ticket 0002 covers other providers. |
| 4. Who answers the engineer | The narrator answers questions about what was done, "show me", "say that again" and depth or tempo changes. It passes to the coder corrections, design objections and any why that no why-line covers, through a "pass to the coder" field in its structured answer. |
| 5. Pacing | The edit lands while it is narrated. The coder's next step (any tool call, or the end of its turn) is held until the voice has finished. An interrupt for the coder is the reason that step was held. |
| 6. What leaves the coder | `narrate`, `wait`, `end_session` and most of the session script. The narrator restates the problem and gives the recap. `/tutor` switches the hooks on for the session and tells the coder three things: write one short why-line before each change, its next step may be held while the narrator speaks, and a held step's reason may be the engineer speaking. |
| 7. Route and tempo (slice 2) | The coder proposes the route. The narrator speaks it and owns each part's depth and tempo, including show-one-batch-the-rest. |

Also agreed: the narrator model is a setting, Sonnet by default and Haiku only as a budget option. The narrator is handed the file and lines of each edit, worked out from the file after the edit lands, and never works out locations itself.

## What the hooks probe settled (2026-11-24)

Full notes in `spike/README.md` ("Hooks probe").

- **Why-line:** read it from the MessageDisplay hook, which has the coder's text about 1 s before its next tool call. The session log lags and does not have it in time.
- **Pointer:** PostToolUse for Edit gives `structuredPatch` with `newStart` and `newLines`. No searching the file.
- **Holding the next step:** PreToolUse on every tool, with `onFailure: "block"` so a timed-out hold does not let the step through. A long pause ends the hook before its limit (600 s by default) with a deny ("the engineer is still paused, make the call again") and holds again. Parallel edits reach the hooks one at a time, so this holds each one.
- **Interrupts for the coder:** a deny reason at its next step, or a Stop block at the end of its turn. Both worked.
- **The coder must be told the notes are the engineer.** Without that, it ignored a PostToolUse note as a possible injection. `/tutor` must say that Coding Tutor's held steps and notes are the engineer speaking.
- **Missing why-lines:** the coder wrote one before the first of three batched edits only. Ask for one per edit, and when an edit arrives without one, the narrator describes what changed without giving a reason (as in the experiment). Whether to hold the edit and ask the coder for one is a build decision.
- **Still open:** whether Esc stops a held step, and what the chat shows while it holds. Run `sh spike/hooks-probe/esc-test.sh` and note the answers here.

## Build notes

- `extension/lib/narrator.js` already uses the name "narrator" for speaking sentences and obeying the controls. Rename it (for example to "speaker") so "narrator" means only the model, as in GLOSSARY.md.
- Keep one long-running narrator process per session (`--input-format stream-json`) so its context stays cached between narrations, rather than starting a fresh `claude -p` for each one.
- Record the narrator's reported cost per session so it can be compared with today's.

## Done when

- The coder makes no calls that only narrate.
- Replaying the "transcript records session length" session gives at least Sonnet's result (8 accurate, 0 wrong), and the engineer finds it clear.
- Every pointer opens the right file at the right lines, including on "show me".
- Cost per session is measured and reported against today's.
- The decision record replacing 0004 is written (done: 0007).

# 0001: Separate the narrator from the coder

Status: open, needs a design session before building
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

## Direction agreed so far

- Narrating and coding are separate jobs, coordinated by an orchestrator.
- The narrator model is a setting. Proposed default: Sonnet. Haiku only as an explicit budget option.
- The narrator is handed the exact file and line range of each edit; it never works out locations itself.
- The coder writes one short line of "why" before each change, as ordinary text, with no extra call.
- The narrator's answers use structured outputs, so the format cannot break.

## Questions for the design session

1. **Where the orchestrator lives.** (i) Inside the engineer's agent through its hooks: hold each edit until it has been narrated, and pass corrections back as the reason a step was held. The engineer keeps their normal chat. Or (ii) our own program running the coder in the background next to the narrator, with full control but outside the normal chat. Current recommendation: (i).
2. **Agents supported.** Claude Code hooks first; OpenCode through its plugin system. This would replace decision 0004 (agent-agnostic through MCP tools) with a new decision record.
3. **How the narrator reaches its model.** The Claude CLI in headless mode with the engineer's existing login (worked in the experiment, no API key), or the Anthropic SDK with an API key. Billing differs for work use.
4. **Who answers the engineer.** Which questions the narrator answers itself, and which it forwards to the coder (for example "why did you do it this way?" when no why-line covers it).
5. **Pacing.** How a hook holds an edit until the narration has been said, and what happens with hook timeouts and long pauses.
6. **What leaves the coder.** The `narrate` tool and most of the session script; what the coder still needs to know (the why-line, and that edits may be held).
7. **Route and tempo (slice 2).** Whether the route and per-part depth now belong to the narrator.

## Done when

- The coder makes no calls that only narrate.
- Replaying the "transcript records session length" session gives at least Sonnet's result (8 accurate, 0 wrong), and the engineer finds it clear.
- Every pointer opens the right file at the right lines, including on "show me".
- Cost per session is measured and reported against today's.
- The decision record replacing 0004 is written.

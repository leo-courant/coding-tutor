---
status: accepted
supersedes: 0004, and how 0006 delivers interrupts
---

# A separate narrator, coordinated through the coder's hooks

Narrating its own work cost the coder about half its model calls, each re-reading the whole conversation, and the pacing rules competed with the coding. Narration is now a separate job: a narrator model watches what the coder does and speaks it, and our extension coordinates the two through the coder's hooks. The coder only writes a one-line why before each change. Each edit lands in the editor while the narrator describes it, and the coder's next step is held until the voice has finished; an interrupt that needs the coder reaches it as the reason that step was held. The engineer keeps their normal chat with the coder.

This replaces "any agent through MCP tools" (0004): hooks are per agent, so each supported agent needs a small adapter. Claude Code comes first; OpenCode follows through its plugin system. The narrator reaches its model through the engineer's own agent CLI and login, with no tools. Its model is a setting, empty by default, which means the agent's default model. Coding Tutor assumes no particular model line: an engineer may narrate with GPT or with their own local model, through any OpenAI-compatible endpoint (ticket 0002).

## Considered Options

- **Our own program running the coder in the background** beside the narrator: full control over pacing, but the engineer would leave their normal chat and we would rebuild what the agent already gives them.
- **Holding each edit until it has been narrated**: lets the engineer stop an edit before it lands, but the pointer could only show the old code, and the edit would land after the narration instead of during it.
- **A cheaper narrator (Haiku) by default**: about fourteen times cheaper, but in the experiment it missed the problem and invented file paths; Sonnet with the same input made no wrong narrations.
- **A fixed default model (Sonnet)**: the best result in the experiment, but it would tie every engineer to Claude. Leo sets Sonnet in their own settings instead (2026-11-26).

## Consequences

- The narrator never works out code locations itself: it is handed the file and lines of each edit, taken from the file after the edit lands.
- The narrator has no tools and knows only what the coder's tools returned, so the coder's own permission rules decide what it can see. Files the engineer has denied are declared once, in their agent's settings, and never in Coding Tutor.
- A hook that times out lets the coder's step through, so a hold must end before the hook's limit and hold the step again rather than release it.
- The narrator answers questions about the work, "show me", and depth or tempo changes itself; it passes to the coder corrections, design objections, and any why that no why-line covers.
- Depth and tempo belong to the narrator. The coder proposes the route; the narrator speaks it and paces each part.

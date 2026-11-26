# 0002: Narrator on models from other providers

Status: open
Opened: 2026-11-24

## Why

Ticket 0001 has the narrator reach its model through the Claude CLI with the engineer's login. An engineer whose work allows only another provider (OpenAI, Gemini, a local model) could then not use a separate narrator at all. Choosing the narrator's model should not require Claude.

## Scope

- One narrator interface: give it the session events, get back a structured answer (what to say, pointer, anything to pass to the coder). The Claude CLI is the first implementation.
- Add at least one other provider behind it, and choose the provider and model in the settings.
- Check that each provider's structured outputs hold the answer format, since Sonnet broke the format twice without them.
- Consider a local model, in line with decision 0005 (the code stays on the machine).

## Done when

- The provider is a setting, and switching it needs no code change.
- The "transcript records session length" replay runs on a second provider, and its accuracy and cost are reported next to Sonnet's.

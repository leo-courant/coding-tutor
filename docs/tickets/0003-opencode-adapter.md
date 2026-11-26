# 0003: OpenCode adapter for the narrator hooks

Status: open, after 0001
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

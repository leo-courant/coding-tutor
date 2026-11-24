# Not tied to one coding agent

The engineer may work in Claude Code or OpenCode, so the voice, captions, pointer and microphone live in our own VS Code extension, and the agent reaches them through a small set of MCP tools that any agent can call. We give up Claude Code's built-in dictation and its in-chat pause buttons, and build the microphone ourselves, to avoid a rewrite when the agent changes.

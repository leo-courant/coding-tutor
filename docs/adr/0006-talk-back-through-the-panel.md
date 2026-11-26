---
status: partly superseded by 0007 (interrupts still go through the panel, but reach the coder as the reason its next step was held, or are answered by the narrator)
---

# The engineer talks back through the panel, not the agent's chat

In the first narrated session the engineer could only reach the agent by typing in its chat, which cancels the agent's current tool call and felt like having no voice. Interrupts are now typed or spoken in the Coding Tutor panel and handed to the agent as the result of its current `narrate` call, or of its next one when it is busy editing or running a command. The session survives the interrupt, and this works the same for any agent that can call MCP tools.

## Consequences

- A long pause cannot simply block the tool call: Claude Code moves a tool call to the background after about two minutes. A pause therefore ends the call with "paused" after 90 seconds, and the session script tells the agent to call `wait` until the engineer resumes.
- An interrupt sent while the agent is busy reaches it only at its next `narrate` or `wait`, so it may finish the edit it was making first.

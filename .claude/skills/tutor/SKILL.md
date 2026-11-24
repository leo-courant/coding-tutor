---
name: tutor
description: Implement a task as a narrated session, explaining aloud while building and pointing at the code. Use when the engineer types /tutor or asks to implement something "in explanation mode" or "with the tutor".
---

# Tutor

Implement the task the engineer gave as a narrated session.

1. Call the `begin_session` tool of the `coding-tutor` MCP server with the task in a few words.
2. It returns the session script. Follow that script for the rest of the session; it is the engineer's own, possibly edited, description of how they want to be taken through the work.
3. If the engineer's request says how they want something covered ("go deep on the config, gloss over the tests"), that takes precedence over the script's default depth.

If `begin_session` fails, tell the engineer what it reported and stop; do not implement the task without narration.

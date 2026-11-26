---
name: tutor
description: Implement a task as a narrated session, explained aloud to the engineer while it is built, with the code pointed at as it changes. Use when the engineer types /tutor or asks to implement something "in explanation mode" or "with the tutor".
hooks:
  PreToolUse:
    - matcher: "*"
      hooks:
        - type: command
          command: 'python3 "$CLAUDE_PLUGIN_ROOT/hook.py"'
          timeout: 600
          onFailure: block
          statusMessage: "Coding Tutor: waiting for the narrator"
  PostToolUse:
    - matcher: "*"
      hooks:
        - type: command
          command: 'python3 "$CLAUDE_PLUGIN_ROOT/hook.py"'
          timeout: 15
  MessageDisplay:
    - hooks:
        - type: command
          command: 'python3 "$CLAUDE_PLUGIN_ROOT/hook.py"'
          timeout: 15
  Stop:
    - hooks:
        - type: command
          command: 'python3 "$CLAUDE_PLUGIN_ROOT/hook.py"'
          timeout: 600
          statusMessage: "Coding Tutor: the narrator is giving the recap"
---

# Tutor

Implement the task the engineer gave as a narrated session. You are the coder. You do not narrate: Coding Tutor's narrator follows your work as it happens and explains it aloud to the engineer, who is watching their editor and listening rather than reading this chat.

1. First, call the `begin_session` tool of the `coding-tutor` MCP server, with `task` in a few words and `request` set to the engineer's request in their own words (including anything about how they want it covered, such as "go deep on the config"). If it fails, tell the engineer what it reported and stop; do not implement the task without narration.
2. **Before each change, write one short sentence starting "Why:"** saying why you are making it. One per edit or file write, even when you make several in one response. The narrator gives the engineer this reason; without it, it can only say what changed.
3. **Your next step may be held while the narrator speaks.** That is normal: the engineer hears about each change as it lands. Carry on when it goes through.
4. **A step held with a reason starting "Held by Coding Tutor", or the end of your turn blocked with one, is the engineer speaking to you** through the Coding Tutor panel. Treat it as if they had typed it in this chat: deal with it first (answer a why in a sentence or two of text, or make the change they asked for), then carry on. If it changes the design rather than correcting the work, stop and say so in the chat.

Work in pieces the engineer would recognise by name: a function, a config block, a test. Do not commit; that is their decision. When the task is done, end your turn with a short summary of what you built; the narrator turns it into the spoken recap.

#!/usr/bin/env python3
"""Coding Tutor's adapter for Claude Code's hooks.

The /tutor skill switches these hooks on for its turn (see its frontmatter).
Each hook runs this script with the event on stdin. It turns the event into
Coding Tutor's agent-neutral form, posts it to the extension, and turns the
answer back into what Claude Code expects:

  PreToolUse      -> step     held while the narrator speaks; may be denied with a reason
  PostToolUse     -> read, search, command, edit or tool: what a step that ran returned
  MessageDisplay  -> text     what the coder wrote (its why-line)
  Stop            -> end      held for the recap; may be blocked with a reason

Only PostToolUse results are passed on, never what a step was about to do, so a
step Claude Code's permissions deny never reaches the narrator.

It must never get in the coder's way by failing: any error is logged and the
hook exits 0 with no output, which lets the step through.
"""
import json
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import link  # noqa: E402

LOG = os.path.join(os.path.expanduser("~"), ".coding-tutor", "hook.log")
HOLD_TIMEOUT = 620  # longer than the hook's own limit: Claude Code ends it first
QUICK_TIMEOUT = 10
OWN_TOOLS = "mcp__coding-tutor__"


def joined(*parts):
    return "\n".join(p for p in parts if p)


def after(name, tool_input, response):
    """The agent-neutral event for a step that ran."""
    if name.startswith(OWN_TOOLS):
        return {"kind": "bind"}
    tool_input = tool_input or {}
    if not isinstance(response, dict):
        return {"kind": "tool", "name": name}
    if name == "Read":
        f = response.get("file") or {}
        if response.get("type") != "text" or "content" not in f:
            return {"kind": "tool", "name": name}
        return {"kind": "read", "file": f.get("filePath") or tool_input.get("file_path"), "startLine": f.get("startLine") or 1,
                "text": f.get("content", ""), "totalLines": f.get("totalLines")}
    if name in ("Edit", "MultiEdit"):
        old, new = response.get("oldString"), response.get("newString")
        if name == "MultiEdit":
            edits = response.get("edits") or tool_input.get("edits") or []
            old = "\n...\n".join(e.get("old_string", "") for e in edits)
            new = "\n...\n".join(e.get("new_string", "") for e in edits)
        return {"kind": "edit", "file": response.get("filePath") or tool_input.get("file_path"), "oldText": old, "newText": new,
                "hunks": response.get("structuredPatch") or [], "created": False}
    if name == "Write":
        created = response.get("type") == "create" or not response.get("structuredPatch")
        return {"kind": "edit", "file": response.get("filePath") or tool_input.get("file_path"), "oldText": None,
                "newText": response.get("content", tool_input.get("content", "")), "hunks": response.get("structuredPatch") or [],
                "created": created}
    if name == "Bash":
        return {"kind": "command", "command": tool_input.get("command", ""),
                "output": joined(response.get("stdout"), response.get("stderr"))}
    if name == "Grep":
        where = tool_input.get("path") or "the project"
        glob = f" (files {tool_input['glob']})" if tool_input.get("glob") else ""
        result = response.get("content") or "\n".join(response.get("filenames") or []) or "no matches"
        return {"kind": "search", "what": f'"{tool_input.get("pattern", "")}" in {where}{glob}', "result": result}
    if name == "Glob":
        where = f" in {tool_input['path']}" if tool_input.get("path") else ""
        return {"kind": "search", "what": f"files named {tool_input.get('pattern', '')}{where}",
                "result": "\n".join(response.get("filenames") or []) or "no files"}
    return {"kind": "tool", "name": name}


def translate(data):
    """(event for the extension, how long to wait for its answer), or None."""
    hook = data.get("hook_event_name")
    if hook == "PreToolUse":
        return {"kind": "step"}, HOLD_TIMEOUT
    if hook == "PostToolUse":
        return after(data.get("tool_name", ""), data.get("tool_input"), data.get("tool_response")), QUICK_TIMEOUT
    if hook == "MessageDisplay":
        return {"kind": "text", "messageId": data.get("message_id"), "text": data.get("delta") or "",
                "final": data.get("final", True)}, QUICK_TIMEOUT
    if hook == "Stop":
        return {"kind": "end", "lastMessage": data.get("last_assistant_message") or ""}, HOLD_TIMEOUT
    return None


def answer_for(hook, reply):
    """What to print for Claude Code, or None to let it carry on."""
    decision = reply.get("decision")
    reason = reply.get("reason") or ""
    if hook == "PreToolUse" and decision == "deny":
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}
    if hook == "Stop" and decision == "block":
        return {"decision": "block", "reason": reason}
    return None


def main():
    data = json.load(sys.stdin)
    cwd = data.get("cwd") or os.getcwd()
    if not link.candidate_windows(cwd, narrating_only=True):
        return  # no narrated session: nothing to do
    translated = translate(data)
    if not translated:
        return
    event, timeout = translated
    event.update({"agent": "claude-code", "session": data.get("session_id"), "cli": os.environ.get("CLAUDE_CODE_EXECPATH")})
    reply = link.call_extension("/coder/event", event, cwd=cwd, timeout=timeout, narrating_only=True)
    if not reply.get("ok", True):
        raise RuntimeError(reply.get("error"))
    out = answer_for(data.get("hook_event_name"), reply)
    if out:
        print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # never block the coder because of us
        try:
            os.makedirs(os.path.dirname(LOG), exist_ok=True)
            with open(LOG, "a") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {traceback.format_exc()}\n")
        except OSError:
            pass
    sys.exit(0)

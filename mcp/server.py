#!/usr/bin/env python3
"""Coding Tutor's agent tool, as an MCP server over stdio.

Standard library only, so any agent can start it with a bare `python3`. Its one
tool, `begin_session`, starts a narrated session in the Coding Tutor VS Code
extension running in the window that has this project open. From then on the
coder does not narrate: the extension follows its work through the agent's hooks
(for Claude Code, claude_code.py) and a separate narrator speaks it.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from link import call_extension  # noqa: E402

TOOLS = [
    {
        "name": "begin_session",
        "description": "Start a narrated session. Call this once, first, before reading or changing anything.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {"type": "string", "description": "The task in a few words, shown to the engineer as the session title."},
                "request": {"type": "string", "description": "The engineer's request in their own words, including how they want it covered. Passed to the narrator."},
            },
            "required": ["task"],
        },
    },
]
ROUTES = {"begin_session": "/session/begin"}


def run_tool(name, args):
    if name not in ROUTES:
        return {"ok": False, "error": f"unknown tool {name}"}, True
    result = call_extension(ROUTES[name], args)
    if not result.get("ok"):
        return result, True
    return (
        f"Session started. Voice: {result.get('voice')}. The narrator is following your work; "
        "carry on with the task as the /tutor instructions say.",
        False,
    )


def handle(message):
    method, params = message.get("method"), message.get("params") or {}
    if method == "initialize":
        return {
            "protocolVersion": params.get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "coding-tutor", "version": "0.2.0"},
        }
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        result, is_error = run_tool(params.get("name"), params.get("arguments") or {})
        text = result if isinstance(result, str) else json.dumps(result)
        return {"content": [{"type": "text", "text": text}], "isError": is_error}
    if method == "ping":
        return {}
    return None


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        if "id" not in message:
            continue  # notification
        result = handle(message)
        if result is None:
            reply = {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "method not found"}}
        else:
            reply = {"jsonrpc": "2.0", "id": message["id"], "result": result}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

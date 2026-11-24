#!/usr/bin/env python3
"""Coding Tutor's agent tools, as an MCP server over stdio.

Standard library only, so any agent can start it with a bare `python3`. Each
tool forwards to the Coding Tutor VS Code extension running in the window that
has this project open, and returns when the extension has finished (for
`narrate`, when the voice has stopped speaking).
"""
import glob
import json
import os
import sys
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
WINDOWS = os.path.join(HOME, ".coding-tutor", "windows")
USER_SCRIPT = os.path.join(HOME, ".config", "coding-tutor", "session-script.md")
DEFAULT_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session-script.md")
NO_WINDOW = (
    "Coding Tutor is not running in a VS Code window that has this project open. "
    "Ask the engineer to install or enable the Coding Tutor extension and open this folder, then try again."
)

TOOLS = [
    {
        "name": "begin_session",
        "description": "Start a narrated session. Call this once, first. Returns the session script: the instructions you follow for the rest of the session.",
        "inputSchema": {
            "type": "object",
            "properties": {"task": {"type": "string", "description": "The task in a few words, shown to the engineer as the session title."}},
            "required": ["task"],
        },
    },
    {
        "name": "narrate",
        "description": "Say one to three short sentences aloud to the engineer, shown as a caption, with the pointer on the code they are about. Send it in the same response as the edit, read or command it describes, not in a response of its own. Returns when the voice has finished, or earlier if the engineer paused, skipped or said something: read `outcome` and follow its `note`. At most one narrate per response.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "What to say, written to be heard: plain spoken sentences, no markdown or code."},
                "file": {"type": "string", "description": "Absolute path of the file the narration is about. Omit only when it is not about code on disk."},
                "startLine": {"type": "integer", "description": "First line to point at (1-based)."},
                "endLine": {"type": "integer", "description": "Last line to point at (1-based, inclusive)."},
            },
            "required": ["text"],
        },
    },
    {
        "name": "wait",
        "description": "Call this when a narrate result says the engineer paused. Returns when they resume (after saying whatever was left of the narration), when they say something, or with \"paused\" again if they are still thinking; then call it again. Do nothing else while paused.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "end_session",
        "description": "End the narrated session with a short spoken recap: what was built, piece by piece, and what the engineer should check themselves.",
        "inputSchema": {
            "type": "object",
            "properties": {"recap": {"type": "string", "description": "The recap, written to be heard."}},
            "required": ["recap"],
        },
    },
]
ROUTES = {"begin_session": "/session/begin", "narrate": "/narrate", "wait": "/wait", "end_session": "/session/end"}


def is_within(child, parent):
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return child == parent or child.startswith(parent.rstrip(os.sep) + os.sep)


def candidate_windows(cwd):
    """Windows whose folder contains the agent's working directory (or the reverse), best match first."""
    found = []
    for path in glob.glob(os.path.join(WINDOWS, "*.json")):
        try:
            with open(path) as f:
                window = json.load(f)
        except (OSError, ValueError):
            continue
        scores = [len(os.path.realpath(d)) for d in window.get("folders", []) if is_within(cwd, d) or is_within(d, cwd)]
        if scores:
            found.append((max(scores), os.path.getmtime(path), window))
    return [w for _, _, w in sorted(found, key=lambda t: (t[0], t[1]), reverse=True)]


def call_extension(route, payload):
    for window in candidate_windows(os.getcwd()):
        request = urllib.request.Request(
            f"http://127.0.0.1:{window['port']}{route}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-Coding-Tutor-Token": window["token"]},
        )
        try:
            # Narration blocks for as long as the voice speaks; allow a generous wait.
            with urllib.request.urlopen(request, timeout=900) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            return {"ok": False, "error": f"the extension refused the request ({error.code})"}
        except OSError:
            continue  # a window that has closed and left its file behind
    return {"ok": False, "error": NO_WINDOW}


def session_script(default_depth):
    path = USER_SCRIPT if os.path.exists(USER_SCRIPT) else DEFAULT_SCRIPT
    with open(path) as f:
        return f.read().replace("{{defaultDepth}}", default_depth)


def run_tool(name, args):
    if name not in ROUTES:
        return {"ok": False, "error": f"unknown tool {name}"}, True
    result = call_extension(ROUTES[name], args)
    if not result.get("ok"):
        return result, True
    if name == "begin_session":
        script = session_script(result.get("defaultDepth", "outline"))
        return f"Session started. Voice: {result.get('voice')}. Follow this session script.\n\n{script}", False
    return result, False


def handle(message):
    method, params = message.get("method"), message.get("params") or {}
    if method == "initialize":
        return {
            "protocolVersion": params.get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "coding-tutor", "version": "0.1.0"},
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

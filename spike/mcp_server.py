#!/usr/bin/env python3
# SPIKE - throwaway. Minimal MCP server (stdio, stdlib only) exposing one tool: narrate.
# Forwards to the Coding Tutor spike extension; returns when the voice has finished.
import json, os, sys, urllib.request

TOOL = {
    "name": "narrate",
    "description": "Say one or two sentences aloud to the engineer while pointing at code. Blocks until the voice has finished.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "What to say."},
            "file": {"type": "string", "description": "Absolute path of the file to point at."},
            "startLine": {"type": "integer"}, "endLine": {"type": "integer"},
        },
        "required": ["text"],
    },
}

def narrate(args):
    cfg = json.load(open(os.path.expanduser("~/.coding-tutor/spike.json")))
    req = urllib.request.Request(f"http://127.0.0.1:{cfg['port']}/narrate", data=json.dumps(args).encode(),
                                 headers={"Content-Type": "application/json", "X-Token": cfg["token"]})
    return urllib.request.urlopen(req, timeout=300).read().decode()

for line in sys.stdin:
    if not line.strip(): continue
    m = json.loads(line); mid = m.get("id"); method = m.get("method")
    if method == "initialize":
        r = {"protocolVersion": m["params"].get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}},
             "serverInfo": {"name": "coding-tutor-spike", "version": "0.0.1"}}
    elif method == "tools/list":
        r = {"tools": [TOOL]}
    elif method == "tools/call":
        try: r = {"content": [{"type": "text", "text": narrate(m["params"].get("arguments", {}))}]}
        except Exception as e: r = {"content": [{"type": "text", "text": f"error: {e}"}], "isError": True}
    elif mid is None: continue
    else: r = {}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": r}) + "\n"); sys.stdout.flush()

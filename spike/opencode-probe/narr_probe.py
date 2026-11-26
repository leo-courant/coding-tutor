"""Sends one narrator prompt to an `opencode serve` on PORT; VARIANT picks how tools are switched off."""
import base64
import json
import sys
import urllib.request

port, variant = sys.argv[1], sys.argv[2]
B = f"http://127.0.0.1:{port}"
H = {"Content-Type": "application/json", "Authorization": "Basic " + base64.b64encode(b"opencode:probe-pw").decode()}


def call(m, p, body=None):
    r = urllib.request.Request(B + p, data=json.dumps(body).encode() if body is not None else None, headers=H, method=m)
    with urllib.request.urlopen(r, timeout=60) as x:
        return json.loads(x.read() or b"null")


s = call("POST", "/session", {"title": "Coding Tutor narrator"})
schema = {"type": "object", "properties": {"parts": {"type": "array", "items": {"type": "object"}}, "toCoder": {"type": ["string", "null"]}}, "required": ["parts", "toCoder"]}
body = {"agent": "coding-tutor-narrator", "model": {"providerID": "fake", "modelID": "coder"}, "format": {"type": "json_schema", "schema": schema},
        "parts": [{"type": "text", "text": "Edit 1: the coder changed calc.py"}]}
if variant == "bodytools":
    body["tools"] = {"*": False, "StructuredOutput": True}
r = call("POST", f"/session/{s['id']}/message", body)
print(variant, "structured:", r["info"].get("structured"), "error:", (r["info"].get("error") or {}).get("name"), "cost:", r["info"].get("cost"))

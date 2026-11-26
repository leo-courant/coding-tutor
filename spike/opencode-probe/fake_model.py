#!/usr/bin/env python3
"""A scripted OpenAI-compatible model, for driving OpenCode without a real one.

    python3 fake_model.py PORT SCRIPT.json LOG

SCRIPT is a list of coder turns. A request gets the turn whose index is the
number of assistant messages already in its conversation, so the same script
replays one fixed session. Each turn is {"text": "...", "tools": [[name, {args}], ...]}.
A request that offers a StructuredOutput tool, or asks for a JSON schema, is the
narrator: it gets a fixed answer. Every request body is appended to LOG.
"""
import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, SCRIPT, LOG = int(sys.argv[1]), sys.argv[2], sys.argv[3]
NARRATION = {"parts": [{"say": "The coder changed a minus to a plus.", "edit": 1, "file": None, "startLine": None, "endLine": None}], "toCoder": None}


def turn_for(body):
    script = json.load(open(SCRIPT))
    tools = [t.get("function", {}).get("name") for t in body.get("tools") or []]
    if "StructuredOutput" in tools:
        last = str(body["messages"][-1].get("content"))
        said = re.search(r'The engineer interrupted and said: \\?"([^"\\]*)', last)
        answer = dict(NARRATION, toCoder=said.group(1)) if said else NARRATION
        return {"text": "", "tools": [["StructuredOutput", answer]]}
    if (body.get("response_format") or {}).get("type") == "json_schema":
        return {"text": json.dumps(NARRATION), "tools": []}
    n = sum(1 for m in body.get("messages", []) if m.get("role") == "assistant")
    return script[n] if n < len(script) else {"text": "Done: fixed add.", "tools": []}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"object": "list", "data": [{"id": "fake", "object": "model"}]}).encode())

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        turn = turn_for(body)
        with open(LOG, "a") as f:
            f.write(json.dumps({"t": time.time(), "path": self.path, "body": body, "answer": turn}) + "\n")
        calls = [{"index": i, "id": f"call_{int(time.time()*1000)}_{i}", "type": "function",
                  "function": {"name": name, "arguments": json.dumps(args)}} for i, (name, args) in enumerate(turn.get("tools", []))]
        if not body.get("stream"):
            msg = {"role": "assistant", "content": turn.get("text") or None}
            if calls:
                msg["tool_calls"] = [{k: v for k, v in c.items() if k != "index"} for c in calls]
            out = {"id": "fake", "object": "chat.completion", "model": "fake",
                   "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if calls else "stop"}],
                   "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
            data = json.dumps(out).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def chunk(delta, finish=None, usage=None):
            c = {"id": "fake", "object": "chat.completion.chunk", "model": "fake", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            if usage:
                c["usage"] = usage
            self.wfile.write(f"data: {json.dumps(c)}\n\n".encode())
            self.wfile.flush()

        chunk({"role": "assistant"})
        if turn.get("text"):
            chunk({"content": turn["text"]})
        if calls:
            chunk({"tool_calls": calls})
        chunk({}, "tool_calls" if calls else "stop", {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

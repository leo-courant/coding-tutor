"""Drives mcp/server.py over stdio against a fake extension."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = "secret"


class FakeExtension(BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("X-Coding-Tutor-Token") != TOKEN:
            self.send_response(403)
            self.end_headers()
            return
        FakeExtension.calls.append((self.path, body))
        reply = {"ok": True, "heard": True}
        if self.path == "/session/begin":
            reply = {"ok": True, "defaultDepth": "walk", "voice": "ready"}
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class McpServerTest(unittest.TestCase):
    def setUp(self):
        FakeExtension.calls = []
        self.home = tempfile.TemporaryDirectory()
        self.project = os.path.join(self.home.name, "project")
        os.makedirs(os.path.join(self.project, "sub"))
        self.httpd = HTTPServer(("127.0.0.1", 0), FakeExtension)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.home.cleanup()

    def register_window(self, folders, port=None, token=TOKEN, name="1.json"):
        windows = os.path.join(self.home.name, ".coding-tutor", "windows")
        os.makedirs(windows, exist_ok=True)
        with open(os.path.join(windows, name), "w") as f:
            json.dump({"port": port or self.httpd.server_address[1], "token": token, "folders": folders}, f)

    def rpc(self, *messages, cwd=None):
        lines = "".join(json.dumps({"jsonrpc": "2.0", **m}) + "\n" for m in messages)
        out = subprocess.run(
            [sys.executable, os.path.join(ROOT, "mcp", "server.py")],
            input=lines, capture_output=True, text=True, cwd=cwd or self.project,
            env={**os.environ, "HOME": self.home.name}, timeout=20,
        ).stdout
        return [json.loads(line) for line in out.splitlines()]

    def call(self, name, args, **kw):
        (reply,) = self.rpc({"id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}, **kw)
        return reply["result"]

    def test_handshake_and_tool_list(self):
        init, tools = self.rpc(
            {"id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"method": "notifications/initialized"},
            {"id": 2, "method": "tools/list"},
        )
        self.assertEqual(init["result"]["serverInfo"]["name"], "coding-tutor")
        self.assertEqual([t["name"] for t in tools["result"]["tools"]], ["begin_session", "narrate", "wait", "end_session"])

    def test_narrate_reaches_the_window_for_this_project(self):
        self.register_window([self.project])
        result = self.call("narrate", {"text": "Hello.", "file": "/x.py", "startLine": 2, "endLine": 3})
        self.assertFalse(result["isError"])
        self.assertEqual(FakeExtension.calls, [("/narrate", {"text": "Hello.", "file": "/x.py", "startLine": 2, "endLine": 3})])

    def test_works_from_a_subfolder_of_the_project(self):
        self.register_window([self.project])
        result = self.call("narrate", {"text": "Hello."}, cwd=os.path.join(self.project, "sub"))
        self.assertFalse(result["isError"])

    def test_begin_session_returns_the_script_with_the_default_depth(self):
        self.register_window([self.project])
        text = self.call("begin_session", {"task": "Add retries"})["content"][0]["text"]
        self.assertIn("The default depth for this session is **walk**.", text)
        self.assertNotIn("{{defaultDepth}}", text)

    def test_engineers_own_script_replaces_the_default(self):
        self.register_window([self.project])
        os.makedirs(os.path.join(self.home.name, ".config", "coding-tutor"))
        with open(os.path.join(self.home.name, ".config", "coding-tutor", "session-script.md"), "w") as f:
            f.write("My script at {{defaultDepth}}.")
        text = self.call("begin_session", {"task": "t"})["content"][0]["text"]
        self.assertTrue(text.endswith("My script at walk."))

    def test_no_window_for_this_project_is_an_error_the_agent_can_relay(self):
        self.register_window([os.path.join(self.home.name, "another-project")])
        result = self.call("narrate", {"text": "Hello."})
        self.assertTrue(result["isError"])
        self.assertIn("not running in a VS Code window", result["content"][0]["text"])
        self.assertEqual(FakeExtension.calls, [])

    def test_a_closed_window_left_behind_is_skipped(self):
        self.register_window([self.project], port=1, name="stale.json")
        self.register_window([self.project], name="live.json")
        self.assertFalse(self.call("narrate", {"text": "Hello."})["isError"])

    def test_wait_reaches_the_extension(self):
        self.register_window([self.project])
        self.assertFalse(self.call("wait", {})["isError"])
        self.assertEqual(FakeExtension.calls, [("/wait", {})])

    def test_wrong_token_is_reported(self):
        self.register_window([self.project], token="wrong")
        result = self.call("narrate", {"text": "Hello."})
        self.assertTrue(result["isError"])
        self.assertIn("403", result["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()

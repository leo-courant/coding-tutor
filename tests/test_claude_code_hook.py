"""Drives mcp/claude_code.py (the Claude Code hook adapter) against a fake extension."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "mcp", "claude_code.py")
TOKEN = "secret"


class FakeExtension(BaseHTTPRequestHandler):
    calls = []
    reply = {"ok": True, "decision": "allow"}

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeExtension.calls.append((self.path, body))
        data = json.dumps(FakeExtension.reply).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class ClaudeCodeHookTest(unittest.TestCase):
    def setUp(self):
        FakeExtension.calls = []
        FakeExtension.reply = {"ok": True, "decision": "allow"}
        self.home = tempfile.TemporaryDirectory()
        self.project = os.path.join(self.home.name, "project")
        os.makedirs(self.project)
        self.httpd = HTTPServer(("127.0.0.1", 0), FakeExtension)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.home.cleanup()

    def window(self, narrating=True, port=None):
        windows = os.path.join(self.home.name, ".coding-tutor", "windows")
        os.makedirs(windows, exist_ok=True)
        with open(os.path.join(windows, "1.json"), "w") as f:
            json.dump({"port": port or self.httpd.server_address[1], "token": TOKEN, "folders": [self.project], "narrating": narrating}, f)

    def hook(self, event, raw=None):
        data = {"session_id": "S1", "cwd": self.project, "hook_event_name": event["hook_event_name"], **event}
        run = subprocess.run(
            [sys.executable, HOOK], input=raw if raw is not None else json.dumps(data), capture_output=True, text=True,
            env={**os.environ, "HOME": self.home.name, "CLAUDE_CODE_EXECPATH": "/opt/claude"}, timeout=20,
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout) if run.stdout.strip() else None

    def sent(self):
        self.assertEqual(len(FakeExtension.calls), 1)
        route, body = FakeExtension.calls[0]
        self.assertEqual(route, "/coder/event")
        return body

    def test_does_nothing_when_no_session_is_being_narrated(self):
        self.window(narrating=False)
        self.assertIsNone(self.hook({"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {}}))
        self.assertEqual(FakeExtension.calls, [])

    def test_a_step_carries_nothing_of_what_it_is_about_to_do(self):
        self.window()
        self.hook({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "cat secret.txt"}})
        body = self.sent()
        self.assertEqual(body, {"kind": "step", "agent": "claude-code", "session": "S1", "cli": "/opt/claude"})

    def test_a_held_step_denied_with_a_reason(self):
        self.window()
        FakeExtension.reply = {"ok": True, "decision": "deny", "reason": "Held by Coding Tutor. Rename it."}
        out = self.hook({"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {}})
        self.assertEqual(out, {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                      "permissionDecisionReason": "Held by Coding Tutor. Rename it."}})

    def test_an_edit_passes_the_diff_claude_code_reported(self):
        self.window()
        patch = [{"oldStart": 2, "oldLines": 3, "newStart": 2, "newLines": 4, "lines": [" a", "-b", "+c", "+d", " e"]}]
        self.hook({"hook_event_name": "PostToolUse", "tool_name": "Edit",
                   "tool_input": {"file_path": "/p/x.py", "old_string": "b", "new_string": "c\nd"},
                   "tool_response": {"filePath": "/p/x.py", "oldString": "b", "newString": "c\nd", "originalFile": "a\nb\ne\n",
                                     "structuredPatch": patch}})
        body = self.sent()
        self.assertEqual({k: body[k] for k in ("kind", "file", "oldText", "newText", "hunks", "created")},
                         {"kind": "edit", "file": "/p/x.py", "oldText": "b", "newText": "c\nd", "hunks": patch, "created": False})
        self.assertNotIn("originalFile", json.dumps(body), "the whole file before the edit is not passed on")

    def test_a_new_file(self):
        self.window()
        self.hook({"hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": {"file_path": "/p/n.txt", "content": "hi\n"},
                   "tool_response": {"type": "create", "filePath": "/p/n.txt", "content": "hi\n", "structuredPatch": []}})
        body = self.sent()
        self.assertEqual((body["kind"], body["created"], body["newText"]), ("edit", True, "hi\n"))

    def test_a_read_passes_what_the_read_returned(self):
        self.window()
        self.hook({"hook_event_name": "PostToolUse", "tool_name": "Read", "tool_input": {"file_path": "/p/x.py"},
                   "tool_response": {"type": "text", "file": {"filePath": "/p/x.py", "content": "one\n", "startLine": 3, "totalLines": 9}}})
        self.assertEqual({k: v for k, v in self.sent().items() if k not in ("agent", "session", "cli")},
                         {"kind": "read", "file": "/p/x.py", "startLine": 3, "text": "one\n", "totalLines": 9})

    def test_commands_and_searches(self):
        self.window()
        self.hook({"hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_input": {"command": "ls"},
                   "tool_response": {"stdout": "a", "stderr": "warn"}})
        self.assertEqual((self.sent()["kind"], self.sent()["output"]), ("command", "a\nwarn"))
        FakeExtension.calls = []
        self.hook({"hook_event_name": "PostToolUse", "tool_name": "Grep", "tool_input": {"pattern": "def ", "path": "/p"},
                   "tool_response": {"mode": "content", "content": "4:def f():"}})
        self.assertEqual(self.sent()["what"], '"def " in /p')

    def test_coding_tutors_own_tool_only_binds_the_session(self):
        self.window()
        self.hook({"hook_event_name": "PostToolUse", "tool_name": "mcp__coding-tutor__begin_session", "tool_input": {"task": "t"},
                   "tool_response": [{"type": "text", "text": "Session started."}]})
        self.assertEqual(self.sent()["kind"], "bind")

    def test_the_why_line(self):
        self.window()
        self.hook({"hook_event_name": "MessageDisplay", "message_id": "m1", "delta": "Why: x.", "final": True})
        body = self.sent()
        self.assertEqual((body["kind"], body["messageId"], body["text"], body["final"]), ("text", "m1", "Why: x.", True))

    def test_the_end_of_the_turn_blocked_with_a_reason(self):
        self.window()
        FakeExtension.reply = {"ok": True, "decision": "block", "reason": "Also add a test."}
        out = self.hook({"hook_event_name": "Stop", "last_assistant_message": "Done."})
        self.assertEqual(self.sent()["lastMessage"], "Done.")
        self.assertEqual(out, {"decision": "block", "reason": "Also add a test."})

    def test_never_gets_in_the_way_when_something_is_wrong(self):
        self.window(port=1)  # nothing listening
        self.assertIsNone(self.hook({"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {}}))
        self.assertIsNone(self.hook({"hook_event_name": "PreToolUse"}, raw="not json"))
        self.assertTrue(os.path.exists(os.path.join(self.home.name, ".coding-tutor", "hook.log")))


if __name__ == "__main__":
    unittest.main()

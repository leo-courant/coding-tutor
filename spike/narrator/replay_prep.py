# SPIKE - throwaway. Turns the recorded "transcript records session length"
# session (events.json) into the agent-neutral events the Claude Code adapter
# would have sent, for replaying through the product's narrator (replay.js).
#
# The recording has each edit's old and new text but not Claude Code's diff, so
# the files are rebuilt as they were before the session (transcript.js from the
# `cat -n` the coder ran; extension.js from the first commit with the session's
# edits undone), and each edit is applied to get its diff and the file after it.
#
#   python3 spike/narrator/replay_prep.py   -> spike/narrator/replay-events.json
import difflib, json, os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
events = json.load(open(os.path.join(HERE, "events.json")))
T = os.path.join(ROOT, "extension/lib/transcript.js")
E = os.path.join(ROOT, "extension/extension.js")

# transcript.js, from the coder's `cat -n`
lines = [m.group(2) for m in (re.match(r"^\s+(\d+)\t(.*)$", l) for l in events[1]["result"].split("\n")) if m]
files = {T: "\n".join(lines) + "\n"}
# extension.js, from the first commit with the session's three edits undone
ext = subprocess.run(["git", "show", "51d01e2:extension/extension.js"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
for i in (17, 16, 15):
    inp = events[i]["input"]
    assert ext.count(inp["new_string"]) == 1, i
    ext = ext.replace(inp["new_string"], inp["old_string"])
files[E] = ext


def hunks(before, after):
    """Claude Code's structuredPatch, from a unified diff with 3 lines of context."""
    out = []
    diff = list(difflib.unified_diff(before.split("\n"), after.split("\n"), lineterm="", n=3))
    for line in diff[2:]:
        m = re.match(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
        if m:
            out.append({"oldStart": int(m[1]), "oldLines": int(m[2] or 1), "newStart": int(m[3]), "newLines": int(m[4] or 1), "lines": []})
        else:
            out[-1]["lines"].append(line)
    return out


replay = []
for i, e in enumerate(events[:28]):
    if e["kind"] == "work" and e["tool"] == "Edit":
        inp = e["input"]
        before = files[inp["file_path"]]
        assert before.count(inp["old_string"]) == 1, i
        after = before.replace(inp["old_string"], inp["new_string"])
        files[inp["file_path"]] = after
        replay.append({"at": i, "kind": "edit", "file": inp["file_path"], "oldText": inp["old_string"], "newText": inp["new_string"],
                       "hunks": hunks(before, after), "created": False, "fileAfter": after})
    elif e["kind"] == "work" and e["tool"] == "Bash":
        replay.append({"at": i, "kind": "command", "command": e["input"]["command"], "output": e["result"]})
    elif e["kind"] == "engineer":
        replay.append({"at": i, "kind": "engineer", "text": e["text"]})
    elif e["kind"] == "end" and e.get("recap"):
        replay.append({"at": i, "kind": "end", "lastMessage": e["recap"]})
    elif e["kind"] == "begin":
        task = e["task"]

# In the recording the engineer said "show me" after the recap; a session now
# ends with the recap, so it is said while the recap is due.
end = next(r for r in replay if r["kind"] == "end")
show = next(r for r in replay if r["kind"] == "engineer" and r["at"] == 27)
replay.remove(end)
replay.remove(show)
replay += [show, end]
# The coder's own narrations, for the side-by-side comparison.
coder = [{"at": i, "text": e["text"], "file": e.get("file"), "startLine": e.get("startLine"), "endLine": e.get("endLine")}
         for i, e in enumerate(events[:31]) if e["kind"] == "narration"]
json.dump({"task": task, "events": replay, "coder": coder}, open(os.path.join(HERE, "replay-events.json"), "w"), indent=1)
for r in replay:
    print(r["at"], r["kind"], (r.get("file") or r.get("command") or r.get("text") or "")[:90].replace("\n", " "), [(h["oldStart"], h["newStart"], h["newLines"]) for h in r.get("hunks", [])])

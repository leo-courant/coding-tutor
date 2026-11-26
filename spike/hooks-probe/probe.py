# SPIKE - throwaway. A Claude Code hook that logs what it is given, to settle what
# the hooks docs leave open for ticket 0001 (why-line timing, edit locations,
# holding a step, blocking the end of a turn).
#
#   python3 probe.py <log.jsonl> <mode>
#
# Modes: log (allow everything), deny-first-edit, sleep-<seconds>,
# block-first-stop, context-first-edit.
import json, os, sys, time

log_path, mode = sys.argv[1], sys.argv[2]
arrived = time.time()
data = json.load(sys.stdin)
event = data.get("hook_event_name")


def transcript_tail(path):
    """The last assistant text in the session log, and how many lines it has."""
    last_text, lines = None, 0
    try:
        with open(path) as f:
            for line in f:
                lines += 1
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("type") != "assistant":
                    continue
                for c in row.get("message", {}).get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "text" and c["text"].strip():
                        last_text = c["text"].strip()
    except OSError:
        return {"error": "no transcript"}
    return {"lines": lines, "lastAssistantText": last_text}


def where(path, text):
    try:
        body = open(path).read()
    except OSError:
        return None
    at = body.find(text)
    if at < 0:
        return None
    start = body.count("\n", 0, at) + 1
    return [start, start + text.count("\n")]


def once(name):
    """True the first time this run hits `name`."""
    flag = f"{log_path}.{name}"
    if os.path.exists(flag):
        return False
    open(flag, "w").close()
    return True


entry = {"t": round(arrived, 3), "event": event, "mode": mode, "input": data}
if data.get("transcript_path"):
    entry["transcript"] = transcript_tail(data["transcript_path"])
if event == "PostToolUse" and data.get("tool_name") == "Edit":
    entry["foundAt"] = where(data["tool_input"]["file_path"], data["tool_input"]["new_string"])

output = None
is_edit = data.get("tool_name") in ("Edit", "Write", "MultiEdit")
if mode == "deny-first-edit" and event == "PreToolUse" and is_edit and once("deny"):
    output = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
              "permissionDecisionReason": "Held by Coding Tutor. The engineer said: \"please also add a docstring to the function you are changing\". Do that as part of this change, then make the call again."}}
elif mode.startswith("sleep-") and event == "PreToolUse" and is_edit and once("sleep"):
    time.sleep(float(mode.split("-", 1)[1]))
elif mode == "block-first-stop" and event == "Stop" and once("stop"):
    output = {"decision": "block", "reason": "Held by Coding Tutor. The engineer asked: \"what does retry return when every attempt fails?\" Answer in one sentence, then finish."}
elif mode == "context-first-edit" and event == "PostToolUse" and is_edit and once("context"):
    output = {"hookSpecificOutput": {"hookEventName": "PostToolUse",
              "additionalContext": "Coding Tutor: the engineer said \"rename the loop variable to attempt_number\". Do that next."}}

entry["output"] = output
entry["took"] = round(time.time() - arrived, 3)
with open(log_path, "a") as f:
    f.write(json.dumps(entry) + "\n")
if output:
    print(json.dumps(output))

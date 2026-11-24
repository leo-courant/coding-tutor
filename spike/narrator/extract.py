# SPIKE - throwaway. Pull one narrated session out of a Claude Code log as an
# ordered list of events: the coder's work (reads, edits, commands, with results),
# its narrations (the ground truth to compare against), and the engineer's interrupts.
import json, sys

log, out = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(log)]
starts = [i for i, r in enumerate(rows) if r.get("type") == "assistant" and any(
    isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name", "").endswith("begin_session")
    for c in r["message"].get("content") or [])]
start = starts[int(sys.argv[3]) if len(sys.argv) > 3 else -1]

results = {}
for r in rows[start:]:
    if r.get("type") == "user":
        for c in r["message"].get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_result":
                body = c.get("content")
                if isinstance(body, list):
                    body = "\n".join(b.get("text", "") for b in body if isinstance(b, dict))
                results[c["tool_use_id"]] = body or ""

events, seen = [], set()
for r in rows[start:]:
    if r.get("type") != "assistant":
        continue
    for c in r["message"].get("content") or []:
        if not isinstance(c, dict):
            continue
        if c.get("type") == "text" and c["text"].strip():
            events.append({"kind": "coder_text", "text": c["text"].strip()})
        if c.get("type") != "tool_use" or c["id"] in seen:
            continue
        seen.add(c["id"])
        name, inp, res = c["name"], c["input"], results.get(c["id"], "")
        if name.endswith("begin_session"):
            events.append({"kind": "begin", "task": inp.get("task")})
        elif name.endswith("narrate"):
            events.append({"kind": "narration", "text": inp["text"], "file": inp.get("file"), "startLine": inp.get("startLine"), "endLine": inp.get("endLine")})
            try:
                said = json.loads(res).get("engineerSaid")
            except Exception:
                said = None
            if said:
                events.append({"kind": "engineer", "text": said})
        elif name.endswith("end_session"):
            events.append({"kind": "end", "recap": inp.get("recap")})
            try:
                said = json.loads(res).get("engineerSaid")
            except Exception:
                said = None
            if said:
                events.append({"kind": "engineer", "text": said})
            if inp.get("recap") == "":
                break
        elif name.endswith("wait") or name == "ToolSearch":
            continue
        else:
            events.append({"kind": "work", "tool": name, "input": inp, "result": res[:4000]})
json.dump(events, open(out, "w"), indent=1)
for e in events:
    k = e["kind"]
    desc = e.get("text") or e.get("task") or e.get("recap") or (e["tool"] + " " + json.dumps(e["input"])[:110])
    print(f"{k:11} {desc[:150]}")

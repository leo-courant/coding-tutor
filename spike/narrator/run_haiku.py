# SPIKE - throwaway. Replay one narrated session to Haiku as the narrator would
# see it in the hooks design: the coder's reads, commands and edits, plus what the
# engineer said. Haiku never sees the coder's own narrations.
import glob, json, os, subprocess, sys, time

ROOT = os.getcwd()
HERE = os.path.join(ROOT, "spike", "narrator")
CLAUDE = sorted(glob.glob(os.path.expanduser("~/.var/app/com.visualstudio.code/data/vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude")))[-1]
SCRATCH = sys.argv[1]
MODEL = sys.argv[2] if len(sys.argv) > 2 else "claude-haiku-5-5"
TAG = "haiku" if "haiku" in MODEL else "sonnet"
PROMPT = open(os.path.join(HERE, "narrator-prompt.md")).read()
events = json.load(open(os.path.join(HERE, "events.json")))

# Moments where the narrator speaks, and the coder's narrations for the same moment.
MOMENTS = [(1, [2, 3]), (4, [6, 7]), (9, [8, 10, 11]), (12, [14]), (15, [19]), (16, [20]), (17, []), (21, [22]), (23, [25]), (26, [26]), (27, [28, 29, 30])]

def rel(p):
    return os.path.relpath(p, ROOT) if p and p.startswith(ROOT) else p

def lines_of(path, text):
    try:
        body = open(path).read()
    except OSError:
        return None
    at = body.find(text)
    if at < 0:
        return None
    start = body.count("\n", 0, at) + 1
    return start, start + text.count("\n")

def describe(e):
    if e["kind"] == "work" and e["tool"] == "Edit":
        i = e["input"]
        where = lines_of(i["file_path"], i["new_string"])
        loc = f", now at lines {where[0]} to {where[1]}" if where else ""
        return f"The coder edited {i['file_path']}{loc}.\nIt replaced:\n{i['old_string']}\nwith:\n{i['new_string']}"
    if e["kind"] == "work":
        return f"The coder ran a command (working directory {ROOT}):\n{e['input'].get('command')}\nOutput:\n{e['result'][:3000]}"
    if e["kind"] == "engineer":
        return f'The engineer interrupted and said: "{e["text"]}"'
    if e["kind"] == "end":
        return "The coder has finished the task. Give the spoken recap."
    raise ValueError(e["kind"])

def short(e):
    if e["kind"] == "work" and e["tool"] == "Edit":
        return f"[coder edited {rel(e['input']['file_path'])}]"
    if e["kind"] == "work":
        return f"[coder ran: {e['input'].get('command', '')[:120]}]"
    if e["kind"] == "engineer":
        return f'[engineer said: "{e["text"]}"]'
    return "[end]"

history = [f"Task given to the coder: {events[0]['task']}"]
results = []
total_cost = 0.0
for idx, truth in MOMENTS:
    e = events[idx]
    prompt = "Session so far:\n" + "\n".join(history) + "\n\nNew event:\n" + describe(e)
    t = time.time()
    out = subprocess.run(
        [CLAUDE, "-p", "--model", MODEL, "--system-prompt", PROMPT, "--tools", "", "--strict-mcp-config",
         "--no-session-persistence", "--output-format", "json"],
        input=prompt, capture_output=True, text=True, cwd=SCRATCH, timeout=180)
    secs = time.time() - t
    reply = json.loads(out.stdout)
    total_cost += reply.get("total_cost_usd") or 0
    raw = reply.get("result", "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        said = json.loads(raw)
    except ValueError:
        said = {"say": raw, "file": None, "startLine": None, "endLine": None, "unparsed": True}
    coder = [events[j].get("text") or events[j].get("recap") for j in truth]
    results.append({"event": idx, "kind": e["kind"], "what": short(e), "haiku": said, "coder": coder, "seconds": round(secs, 1)})
    print(f"\n#{idx} {short(e)[:100]}  ({secs:.1f}s)\n  HAIKU: {said.get('say')}  -> {rel(said.get('file'))}:{said.get('startLine')}-{said.get('endLine')}\n  CODER: {' / '.join(c for c in coder if c)}", flush=True)
    history.append(short(e))
    if said.get("say"):
        history.append(f'[you said: "{said["say"]}"]')
json.dump({"results": results, "cost_usd": total_cost}, open(os.path.join(HERE, f"{TAG}-results.json"), "w"), indent=1)
print(f"\nTotal Haiku cost: ${total_cost:.4f}")

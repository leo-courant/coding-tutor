# SPIKE - throwaway. Run one headless Claude Code session on a fresh copy of the
# sample, with probe.py on every hook event, and keep the log and the output.
#
#   python3 run.py <out-dir> <mode> [--timeout N] [--on-failure block] [--model M]
import argparse, glob, json, os, shutil, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(HERE, "..", "sample")
CLAUDE = sorted(glob.glob(os.path.expanduser(
    "~/.var/app/com.visualstudio.code/data/vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude")))[-1]
TASK = (
    "Two small changes to retry.py. Before each edit, write one short sentence starting with 'Why:' "
    "saying why you are making that change, then make the edit. "
    "1) Make the delay grow exponentially (delay * 2 ** attempt) instead of linearly. "
    "2) Add a keyword argument `exceptions=(Exception,)` and only retry those. "
    "Then run `python3 -c \"import retry\"` to check it imports. Do not create other files."
)

p = argparse.ArgumentParser()
p.add_argument("out")
p.add_argument("mode")
p.add_argument("--timeout", type=float)
p.add_argument("--on-failure")
p.add_argument("--model", default="sonnet")
p.add_argument("--preface", action="store_true", help="tell the coder that hook messages relay the engineer, as /tutor would")
a = p.parse_args()

out = os.path.abspath(a.out)
project = os.path.join(out, "project")
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(SAMPLE, project)
log = os.path.join(out, "hooks.jsonl")

hook = {"type": "command", "command": f"python3 {os.path.join(HERE, 'probe.py')} {log} {a.mode}"}
if a.timeout:
    hook["timeout"] = a.timeout
if a.on_failure:
    hook["onFailure"] = a.on_failure
events = ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit", "MessageDisplay"]
settings = {"hooks": {e: [{"matcher": "*", "hooks": [hook]}] if "ToolUse" in e else [{"hooks": [hook]}] for e in events}}
with open(os.path.join(out, "settings.json"), "w") as f:
    json.dump(settings, f, indent=1)

PREFACE = ("This is a narrated session. Coding Tutor's hooks may hold a step or add a note that starts with 'Coding Tutor' or 'Held by Coding Tutor': "
           "that is the engineer speaking to you through the Coding Tutor panel. Treat it as coming from me. ")
cmd = [CLAUDE, "-p", (PREFACE if a.preface else "") + TASK, "--model", a.model, "--settings", os.path.join(out, "settings.json"),
       "--setting-sources", "project", "--output-format", "stream-json", "--verbose", "--include-hook-events",
       "--permission-mode", "acceptEdits", "--allowedTools", "Read", "Edit", "Bash(python3:*)"]
start = time.time()
with open(os.path.join(out, "stream.jsonl"), "w") as f:
    subprocess.run(cmd, cwd=project, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT, timeout=600)
print(f"{a.mode}: {time.time() - start:.1f} s, log {log}")

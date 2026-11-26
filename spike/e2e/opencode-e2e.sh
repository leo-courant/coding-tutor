#!/bin/sh
# SPIKE - throwaway. Runs on the host. A narrated session in OpenCode end to end,
# with a scripted fake model (spike/opencode-probe/fake_model.py) as both the
# coder's and the narrator's model, so it needs no GPU and sends nothing off the
# machine. Real: OpenCode, the plugin, /tutor, the MCP server, the session
# coordinator and the OpenCode narrator. The harness stands in for the window.
#
#   sh spike/e2e/opencode-e2e.sh            headless (opencode run)
#   TUI=1 sh spike/e2e/opencode-e2e.sh      in tmux; presses Esc while a step is held
#   TUI=1 RECAP=1 sh spike/e2e/opencode-e2e.sh   in tmux; no Esc, the engineer speaks during the recap
set -e
R=$(cd "$(dirname "$0")/../.." && pwd)
W=$HOME/.cache/coding-tutor-opencode-e2e
P=$W/project
PORT=47901
rm -rf "$W"; mkdir -p "$P/.opencode/plugins" "$P/.opencode/commands"
W=$(realpath "$W"); P=$W/project  # OpenCode treats a /home path to a /var/home project as outside it
printf 'def add(a, b):\n    return a - b\n' > "$P/calc.py"
printf 'the password is hunter2-PROBE\n' > "$P/secret.txt"
ln -s "$R/mcp/opencode.js" "$P/.opencode/plugins/coding-tutor.js"
ln -s "$R/.opencode/commands/tutor.md" "$P/.opencode/commands/tutor.md"
PROVIDER='"fake":{"npm":"@ai-sdk/openai-compatible","name":"Fake","options":{"baseURL":"http://127.0.0.1:'$PORT'/v1"},"models":{"coder":{"name":"coder","tool_call":true}}}'
cat > "$P/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "fake/coder",
  "provider": {$PROVIDER},
  "mcp": {"coding-tutor": {"type": "local", "command": ["python3", "$R/mcp/server.py"]}},
  "permission": {"read": {"*": "allow", "*secret.txt": "deny"}, "edit": "allow", "bash": {"*": "allow", "*secret*": "deny"}}
}
EOF
python3 - "$P" > "$W/script.json" <<'EOF'
import json, sys
p = sys.argv[1]
print(json.dumps([
    {"text": "", "tools": [["coding-tutor_begin_session", {"task": "Fix add", "request": "fix the add function"}]]},
    {"text": "Why: I need to see add before changing it.", "tools": [["read", {"filePath": p + "/calc.py"}]]},
    {"text": "Why: add subtracts instead of adding.", "tools": [["edit", {"filePath": p + "/calc.py", "oldString": "return a - b", "newString": "return a + b"}]]},
    {"text": "", "tools": [["read", {"filePath": p + "/secret.txt"}]]},
    {"text": "", "tools": [["bash", {"command": "python3 -c 'import calc; print(calc.add(2, 3))'", "description": "check add"}]]},
    {"text": "", "tools": [["bash", {"command": "python3 -c 'import calc; print(calc.add(1, 1))'", "description": "check again"}]]},
    {"text": "Done: add now adds.", "tools": []},
]))
EOF
python3 "$R/spike/opencode-probe/fake_model.py" $PORT "$W/script.json" "$W/model.log" &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
sleep 1
export OPENCODE_CONFIG_CONTENT="{\"provider\":{$PROVIDER}}"
if [ -n "$TUI" ]; then
  INTERACTIVE=1 node "$R/spike/e2e/harness.js" "$P" "$(command -v opencode)" fake/coder - "$W/log.json" x ${RECAP:+"after:5:also add a test"} 2> "$W/harness.txt" &
  HARNESS=$!
  sleep 1
  tmux kill-session -t ctoc 2>/dev/null || true
  tmux new-session -d -s ctoc -x 160 -y 45 -c "$P" "opencode"
  i=0; until tmux capture-pane -p -t ctoc | grep -q "Ask anything"; do sleep 0.5; i=$((i+1)); [ $i -lt 60 ] || break; done
  sleep 1
  tmux send-keys -t ctoc -l "/tutor fix add"; sleep 1; tmux send-keys -t ctoc Enter; sleep 0.5; tmux send-keys -t ctoc Enter
  if [ -n "$RECAP" ]; then
    i=0; until grep -q "session finished" "$W/harness.txt"; do sleep 0.5; i=$((i+1)); [ $i -lt 300 ] || { echo "the session did not finish"; break; }; done
    sleep 1
    echo "--- screen at the end"; tmux capture-pane -p -t ctoc | grep -v '^\s*$' | tail -14
  else
    # Wait for the first narration, then press Esc while the next step is held.
    i=0; until grep -q "SAY: " "$W/harness.txt" && grep -q "step holding" "$W/harness.txt"; do sleep 0.5; i=$((i+1)); [ $i -lt 120 ] || { echo "no held step"; break; }; done
    tmux send-keys -t ctoc Escape; sleep 0.3; tmux send-keys -t ctoc Escape
    sleep 4
    echo "--- screen after Esc"; tmux capture-pane -p -t ctoc | grep -v '^\s*$' | tail -10
  fi
  tmux kill-session -t ctoc
  wait $HARNESS || true
else
  CODER=opencode node "$R/spike/e2e/harness.js" "$P" "$(command -v opencode)" fake/coder fake/coder "$W/log.json" "fix add" "after:2:why a plus and not sum()?" 2> "$W/harness.txt"
fi
echo "--- harness"; grep -v "narrator: " "$W/harness.txt" | cut -c1-240
echo "--- calc.py now"; cat "$P/calc.py"
echo "--- does the secret appear in anything the narrator was told?"
python3 -c "
import json; log = json.load(open('$W/log.json'))
told = json.dumps([t['prompt'] for t in log['turns']])
print('hunter2 in narrator input:', 'hunter2' in told, '| narrator turns:', len(log['turns']))"
python3 -c "
import json
tools = set(); denied = []
for l in open('$W/model.log'):
    b = json.loads(l)['body']
    names = [t['function']['name'] for t in b.get('tools') or []]
    if 'StructuredOutput' in names: tools.add(tuple(names))
    for m in b['messages']:
        if m.get('role') == 'tool' and 'Held by Coding Tutor' in str(m.get('content')): denied.append(str(m['content'])[:160])
print('tools offered to the narrator:', tools)
print('held steps the coder saw:', sorted(set(denied)))"

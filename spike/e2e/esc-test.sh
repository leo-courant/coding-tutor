#!/bin/sh
# SPIKE - throwaway. Runs on the host. An interactive coder in tmux runs /tutor;
# when a step is held while the narrator speaks, press Esc, and check that the
# harness saw the held connection drop and ended the session.
set -e
R=$(cd "$(dirname "$0")/../.." && pwd)
W=$HOME/.cache/coding-tutor-esc-test
rm -rf "$W"; mkdir -p "$W"; cp -r "$R/spike/sample" "$W/project"
INTERACTIVE=1 "$HOME/.local/bin/node" "$R/spike/e2e/harness.js" "$W/project" "$HOME/.local/bin/claude" sonnet sonnet "$W/log.json" x 2> "$W/harness.txt" &
HARNESS=$!
sleep 1
tmux new-session -d -s esctest -x 200 -y 50 -c "$W/project" \
  "$HOME/.local/bin/claude --model sonnet --permission-mode acceptEdits --allowedTools Read Edit mcp__coding-tutor__begin_session"
sleep 6; tmux send-keys -t esctest Down; sleep 0.5; tmux send-keys -t esctest Enter   # "Yes, I trust this folder"
# Wait for the input box, type the task, and check it landed before sending.
i=0; until tmux capture-pane -p -t esctest | grep -q "accept edits on"; do sleep 0.5; i=$((i+1)); [ $i -lt 60 ] || break; done
sleep 2
tmux send-keys -t esctest -l "/tutor In retry.py, make the delay grow exponentially. Then, as a separate edit, rename last_error to final_error."
i=0; until tmux capture-pane -p -t esctest | grep -q "final_error"; do sleep 0.5; i=$((i+1)); [ $i -lt 20 ] || { echo "the task did not appear in the input box"; break; }; done
sleep 1; tmux send-keys -t esctest Enter
# Wait for a held step after the first edit, then press Esc.
i=0
until grep -q "step holding" "$W/harness.txt" && grep -q "SAY: " "$W/harness.txt" && [ "$(grep -c 'SAY: ' "$W/harness.txt")" -ge 2 ]; do
  sleep 0.5; i=$((i+1)); [ $i -lt 360 ] || { echo "no held step"; break; }
done
sleep 1
tmux capture-pane -p -t esctest | grep -i "coding tutor" | tail -2 || true
tmux send-keys -t esctest Escape
sleep 4
echo "--- screen after Esc"; tmux capture-pane -p -t esctest | grep -v '^\s*$' | tail -8
tmux kill-session -t esctest
wait $HARNESS || true
echo "--- harness"; cat "$W/harness.txt" | grep -v "narrator: " | cut -c1-220
echo "--- retry.py now"; cat "$W/project/retry.py"

#!/bin/sh
# SPIKE - throwaway. Interactive check, for a person at the keyboard: while a
# PreToolUse hook holds an edit for 30 s, does the chat say why, and does Esc
# stop the hold?
#
#   sh spike/hooks-probe/esc-test.sh
#
# The session starts with the prompt already sent. When the edit is held (30 s),
# note what the chat shows, then press Esc. Type /exit when done, then
# look at the printed log.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
CLAUDE=$(ls -d "$HOME"/.var/app/com.visualstudio.code/data/vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | tail -1)
[ -n "$CLAUDE" ] || CLAUDE=claude
OUT=$(mktemp -d "${TMPDIR:-/tmp}/esc-test.XXXXXX")
cp -r "$HERE/../sample" "$OUT/project"
cat > "$OUT/settings.json" <<EOF
{"hooks": {"PreToolUse": [{"matcher": "Edit", "hooks": [{
  "type": "command",
  "command": "python3 $HERE/probe.py $OUT/hooks.jsonl sleep-30",
  "timeout": 60,
  "onFailure": "block",
  "statusMessage": "Coding Tutor: the narrator is speaking"
}]}]}}
EOF
cd "$OUT/project"
"$CLAUDE" --settings "$OUT/settings.json" --setting-sources project --model sonnet \
  --permission-mode acceptEdits "Change the delay in retry.py to grow exponentially (delay * 2 ** attempt)."
echo
echo "Hook log: $OUT/hooks.jsonl"
echo "File now:"; cat "$OUT/project/retry.py"

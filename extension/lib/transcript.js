// The transcript: the saved captions of a narrated session, written as it goes
// so an interrupted session still leaves a record.
const fs = require('fs');
const os = require('os');
const path = require('path');

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session';
}

function start(task, workspaceFolder) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const stamp = `${day}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const project = workspaceFolder ? path.basename(workspaceFolder) : 'no-project';
  const dir = path.join(os.homedir(), '.local', 'share', 'coding-tutor', 'transcripts', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stamp}-${slug(task)}.md`);
  fs.writeFileSync(file, `# ${task}\n\nNarrated session in \`${project}\`, started ${day} ${pad(now.getHours())}:${pad(now.getMinutes())}.\n\n`);
  return file;
}

function append(file, caption, workspaceFolder) {
  if (caption.engineer) {
    fs.appendFileSync(file, `- **You:** ${caption.text}\n\n`);
    return;
  }
  let where = '';
  if (caption.file) {
    const rel = workspaceFolder ? path.relative(workspaceFolder, caption.file) : caption.file;
    const lines = caption.startLine ? `:${caption.startLine}${caption.endLine && caption.endLine !== caption.startLine ? '-' + caption.endLine : ''}` : '';
    where = `\n\n  \`${rel}${lines}\``;
  }
  fs.appendFileSync(file, `- ${caption.text}${where}\n\n`);
}

// How long something took, in words a person would say: "under a minute",
// "12 minutes", "1 hour 5 minutes".
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (!hours) return plural(rest, 'minute');
  return rest ? `${plural(hours, 'hour')} ${plural(rest, 'minute')}` : plural(hours, 'hour');
}

// Closes the transcript: the recap, if there is one, then when the session
// ended and how long it took.
function finish(file, recap, startedAt, endedAt = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const ended = `${pad(endedAt.getHours())}:${pad(endedAt.getMinutes())}`;
  const recapPart = recap ? `## Recap\n\n${recap}\n\n` : '';
  fs.appendFileSync(file, `${recapPart}Session ended ${ended}, after ${formatDuration(endedAt - startedAt)}.\n`);
}

module.exports = { start, append, finish, formatDuration };

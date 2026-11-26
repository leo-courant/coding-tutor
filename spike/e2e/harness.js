// SPIKE - throwaway. A narrated session end to end without VS Code: a real coder
// (headless Claude Code running /tutor, with its real hooks and MCP server), the
// product's session coordinator and narrator, and this harness standing in for
// the extension's window (same routes, a silent voice, a pointer that logs the
// lines it would show). An engineer script interrupts at chosen moments.
//
//   node spike/e2e/harness.js <project> <claude-cli> <narrator-model> <coder-model> <log.json> <task> [after:N:words ...]
//
// With INTERACTIVE=1 it starts no coder: run one yourself (for example in tmux)
// in <project>. The voice then takes the full reading time.
//
// With CODER=opencode, <claude-cli> is the opencode CLI, the coder runs
// `opencode run --command tutor <task>` (its model is the project's), and the
// narrator runs through OpenCode on <narrator-model> (provider/model).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Control } = require('../../extension/lib/speaker');
const { createNarrator, launchFor } = require('../../extension/lib/narrator');
const { createOpencodeNarrator } = require('../../extension/lib/opencode-narrator');
const { createSession } = require('../../extension/lib/session');
const { readingTimeMs } = require('../../extension/lib/sentences');

const [project, cli, narratorModel, coderModel, logFile, task, ...script] = process.argv.slice(2);
const engineerScript = script.map((s) => { const [, n, ...words] = s.split(':'); return { after: Number(n), text: words.join(':') }; });
const t0 = Date.now();
const log = { events: [], captions: [], turns: [], holds: [], notes: [] };
const at = () => (Date.now() - t0) / 1000;
const note = (line) => { log.notes.push(`${at().toFixed(1)} ${line}`); process.stderr.write(`[${at().toFixed(1)}] ${line}\n`); };

const control = new Control();
let narrator = null;
const session = createSession({
  control,
  speaker: {
    async speak(text) {
      // Silent, at a third of reading time, but interruptible like the voice.
      const ms = readingTimeMs(text) / (process.env.INTERACTIVE ? 1 : 3);
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (control.message) return { outcome: 'interrupted' };
        await new Promise((r) => setTimeout(r, 20));
      }
      return { outcome: 'spoken' };
    },
  },
  startNarrator: ({ agent, cli: coderCli }) => {
    note(`narrator starts for ${agent} with ${coderCli}`);
    const sp = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'session-script.md'), 'utf8').replace(/\{\{defaultDepth\}\}/g, 'outline');
    const dir = path.join(os.homedir(), '.coding-tutor', 'narrator');
    fs.mkdirSync(dir, { recursive: true });
    if (agent === 'opencode') {
      narrator = createOpencodeNarrator({ cli: coderCli, model: narratorModel, systemPrompt: sp, cwd: dir, log: note });
    } else {
      const { command, args } = launchFor(agent, { cli: coderCli, model: narratorModel, systemPrompt: sp });
      narrator = createNarrator({ command, args, cwd: dir, log: note });
    }
    return {
      async ask(prompt) {
        const t = Date.now();
        const r = await narrator.ask(prompt);
        log.turns.push({ at: at(), seconds: (Date.now() - t) / 1000, prompt, answer: r.answer, error: r.error });
        return r;
      },
      get costUsd() { return narrator.costUsd; },
      get turns() { return narrator.turns; },
      close: () => narrator.close(),
    };
  },
  point: async (file, startLine, endLine) => {
    if (!file) return;
    let shown = null;
    try { shown = fs.readFileSync(file, 'utf8').split('\n').slice(startLine - 1, endLine).join('\n'); } catch { shown = '(cannot read)'; }
    log.captions.push({ pointer: { file, startLine, endLine, shown } });
  },
  caption: (c) => {
    const last = log.captions[log.captions.length - 1];
    if (last && last.pointer && !last.text) Object.assign(last, c); else log.captions.push({ ...c });
    note(`${c.engineer ? 'ENGINEER' : 'SAY'}: ${c.text}${c.file ? `  -> ${path.basename(c.file)}:${c.startLine}-${c.endLine}` : ''}`);
    const said = log.captions.filter((x) => x.text && !x.engineer).length;
    for (const e of engineerScript) {
      if (!e.done && !c.engineer && said === e.after) {
        e.done = true;
        setTimeout(() => session.engineer(e.text), 50);
      }
    }
  },
  config: () => ({}),
  log: note,
});

let finished;
const done = new Promise((r) => { finished = r; });
session.onFinish((s) => { note(`session finished: ${JSON.stringify(s)}`); finished(s); });

const token = crypto.randomBytes(16).toString('hex');
const windowFile = path.join(os.homedir(), '.coding-tutor', 'windows', `e2e-${process.pid}.json`);
let narrating = false;
const writeWindow = (port) => fs.writeFileSync(windowFile, JSON.stringify({ port, token, folders: [project], pid: process.pid, narrating }));
const server = http.createServer((req, res) => {
  let replied = false;
  const reply = (obj) => { replied = true; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers['x-coding-tutor-token'] !== token) { res.writeHead(403); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const m = JSON.parse(body || '{}');
    if (req.url === '/session/begin') {
      note(`begin_session ${JSON.stringify(m)}`);
      session.begin(m.task, m.request || '');
      narrating = true;
      writeWindow(server.address().port);
      return reply({ ok: true, voice: 'silent (test harness)' });
    }
    const started = Date.now();
    const short = { kind: m.kind, file: m.file, command: m.command, what: m.what, name: m.name, text: m.text && m.text.slice(0, 120), session: m.session };
    log.events.push({ at: at(), ...short });
    const stopped = new AbortController();
    res.on('close', () => { if (!replied) stopped.abort(); });
    const holding = (m.kind === 'step' || m.kind === 'end') && setTimeout(() => note(`${m.kind} holding`), 300);
    res.on('close', () => { if (!replied) note(`${m.kind} connection dropped while held`); });
    const answer = await session.event(m, { signal: stopped.signal });
    clearTimeout(holding);
    if (m.kind === 'step' || m.kind === 'end') {
      const held = (Date.now() - started) / 1000;
      log.holds.push({ at: at(), kind: m.kind, held, answer });
      if (held > 0.3 || answer.decision !== 'allow') note(`${m.kind} held ${held.toFixed(1)} s -> ${answer.decision}${answer.reason ? `: ${answer.reason}` : ''}`);
    }
    reply({ ok: true, ...answer });
  });
});

server.listen(0, '127.0.0.1', async () => {
  writeWindow(server.address().port);
  if (process.env.INTERACTIVE) {
    note('waiting for a coder to run /tutor in the project');
    const summary = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 240000))]);
    await new Promise((r) => setTimeout(r, 1500));
    log.summary = summary;
    fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
    try { fs.unlinkSync(windowFile); } catch { /* gone */ }
    note(`done: ${JSON.stringify(summary)}`);
    process.exit(0);
  }
  const prompt = `/tutor ${task}`;
  const coder = process.env.CODER === 'opencode'
    ? spawn(cli, ['run', ...(coderModel !== '-' ? ['-m', coderModel] : []), '--command', 'tutor', task], { cwd: project, env: { ...process.env, PWD: project }, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(cli, ['-p', prompt, '--model', coderModel, '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(python3:*)', 'mcp__coding-tutor__begin_session',
      '--output-format', 'stream-json', '--verbose'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  let coderOut = '';
  coder.stdout.on('data', (d) => (coderOut += d));
  coder.stderr.on('data', (d) => note(`coder stderr: ${String(d).trim()}`));
  const code = await new Promise((r) => coder.on('exit', r));
  const result = coderOut.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).find((r) => r.type === 'result') || {};
  log.coder = { exit: code, costUsd: result.total_cost_usd, turns: result.num_turns, result: result.result };
  const summary = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 3000))]);
  log.summary = summary;
  fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
  try { fs.unlinkSync(windowFile); } catch { /* gone */ }
  note(`coder exit ${code}, coder cost $${result.total_cost_usd}, narrator cost $${summary ? summary.costUsd.toFixed(4) : '?'}`);
  process.exit(0);
});

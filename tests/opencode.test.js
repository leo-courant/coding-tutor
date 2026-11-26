// The OpenCode adapter (mcp/opencode.js), against a fake extension window.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { CodingTutor } = require('../mcp/opencode.js');

const { adapter, after, hunksFromDiff, STOPPED } = CodingTutor.forTests;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// A fake extension window: records each event, answers with `reply(event)`
// (a promise, to hold), and notes connections that dropped before the answer.
async function setup({ narrating = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-opencode-'));
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  const windowsDir = path.join(dir, 'windows');
  fs.mkdirSync(windowsDir);
  const t = { events: [], dropped: [], prompts: [], reply: async () => ({ ok: true, decision: 'allow' }) };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const ev = JSON.parse(body);
      t.events.push(ev);
      let answered = false;
      res.on('close', () => { if (!answered) t.dropped.push(ev.kind); });
      const answer = await t.reply(ev);
      answered = true;
      if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer)); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.window = (on) => fs.writeFileSync(path.join(windowsDir, 'w.json'),
    JSON.stringify({ port: server.address().port, token: 'tok', folders: [project], narrating: on }));
  t.window(narrating);
  const client = { session: { promptAsync: async (o) => { t.prompts.push(o); return {}; } } };
  t.hooks = adapter({ directory: project, client, cli: '/opt/opencode', windowsDir, logFile: path.join(dir, 'hook.log') });
  t.logFile = path.join(dir, 'hook.log');
  t.close = () => { server.closeAllConnections(); server.close(); };
  return t;
}

const before = (t, tool = 'edit', sessionID = 'S1') => t.hooks['tool.execute.before']({ tool, sessionID, callID: 'c1' }, { args: { filePath: '/p/secret.txt' } });

test('does nothing when no session is being narrated', async (c) => {
  const t = await setup({ narrating: false });
  c.after(t.close);
  await before(t);
  await t.hooks['tool.execute.after']({ tool: 'read', sessionID: 'S1', args: {} }, { output: 'x', metadata: {} });
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'S1' } } });
  assert.deepStrictEqual(t.events, []);
});

test('a step carries nothing of what it is about to do, and goes through when allowed', async (c) => {
  const t = await setup();
  c.after(t.close);
  await before(t, 'bash');
  assert.deepStrictEqual(t.events, [{ kind: 'step', session: 'S1', agent: 'opencode', cli: '/opt/opencode' }]);
});

test('a held step refused with the reason, which is what the coder sees', async (c) => {
  const t = await setup();
  c.after(t.close);
  t.reply = async () => ({ ok: true, decision: 'deny', reason: 'Held by Coding Tutor. Rename it.' });
  await assert.rejects(before(t), { message: 'Held by Coding Tutor. Rename it.' });
});

test('a pause that outlasts the hold is held again here, without telling the coder', async (c) => {
  const t = await setup();
  c.after(t.close);
  let n = 0;
  t.reply = async () => ((n += 1) === 1 ? { ok: true, decision: 'deny', reason: 'paused', paused: true } : { ok: true, decision: 'allow' });
  await before(t);
  assert.strictEqual(t.events.filter((e) => e.kind === 'step').length, 2);
});

test('Esc while a step is held refuses the step and drops its connection', async (c) => {
  const t = await setup();
  c.after(t.close);
  t.reply = () => new Promise(() => {}); // held until the engineer does something
  const step = before(t);
  await tick(30);
  await t.hooks.event({ event: { type: 'session.error', properties: { sessionID: 'S1', error: { name: 'MessageAbortedError', data: {} } } } });
  await assert.rejects(step, { message: STOPPED });
  await tick(30);
  assert.deepStrictEqual(t.dropped, ['step']);
  t.window(false); // the extension ended the session
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'S1' } } });
  t.window(true);
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'S1' } } });
  await tick(30);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['step', 'end'], 'no recap for the stopped turn; the next one gets one');
});

test('Esc while nothing is held tells the extension the engineer stopped the coder', async (c) => {
  const t = await setup();
  c.after(t.close);
  await t.hooks.event({ event: { type: 'session.error', properties: { sessionID: 'S1', error: { name: 'MessageAbortedError' } } } });
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'S1' } } });
  await tick(30);
  assert.deepStrictEqual(t.events.map((e) => e.kind), ['stopped']);
});

test('the end of the turn gets the coder\'s last text; a reason for the coder becomes its next message', async (c) => {
  const t = await setup();
  c.after(t.close);
  await t.hooks['experimental.text.complete']({ sessionID: 'S1', messageID: 'm1', partID: 'p1' }, { text: 'Done: add adds.' });
  t.reply = async (ev) => (ev.kind === 'end' ? { ok: true, decision: 'block', reason: 'Held by Coding Tutor. Also add a test.' } : { ok: true });
  await t.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'S1' } } });
  await tick(30);
  assert.deepStrictEqual(t.events.map((e) => [e.kind, e.text || e.lastMessage]), [['text', 'Done: add adds.'], ['end', 'Done: add adds.']]);
  assert.deepStrictEqual(t.prompts, [{ path: { id: 'S1' }, body: { parts: [{ type: 'text', text: 'Held by Coding Tutor. Also add a test.' }] } }]);
});

test('never gets in the way when something is wrong', async (c) => {
  const t = await setup();
  c.after(t.close);
  t.window(true);
  fs.writeFileSync(path.join(path.dirname(t.logFile), 'windows', 'w.json'), JSON.stringify({ port: 1, token: 'x', folders: ['/'], narrating: true }));
  await before(t); // nothing listening: goes through
  t.reply = async () => ({ ok: false, error: 'boom' });
  t.window(true);
  await before(t); // the extension failed: goes through
  assert.match(fs.readFileSync(t.logFile, 'utf8'), /boom/);
});

// ---- what each tool's result becomes ------------------------------------------

test('a read passes what the read returned, with its lines', () => {
  const out = { output: '<content>…</content>', metadata: { display: { type: 'file', path: '/p/x.py', text: '    return a - b\n\n', lineStart: 2, lineEnd: 4, totalLines: 6 } } };
  assert.deepStrictEqual(after('read', { filePath: '/p/x.py', offset: 2 }, out),
    { kind: 'read', file: '/p/x.py', startLine: 2, text: '    return a - b\n\n', totalLines: 6 });
  assert.deepStrictEqual(after('read', { filePath: '/p' }, { metadata: { display: { type: 'directory', entries: ['x.py'] } } }), { kind: 'tool', name: 'read' });
});

test('an edit passes the diff OpenCode reported, as hunks', () => {
  const diff = 'Index: /p/calc.py\n===\n--- /p/calc.py\n+++ /p/calc.py\n@@ -1,2 +1,3 @@\n def add(a, b):\n-    return a - b\n+    # adds\n+    return a + b\n';
  const ev = after('edit', { filePath: '/p/calc.py', oldString: 'return a - b', newString: '# adds\n    return a + b' }, { output: 'Edit applied successfully.', metadata: { diff } });
  assert.deepStrictEqual(ev, {
    kind: 'edit', file: '/p/calc.py', oldText: 'return a - b', newText: '# adds\n    return a + b', created: false,
    hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' def add(a, b):', '-    return a - b', '+    # adds', '+    return a + b'] }],
  });
  assert.deepStrictEqual(hunksFromDiff('@@ -5 +5,2 @@\n-a\n+b\n+c\n\\ No newline at end of file'), [{ oldStart: 5, oldLines: 1, newStart: 5, newLines: 2, lines: ['-a', '+b', '+c'] }]);
});

test('a write is a new file or a whole rewrite', () => {
  assert.deepStrictEqual(after('write', { filePath: '/p/n.py', content: 'x\n' }, { metadata: { filepath: '/p/n.py', exists: false } }),
    { kind: 'edit', file: '/p/n.py', oldText: null, newText: 'x\n', hunks: [], created: true });
  assert.strictEqual(after('write', { filePath: '/p/n.py', content: 'y\n' }, { metadata: { exists: true } }).created, false);
});

test('commands, searches, Coding Tutor\'s own tool, and the rest', () => {
  assert.deepStrictEqual(after('bash', { command: 'ls' }, { output: 'a\n', metadata: { exit: 0 } }), { kind: 'command', command: 'ls', output: 'a\n' });
  assert.strictEqual(after('grep', { pattern: 'def ', path: '/p', include: '*.py' }, { output: 'Found 1 match' }).what, '"def " in /p (files *.py)');
  assert.deepStrictEqual(after('glob', { pattern: '**/*.py' }, { output: '' }), { kind: 'search', what: 'files named **/*.py', result: 'no files' });
  assert.deepStrictEqual(after('coding-tutor_begin_session', { task: 't' }, { output: 'Session started.' }), { kind: 'bind' });
  assert.deepStrictEqual(after('webfetch', { url: 'x' }, { output: 'page' }), { kind: 'tool', name: 'webfetch' });
});

test('in the narrator\'s own OpenCode server, the plugin does nothing', async () => {
  process.env.CODING_TUTOR_NARRATOR = '1';
  try {
    assert.deepStrictEqual(await CodingTutor({ directory: '/p', client: {} }), {});
  } finally {
    delete process.env.CODING_TUTOR_NARRATOR;
  }
});

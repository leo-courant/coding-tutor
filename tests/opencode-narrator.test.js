// The narrator through OpenCode (extension/lib/opencode-narrator.js), against a
// stand-in `opencode serve`: a fake process that says where it listens, and a
// fake fetch that answers its HTTP API.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createOpencodeNarrator, narratorConfig, parseModel, AGENT } = require('../extension/lib/opencode-narrator');
const { ANSWER_SCHEMA } = require('../extension/lib/narrator');

const ANSWER = { parts: [{ say: 'It now adds.', edit: 1, file: null, startLine: null, endLine: null }], toCoder: null };

// `reply(body, n)` makes the assistant message for the nth narration (undefined: never answers).
function fakeOpencode({ reply = () => ({ structured: ANSWER, cost: 0.002 }), listens = true } = {}) {
  const t = { started: [], requests: [], deleted: [] };
  t.spawn = (command, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null, 'SIGTERM')); };
    t.started.push({ command, args, env: opts.env, cwd: opts.cwd, child });
    if (listens) setImmediate(() => child.stdout.write(`opencode server listening on http://127.0.0.1:${args[args.indexOf('--port') + 1]}\n`));
    return child;
  };
  let narrations = 0;
  t.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    t.requests.push({ url, method: init.method, auth: init.headers && init.headers.Authorization, body });
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });
    if (init.method === 'POST' && url.endsWith('/session')) return ok({ id: `ses_${t.started.length}` });
    if (init.method === 'DELETE') { t.deleted.push(url); return ok(true); }
    narrations += 1;
    const info = reply(body, narrations);
    if (info === undefined) {
      // A real request holds a socket open; this stands in for it, so the
      // (unref'd) timeout timer is not the only thing keeping the test alive.
      const open = setInterval(() => {}, 1000);
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
        clearInterval(open);
        reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
      }));
    }
    return ok({ info: { role: 'assistant', ...info }, parts: [] });
  };
  t.narrator = (opts = {}) => createOpencodeNarrator({
    cli: '/opt/opencode', systemPrompt: 'You are the narrator.', cwd: '/home/e/.coding-tutor/narrator',
    env: { HOME: '/home/e' }, spawn: t.spawn, fetch: t.fetch, getPort: async () => 4567, ...opts,
  });
  return t;
}

test('one server per session, on localhost with a password, as an agent with no tools', async () => {
  const t = fakeOpencode();
  const n = t.narrator();
  assert.deepStrictEqual(await n.ask('Edit 1: ...'), { answer: ANSWER, error: null });
  await n.ask('Edit 2: ...');
  assert.strictEqual(t.started.length, 1);
  const { command, args, env, cwd } = t.started[0];
  assert.deepStrictEqual([command, ...args], ['/opt/opencode', 'serve', '--hostname', '127.0.0.1', '--port', '4567']);
  assert.strictEqual(cwd, '/home/e/.coding-tutor/narrator');
  assert.strictEqual(env.CODING_TUTOR_NARRATOR, '1');
  assert.match(env.OPENCODE_SERVER_PASSWORD, /^[0-9a-f]{48}$/);
  const agent = JSON.parse(env.OPENCODE_CONFIG_CONTENT).agent[AGENT];
  assert.deepStrictEqual(agent.tools, { '*': false, StructuredOutput: true });
  assert.deepStrictEqual(agent.permission, { '*': 'deny' });
  assert.strictEqual(agent.prompt, 'You are the narrator.');
  const expected = `Basic ${Buffer.from(`opencode:${env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
  assert.ok(t.requests.every((r) => r.auth === expected), 'every request carries the password');
  const msg = t.requests.find((r) => r.url.endsWith('/session/ses_1/message'));
  assert.deepStrictEqual(msg.body, { agent: AGENT, format: { type: 'json_schema', schema: ANSWER_SCHEMA }, parts: [{ type: 'text', text: 'Edit 1: ...' }] });
  assert.ok(!('model' in msg.body), "an empty model setting means OpenCode's default model");
  assert.ok(Math.abs(n.costUsd - 0.004) < 1e-9);
  assert.strictEqual(n.turns, 2);
});

test('the model setting is OpenCode\'s provider/model', async () => {
  const t = fakeOpencode();
  await t.narrator({ model: 'local/qwen3.6-35b' }).ask('x');
  assert.deepStrictEqual(t.requests.find((r) => r.url.endsWith('/message')).body.model, { providerID: 'local', modelID: 'qwen3.6-35b' });
  assert.deepStrictEqual(parseModel('openrouter/openai/gpt-5'), { providerID: 'openrouter', modelID: 'openai/gpt-5' });
  const bad = await fakeOpencode().narrator({ model: 'sonnet' }).ask('x');
  assert.match(bad.error, /provider\/model/);
});

test('a failed structured answer is an error, and the server keeps running', async () => {
  const t = fakeOpencode({ reply: (b, n) => (n === 1 ? { error: { name: 'StructuredOutputError', data: { message: 'Model did not produce structured output' } } } : { structured: ANSWER }) });
  const n = t.narrator();
  assert.deepStrictEqual(await n.ask('a'), { answer: null, error: 'Model did not produce structured output' });
  assert.deepStrictEqual(await n.ask('b'), { answer: ANSWER, error: null });
  assert.strictEqual(t.started.length, 1);
});

test('a narrator that takes too long is restarted', async () => {
  const t = fakeOpencode({ reply: (b, n) => (n === 1 ? undefined : { structured: ANSWER }) });
  const n = t.narrator({ turnTimeoutMs: 30 });
  assert.deepStrictEqual(await n.ask('a'), { answer: null, error: 'the narrator took too long to answer' });
  assert.deepStrictEqual(await n.ask('b'), { answer: ANSWER, error: null });
  assert.strictEqual(t.started.length, 2);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(t.started[0].child.killed, true);
});

test('a server that never starts is an error, not a hang, and is tried again', async () => {
  const t = fakeOpencode({ listens: false });
  const n = t.narrator({ startTimeoutMs: 20 });
  assert.match((await n.ask('a')).error, /did not start/);
  assert.strictEqual(t.started[0].child.killed, true);
  await n.ask('b');
  assert.strictEqual(t.started.length, 2);
});

test('closing removes the narrator\'s session and stops its server', async () => {
  const t = fakeOpencode();
  const n = t.narrator();
  await n.ask('a');
  n.close();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(t.deleted, ['http://127.0.0.1:4567/session/ses_1']);
  assert.strictEqual(t.started[0].child.killed, true);
  assert.deepStrictEqual(await n.ask('b'), { answer: null, error: 'the narrator was closed' });
});

test('the narrator config names no model, and keeps what the engineer already passes OpenCode', () => {
  const cfg = narratorConfig('p');
  assert.deepStrictEqual(Object.keys(cfg), ['agent']);
  assert.ok(!('model' in cfg.agent[AGENT]));
  const theirs = narratorConfig('p', JSON.stringify({ provider: { local: { options: {} } }, agent: { mine: { prompt: 'x' }, [AGENT]: { tools: { read: true } } } }));
  assert.deepStrictEqual(Object.keys(theirs.provider), ['local']);
  assert.deepStrictEqual(Object.keys(theirs.agent).sort(), [AGENT, 'mine']);
  assert.deepStrictEqual(theirs.agent[AGENT].tools, { '*': false, StructuredOutput: true }, 'ours replaces an agent of the same name');
  assert.deepStrictEqual(narratorConfig('p', 'not json'), narratorConfig('p'));
});

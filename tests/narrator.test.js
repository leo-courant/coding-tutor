const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createNarrator, launchFor } = require('../extension/lib/narrator');

// A fake agent CLI in stream-json mode: answers each user message with a result
// line made by `reply(text, n)`. Records every process it starts.
function fakeCli(reply) {
  const started = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null, 'SIGTERM')); };
    child.got = [];
    let cost = 0;
    let buf = '';
    child.stdin.on('data', (d) => {
      buf += d;
      let at;
      while ((at = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, at));
        buf = buf.slice(at + 1);
        child.got.push(msg.message.content);
        const r = reply(msg.message.content, child.got.length);
        if (r === undefined) continue; // never answers
        cost += 0.01;
        setImmediate(() => child.stdout.write(JSON.stringify({ type: 'result', total_cost_usd: cost, ...r }) + '\n'));
      }
    });
    started.push({ command, args, child });
    return child;
  };
  return { spawn, started };
}

const answer = (say) => ({ structured_output: { say, edit: null, file: null, startLine: null, endLine: null, toCoder: null } });

test('keeps one process for the session and answers in order', async () => {
  const cli = fakeCli((text) => answer(`heard ${text}`));
  const n = createNarrator({ command: 'claude', args: [], spawn: cli.spawn });
  const [a, b] = await Promise.all([n.ask('one'), n.ask('two')]);
  assert.strictEqual(a.answer.say, 'heard one');
  assert.strictEqual(b.answer.say, 'heard two');
  assert.strictEqual(cli.started.length, 1);
  assert.strictEqual(n.turns, 2);
  assert.ok(Math.abs(n.costUsd - 0.02) < 1e-9, 'the cost is the CLI\'s running total');
});

test('an error result gives no answer but the reason', async () => {
  const cli = fakeCli(() => ({ is_error: true, result: 'not logged in' }));
  const n = createNarrator({ command: 'claude', args: [], spawn: cli.spawn });
  assert.deepStrictEqual(await n.ask('x'), { answer: null, error: 'not logged in' });
});

test('a narrator that never answers is given up on, and the next question starts a new one', async () => {
  const cli = fakeCli((text, count) => (count === 1 && text === 'first' ? undefined : answer('ok')));
  const n = createNarrator({ command: 'claude', args: [], spawn: cli.spawn, turnTimeoutMs: 30 });
  assert.strictEqual((await n.ask('first')).answer, null);
  assert.strictEqual((await n.ask('second')).answer.say, 'ok');
  assert.strictEqual(cli.started.length, 2);
  assert.ok(cli.started[0].child.killed);
});

test('costs of a restarted narrator add up', async () => {
  const cli = fakeCli(() => answer('ok'));
  const n = createNarrator({ command: 'claude', args: [], spawn: cli.spawn });
  await n.ask('a');
  cli.started[0].child.kill();
  await new Promise((r) => setImmediate(r));
  await n.ask('b');
  assert.strictEqual(cli.started.length, 2);
  assert.ok(Math.abs(n.costUsd - 0.02) < 1e-9);
});

test('a CLI that is not installed is reported, not thrown', async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
    return child;
  };
  const n = createNarrator({ command: 'claude', args: [], spawn });
  const r = await n.ask('x');
  assert.strictEqual(r.answer, null);
  assert.match(r.error, /not found/);
});

test('Claude Code narrator: no tools, no MCP servers, structured answers, the default model unless one is set', () => {
  const plain = launchFor('claude-code', { cli: '/bin/claude', model: '', systemPrompt: 'P' });
  assert.strictEqual(plain.command, '/bin/claude');
  const i = plain.args.indexOf('--tools');
  assert.strictEqual(plain.args[i + 1], '');
  assert.ok(plain.args.includes('--strict-mcp-config'));
  assert.ok(plain.args.includes('--json-schema'));
  assert.ok(!plain.args.includes('--model'), 'an empty setting leaves the model to the agent');
  const set = launchFor('claude-code', { cli: '', model: 'sonnet', systemPrompt: 'P' });
  assert.strictEqual(set.command, 'claude');
  assert.deepStrictEqual(set.args.slice(-2), ['--model', 'sonnet']);
});

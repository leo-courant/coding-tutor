const test = require('node:test');
const assert = require('node:assert');
const { Control, createSpeaker } = require('../extension/lib/speaker');
const { createSession, STILL_PAUSED } = require('../extension/lib/session');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
// The narrator's answer: one part saying `text` (none when null), pointing as
// `extra` says, and `toCoder`.
const say = (text, { toCoder = null, ...where } = {}) => ({
  parts: text === null ? [] : [{ say: text, edit: null, file: null, startLine: null, endLine: null, ...where }],
  toCoder,
});

const EDIT = {
  kind: 'edit', file: '/p/retry.py', oldText: 'a', newText: 'b\nc',
  hunks: [{ oldStart: 3, oldLines: 3, newStart: 3, newLines: 4, lines: [' x', '-a', '+b', '+c', ' y'] }],
};

// A session with a real speaker on a fake voice (each sentence takes `ms`), and
// a narrator whose answers come from `answer(prompt)`.
function setup({ answer = () => say(null), ms = 30, holdLimitMs = 5000 } = {}) {
  const control = new Control();
  const speaker = createSpeaker({
    control,
    synth: async (t) => t,
    play: () => {
      let stop;
      const done = new Promise((resolve) => { const t = setTimeout(resolve, ms); stop = () => { clearTimeout(t); resolve(); }; });
      return { done, stop };
    },
    isMuted: () => false,
  });
  const prompts = [];
  const pointed = [];
  const captions = [];
  const finished = [];
  let narrators = 0;
  const session = createSession({
    control,
    speaker,
    startNarrator: ({ agent, cli }) => {
      narrators += 1;
      return {
        agent, cli,
        async ask(p) { prompts.push(p); await tick(2); const a = answer(p, prompts.length); return a instanceof Error ? { answer: null, error: a.message } : { answer: a, error: null }; },
        costUsd: 0.05,
        turns: 3,
        close() {},
      };
    },
    point: async (file, startLine, endLine) => { pointed.push(file ? [file, startLine, endLine] : null); },
    caption: (c) => captions.push(c),
    config: () => ({ voice: 'v' }),
    holdLimitMs,
  });
  session.onFinish((s) => finished.push(s));
  const ev = (e, opts) => session.event({ session: 'S1', agent: 'claude-code', cli: '/bin/claude', ...e }, opts);
  return { control, session, ev, prompts, pointed, captions, finished, narrators: () => narrators };
}

test('before a session, every step goes through untouched', async () => {
  const { ev, prompts } = setup();
  assert.deepStrictEqual(await ev({ kind: 'step' }), { decision: 'allow' });
  await ev({ kind: 'read', file: '/p/a.py', text: 'x' });
  assert.deepStrictEqual(prompts, []);
});

test('an edit is narrated with its number and lines, pointed at, and holds the next step until said', async () => {
  const t = setup({ answer: () => say('The helper now returns two lines.', { edit: 1 }) });
  t.session.begin('Add retries');
  await t.ev({ kind: 'edit', ...EDIT });
  let released = false;
  const step = t.ev({ kind: 'step' }).then((r) => { released = true; return r; });
  await tick(15);
  assert.strictEqual(released, false, 'held while the voice speaks');
  assert.deepStrictEqual(await step, { decision: 'allow' });
  assert.match(t.prompts[0], /^Task given to the coder: Add retries/);
  assert.match(t.prompts[0], /Edit 1: the coder edited \/p\/retry\.py; the changed code is now at lines 4 to 5\./);
  assert.deepStrictEqual(t.pointed[0], ['/p/retry.py', 4, 5]);
  assert.strictEqual(t.captions[0].text, 'The helper now returns two lines.');
});

test('the why-line waits for its edit and is narrated with it, in one turn', async () => {
  const t = setup({ answer: () => say('Done.') });
  t.session.begin('t');
  await t.ev({ kind: 'text', messageId: 'm1', text: 'Why: the delay must ', final: false });
  await t.ev({ kind: 'text', messageId: 'm1', text: 'grow.', final: true });
  assert.deepStrictEqual(await t.ev({ kind: 'step' }), { decision: 'allow' }, 'text alone does not hold the edit');
  await t.ev({ kind: 'edit', ...EDIT });
  await t.ev({ kind: 'step' });
  assert.strictEqual(t.prompts.length, 1);
  assert.match(t.prompts[0], /1\. The coder wrote: "Why: the delay must grow\."[\s\S]*2\. Edit 1/);
});

test('a question the narrator answers itself does not reach the coder', async () => {
  const t = setup({ answer: (p) => (/engineer interrupted/.test(p) ? say('It returns the last error.') : say(null)) });
  t.session.begin('t');
  t.session.engineer('what does it return?');
  assert.deepStrictEqual(await t.ev({ kind: 'step' }), { decision: 'allow' });
  assert.deepStrictEqual(t.captions.map((c) => c.text), ['what does it return?', 'It returns the last error.']);
});

test('a correction is passed to the coder as the reason its next step was held, and its answer is narrated', async () => {
  const t = setup({
    answer: (p) => {
      if (/engineer interrupted/.test(p)) return say('I will pass that on.', { toCoder: 'The engineer says: use attempt_number, not i.' });
      if (/The coder wrote/.test(p)) return say('The coder agrees and renames it.');
      return say(null);
    },
  });
  t.session.begin('t');
  t.session.engineer('call it attempt_number');
  const r = await t.ev({ kind: 'step' });
  assert.strictEqual(r.decision, 'deny');
  assert.match(r.reason, /^Held by Coding Tutor\. The engineer, through the narrator: The engineer says: use attempt_number, not i\./);
  // The coder answers in text before trying again; that is narrated at once.
  await t.ev({ kind: 'text', text: 'Good point, renaming.' });
  assert.deepStrictEqual(await t.ev({ kind: 'step' }), { decision: 'allow' });
  assert.strictEqual(t.captions.at(-1).text, 'The coder agrees and renames it.');
});

test('"show me" can walk through several places, each pointed at in turn', async () => {
  const both = { parts: [{ say: 'Here.', edit: 1, file: null, startLine: null, endLine: null }, { say: 'And here.', edit: 2, file: null, startLine: null, endLine: null }], toCoder: null };
  const t = setup({ answer: (p) => (/show me/.test(p) ? both : say(null)) });
  t.session.begin('t');
  await t.ev({ kind: 'edit', ...EDIT });
  await t.ev({ kind: 'edit', ...EDIT, file: '/p/other.py' });
  await t.ev({ kind: 'step' });
  t.session.engineer('show me');
  await t.ev({ kind: 'step' });
  assert.deepStrictEqual(t.pointed.slice(-2), [['/p/retry.py', 4, 5], ['/p/other.py', 4, 5]]);
  assert.deepStrictEqual(t.captions.slice(-2).map((c) => c.text), ['Here.', 'And here.']);
});

test('interrupting the voice tells the narrator where it was cut off', async () => {
  let n = 0;
  const t = setup({ ms: 40, answer: () => (++n === 1 ? say('First sentence here. Second sentence here.', { edit: 1 }) : say('Sure.')) });
  t.session.begin('t');
  await t.ev({ kind: 'edit', ...EDIT });
  await tick(20);
  t.session.engineer('wait, why?');
  await t.ev({ kind: 'step' });
  assert.match(t.prompts[1], /The engineer interrupted and said: "wait, why\?"\nYou were cut off while saying: "First sentence here\. Second sentence here\."/);
});

test('a pause holds the next step; a pause longer than the hold limit asks the coder to try again', async () => {
  const t = setup({ holdLimitMs: 40 });
  t.session.begin('t');
  t.control.pause();
  assert.deepStrictEqual(await t.ev({ kind: 'step' }), { decision: 'deny', reason: STILL_PAUSED, paused: true });
  const again = t.ev({ kind: 'step' });
  await tick(10);
  t.control.resume();
  assert.deepStrictEqual(await again, { decision: 'allow' });
});

test('the end of the turn gets the recap, then the session finishes with its cost', async () => {
  const t = setup({ answer: (p) => (/ended its turn/.test(p) ? say('We made the delay grow.') : say(null)) });
  t.session.begin('Grow the delay');
  assert.deepStrictEqual(await t.ev({ kind: 'end', lastMessage: 'Done: the delay now doubles.' }), { decision: 'allow' });
  assert.match(t.prompts[0], /Its last message:\nDone: the delay now doubles\./);
  assert.strictEqual(t.captions.at(-1).recap, true);
  assert.deepStrictEqual(t.finished, [{ task: 'Grow the delay', recap: 'We made the delay grow.', endedBy: null, costUsd: 0.05, turns: 3 }]);
  assert.strictEqual(t.session.active, false);
  assert.deepStrictEqual(await t.ev({ kind: 'step' }), { decision: 'allow' }, 'nothing is held after the session');
});

test('something for the coder during the recap blocks the end of its turn', async () => {
  const t = setup({ answer: (p) => (/engineer interrupted/.test(p) ? say(null, { toCoder: 'Also add a test.' }) : say('Recap.')) });
  t.session.begin('t');
  t.session.engineer('add a test too');
  const r = await t.ev({ kind: 'end', lastMessage: 'Done.' });
  assert.strictEqual(r.decision, 'block');
  assert.match(r.reason, /Also add a test\./);
  assert.strictEqual(t.session.active, true);
});

test('a pause at the end of the turn: the same end sent again gets no second recap', async () => {
  const t = setup({ answer: (p) => (/ended its turn/.test(p) ? say('Recap.') : say(null)), holdLimitMs: 40 });
  t.session.begin('t');
  t.control.pause();
  assert.deepStrictEqual(await t.ev({ kind: 'end', lastMessage: 'Done.' }), { decision: 'block', reason: STILL_PAUSED, paused: true });
  const again = t.ev({ kind: 'end', lastMessage: 'Done.' });
  await tick(10);
  t.control.resume();
  assert.deepStrictEqual(await again, { decision: 'allow' });
  assert.strictEqual(t.prompts.filter((p) => /ended its turn/.test(p)).length, 1);
  assert.strictEqual(t.session.active, false);
});

test('an end after the coder dealt with something said during the recap gets a new recap', async () => {
  let recaps = 0;
  const t = setup({ answer: (p) => (/engineer interrupted/.test(p) ? say(null, { toCoder: 'Also add a test.' }) : /ended its turn/.test(p) ? (recaps += 1, say(`Recap ${recaps}.`)) : say(null)) });
  t.session.begin('t');
  t.session.engineer('add a test too');
  assert.strictEqual((await t.ev({ kind: 'end', lastMessage: 'Done.' })).decision, 'block');
  await t.ev({ kind: 'text', text: 'Why: the engineer asked for a test.' });
  assert.deepStrictEqual(await t.ev({ kind: 'end', lastMessage: 'Added the test.' }), { decision: 'allow' });
  assert.strictEqual(t.finished[0].recap, 'Recap 2.');
});

test('the engineer stopping the coder while no step is held ends the session', async () => {
  const t = setup({ answer: () => say('x') });
  t.session.begin('t');
  await t.ev({ kind: 'read', file: '/p/a.py', text: 'one' });
  assert.deepStrictEqual(await t.ev({ kind: 'stopped' }), { decision: 'allow' });
  assert.strictEqual(t.session.active, false);
  assert.strictEqual(t.finished[0].endedBy, 'stopped by the engineer');
});

test('Esc in the agent while a step is held ends the session', async () => {
  const t = setup({ answer: () => say('A long narration. With two sentences.'), ms: 50 });
  t.session.begin('t');
  await t.ev({ kind: 'edit', ...EDIT });
  const ac = new AbortController();
  const step = t.ev({ kind: 'step' }, { signal: ac.signal });
  await tick(10);
  ac.abort();
  await step;
  assert.strictEqual(t.session.active, false);
  assert.strictEqual(t.finished[0].endedBy, 'stopped by the engineer');
});

test('events from another agent session in the same folder are ignored', async () => {
  const t = setup({ answer: () => say('x') });
  t.session.begin('t');
  await t.ev({ kind: 'read', file: '/p/a.py', text: 'one' });
  await t.session.event({ session: 'OTHER', kind: 'edit', ...EDIT });
  await t.ev({ kind: 'step' });
  assert.strictEqual(t.prompts.length, 1);
  assert.doesNotMatch(t.prompts.join(''), /Edit 1/);
});

test('"show me" an earlier edit points at where it is now; files the coder never saw are not pointed at', async () => {
  const answers = [say(null), say(null), say('Here it is.', { edit: 1 }), say('And this.', { file: '/etc/secret', startLine: 1, endLine: 2 })];
  const t = setup({ answer: (p, n) => answers[n - 1] });
  t.session.begin('t');
  await t.ev({ kind: 'edit', ...EDIT }); // now lines 4-5
  await t.ev({ kind: 'step' });
  await t.ev({ kind: 'edit', file: '/p/retry.py', oldText: '', newText: 'n', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: [' a', '+n', '+m'] }] });
  await t.ev({ kind: 'step' });
  t.session.engineer('show me the first change');
  await t.ev({ kind: 'step' });
  assert.deepStrictEqual(t.pointed.at(-1), ['/p/retry.py', 6, 7]);
  t.session.engineer('and the secret?');
  await t.ev({ kind: 'step' });
  assert.strictEqual(t.pointed.at(-1), null);
});

test('reads show the narrator numbered lines; a broken narrator is shown once and never holds the coder', async () => {
  const t = setup({ answer: () => new Error('not logged in') });
  t.session.begin('t');
  await t.ev({ kind: 'read', file: '/p/a.py', startLine: 10, text: 'one\ntwo\n', totalLines: 40 });
  assert.deepStrictEqual(await t.ev({ kind: 'step' }), { decision: 'allow' });
  await t.ev({ kind: 'command', command: 'ls', output: 'a' });
  await t.ev({ kind: 'step' });
  assert.match(t.prompts[0], /The coder read \/p\/a\.py, lines 10 to 11 of 40:\n10\tone\n11\ttwo/);
  assert.deepStrictEqual(t.captions.map((c) => c.text), ['The narrator could not answer: not logged in']);
});

test('the narrator is started once, with the agent and CLI the coder reported', async () => {
  const t = setup({ answer: () => say(null) });
  t.session.begin('t');
  await t.ev({ kind: 'read', file: '/p/a.py', text: 'x' });
  await t.ev({ kind: 'step' });
  await t.ev({ kind: 'command', command: 'ls', output: '' });
  await t.ev({ kind: 'step' });
  assert.strictEqual(t.narrators(), 1);
});

const test = require('node:test');
const assert = require('node:assert');
const { Control, createSpeaker } = require('../extension/lib/speaker');

const CFG = { voice: 'am_adam' };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// A fake voice: every sentence "plays" for `ms` unless stopped. Records what
// was started and what finished.
function setup({ ms = 30, muted = false, synthFails = false } = {}) {
  const control = new Control();
  const started = [];
  const finished = [];
  const quiet = [];
  let mutedNow = muted;
  const fakePlay = (label, list) => {
    let stop;
    const done = new Promise((resolve) => {
      const t = setTimeout(() => { finished.push(label); resolve(); }, ms);
      stop = () => { clearTimeout(t); resolve(); };
    });
    list.push(label);
    return { done, stop };
  };
  const speaker = createSpeaker({
    control,
    synth: async (s) => { if (synthFails) throw new Error('voice server down'); return s; },
    play: (audio) => fakePlay(audio, started),
    isMuted: () => mutedNow,
    quiet: () => fakePlay(`quiet#${quiet.length}`, quiet),
    readingTime: () => ms,
  });
  return { control, speaker, started, finished, quiet, setMuted: (v) => { mutedNow = v; } };
}

test('speaks every sentence in order', async () => {
  const { speaker, finished } = setup();
  const r = await speaker.speak('One. Two. Three.', CFG, 1000);
  assert.strictEqual(r.outcome, 'spoken');
  assert.deepStrictEqual(finished, ['One.', 'Two.', 'Three.']);
});

test('a pause cuts the sentence off and resume says it again from the start', async () => {
  const { control, speaker, started, finished } = setup();
  const p = speaker.speak('One. Two.', CFG, 1000);
  await tick(10);
  control.pause();
  await tick(60);
  assert.deepStrictEqual(finished, [], 'nothing finishes while paused');
  control.resume();
  const r = await p;
  assert.strictEqual(r.outcome, 'spoken');
  assert.deepStrictEqual(started, ['One.', 'One.', 'Two.']);
  assert.deepStrictEqual(finished, ['One.', 'Two.']);
});

test('a pause longer than the hold limit returns "paused", and resumeHeld says the rest', async () => {
  const { control, speaker, finished } = setup();
  const p = speaker.speak('One. Two. Three.', CFG, 50);
  await tick(45); // "One." has finished; "Two." is playing
  control.pause();
  const r = await p;
  assert.strictEqual(r.outcome, 'paused');
  assert.ok(speaker.hasHeld());
  setTimeout(() => control.resume(), 20);
  const r2 = await speaker.resumeHeld(1000);
  assert.strictEqual(r2.outcome, 'spoken');
  assert.deepStrictEqual(finished, ['One.', 'Two.', 'Three.']);
});

test('resumeHeld with nothing left just waits for the engineer', async () => {
  const { control, speaker } = setup();
  control.pause();
  assert.strictEqual((await speaker.resumeHeld(20)).outcome, 'paused');
  setTimeout(() => control.resume(), 10);
  assert.strictEqual((await speaker.resumeHeld(1000)).outcome, 'resumed');
});

test('an interrupt stops the narration at once', async () => {
  const { control, speaker, finished } = setup();
  const p = speaker.speak('One. Two. Three.', CFG, 1000);
  await tick(10);
  control.interrupt('Hold on, why there?');
  const r = await p;
  assert.strictEqual(r.outcome, 'interrupted');
  assert.deepStrictEqual(finished, []);
  assert.strictEqual(control.takeMessage(), 'Hold on, why there?');
  assert.strictEqual(control.message, null);
});

test('an interrupt while paused ends the pause', async () => {
  const { control, speaker } = setup();
  const p = speaker.speak('One. Two.', CFG, 1000);
  await tick(10);
  control.pause();
  await tick(10);
  control.interrupt('Go deeper here.');
  assert.strictEqual((await p).outcome, 'interrupted');
  assert.strictEqual(control.paused, false);
});

test('an interrupt sent before the narration starts means nothing is said', async () => {
  const { control, speaker, started } = setup();
  control.interrupt('Wait.');
  assert.strictEqual((await speaker.speak('One.', CFG, 1000)).outcome, 'interrupted');
  assert.deepStrictEqual(started, []);
});

test('skip ends the narration', async () => {
  const { control, speaker, finished } = setup();
  const p = speaker.speak('One. Two.', CFG, 1000);
  await tick(10);
  control.skip();
  assert.strictEqual((await p).outcome, 'skipped');
  assert.deepStrictEqual(finished, []);
});

test('muted: nothing is played but the agent is still paced', async () => {
  const { speaker, started, quiet } = setup({ muted: true });
  const r = await speaker.speak('One. Two.', CFG, 1000);
  assert.strictEqual(r.outcome, 'spoken');
  assert.strictEqual(r.muted, true);
  assert.deepStrictEqual(started, []);
  assert.strictEqual(quiet.length, 2);
});

test('muting mid-sentence says that sentence again, silently', async () => {
  const { control, speaker, started, quiet, setMuted } = setup();
  const p = speaker.speak('One. Two.', CFG, 1000);
  await tick(10);
  setMuted(true);
  control.stop();
  await p;
  assert.deepStrictEqual(started, ['One.']);
  assert.strictEqual(quiet.length, 2);
});

test('a broken voice falls back to reading pace and reports the error', async () => {
  const { speaker, quiet } = setup({ synthFails: true });
  const r = await speaker.speak('One. Two.', CFG, 1000);
  assert.strictEqual(r.outcome, 'spoken');
  assert.strictEqual(r.voiceError, 'voice server down');
  assert.strictEqual(quiet.length, 2);
});

const test = require('node:test');
const assert = require('node:assert');
const { startRecording, firstSound, wavFromPcm } = require('../extension/lib/mic');

const pcm = (samples) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};

// A fake recorder: a node process that writes `silentBytes` of exact silence,
// then a tone, until it is killed.
const fakeRecorder = (silentBytes) => [process.execPath, ['-e', `
  process.stdout.write(Buffer.alloc(${silentBytes}));
  const tone = Buffer.alloc(3200); for (let i = 0; i < 1600; i++) tone.writeInt16LE(i % 2 ? 1000 : -1000, i * 2);
  setInterval(() => process.stdout.write(tone), 20);
`]];

// A fake mic that only ever sends silence.
const silentRecorder = [process.execPath, ['-e', 'setInterval(() => process.stdout.write(Buffer.alloc(3200)), 20)']];

test('firstSound skips exact silence and tiny noise', () => {
  assert.strictEqual(firstSound(pcm([0, 0, 1, -2, 0, 50, 0])), 10);
  assert.strictEqual(firstSound(pcm([0, 0, 0])), -1);
});

test('wavFromPcm writes a valid 16 kHz mono header', () => {
  const wav = wavFromPcm(pcm([1, 2, 3]));
  assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(wav.readUInt32LE(24), 16000);
  assert.strictEqual(wav.readUInt16LE(22), 1);
  assert.strictEqual(wav.readUInt32LE(40), 6);
  assert.strictEqual(wav.length, 50);
});

test('goes live only when real sound arrives, and trims the dead air', async () => {
  let liveAt = null;
  const started = Date.now();
  const rec = startRecording({ recorders: [fakeRecorder(32000)], onLive: () => { liveAt = Date.now() - started; } });
  await new Promise((r) => setTimeout(r, 300));
  const wav = await rec.stop();
  assert.ok(liveAt !== null, 'went live');
  assert.notStrictEqual(firstSound(wav.subarray(44)), -1);
  assert.strictEqual(firstSound(wav.subarray(44)), 0, 'no dead air left at the start');
});

test('snapshot gives the recording so far, and nothing before the mic is live', async () => {
  const rec = startRecording({ recorders: [fakeRecorder(64000)] });
  assert.strictEqual(rec.snapshot(), null);
  await new Promise((r) => setTimeout(r, 300));
  const first = rec.snapshot();
  await new Promise((r) => setTimeout(r, 200));
  const later = rec.snapshot();
  assert.ok(first && later.length > first.length, 'grows while recording');
  await rec.stop();
});

test('falls back to the next recorder when the first is missing', async () => {
  let live = false;
  const rec = startRecording({ recorders: [['no-such-recorder-xyz', []], fakeRecorder(0)], onLive: () => { live = true; } });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok((await rec.stop()) !== null);
  assert.ok(live);
});

test('reports an error when no recorder exists', async () => {
  const errors = [];
  const rec = startRecording({ recorders: [['no-such-recorder-xyz', []]], onError: (m) => errors.push(m) });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(await rec.stop(), null);
  assert.match(errors[0], /no audio recorder/);
});

test('reports an error when the mic never sends sound, and stop returns null', async () => {
  const errors = [];
  const rec = startRecording({ recorders: [silentRecorder], notLiveAfterMs: 100, onError: (m) => errors.push(m) });
  await new Promise((r) => setTimeout(r, 200));
  assert.match(errors[0] || '', /not sending any sound/);
  assert.strictEqual(await rec.stop(), null);
});

test('calls onLimit at the maximum length', async () => {
  let limited = false;
  const rec = startRecording({ recorders: [fakeRecorder(0)], maxMs: 100, onLimit: () => { limited = true; } });
  await new Promise((r) => setTimeout(r, 200));
  await rec.stop();
  assert.ok(limited);
});

// The microphone. Webviews cannot use the mic, so this records through the
// system's recorder, notices when real sound starts arriving, and hands back a
// WAV of what was said, with the dead air at the start trimmed off.
const { spawn } = require('child_process');

const RATE = 16000;
const RECORDERS = [
  ['parecord', ['--raw', '--channels=1', `--rate=${RATE}`, '--format=s16le']],
  ['pw-record', ['--rate', String(RATE), '--channels', '1', '--format', 's16', '-']],
];
// A Bluetooth headset sends exact silence while it switches into call mode, so
// anything above this means the mic is really live.
const LIVE_THRESHOLD = 2;
const NOT_LIVE_AFTER_MS = 8000;
const MAX_MS = 2 * 60 * 1000;

// Byte offset of the first real sound in 16-bit PCM, or -1.
function firstSound(pcm) {
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    if (Math.abs(pcm.readInt16LE(i)) > LIVE_THRESHOLD) return i;
  }
  return -1;
}

function wavFromPcm(pcm, rate = RATE) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per frame
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Starts recording. Calls onLive() once real sound arrives, onError(message) if
// the mic cannot be used, and onLimit() when the maximum length is reached.
// Returns { snapshot, stop }: snapshot() is the WAV so far (null until live);
// stop() resolves to the WAV of what was said, or null if the mic never went live.
function startRecording({ onLive = () => {}, onError = () => {}, onLimit = () => {}, recorders = RECORDERS, notLiveAfterMs = NOT_LIVE_AFTER_MS, maxMs = MAX_MS } = {}) {
  const chunks = [];
  let live = false;
  let child = null;
  let closed = null;
  let finished = false;
  let failed = false;

  const fail = (message) => {
    if (failed || finished) return;
    failed = true;
    onError(message);
  };

  const notLiveTimer = setTimeout(() => {
    if (!live) fail('the microphone is not sending any sound; check that it is connected and not muted');
  }, notLiveAfterMs);
  const limitTimer = setTimeout(() => onLimit(), maxMs);

  const attempt = (index) => {
    if (index >= recorders.length) return fail('no audio recorder found (tried parecord and pw-record)');
    const [cmd, args] = recorders[index];
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let markClosed;
    closed = new Promise((resolve) => { markClosed = resolve; });
    child.on('close', () => markClosed());
    child.on('error', (e) => {
      markClosed(); // a recorder that failed to start may never emit 'close'
      if (e.code === 'ENOENT') attempt(index + 1);
      else fail(`${cmd} failed: ${e.message}`);
    });
    child.stdout.on('data', (data) => {
      if (live) return chunks.push(data);
      const at = firstSound(data);
      if (at < 0) return;
      live = true;
      chunks.push(data.subarray(at));
      onLive();
    });
  };
  attempt(0);

  const soFar = () => {
    const pcm = Buffer.concat(chunks);
    return wavFromPcm(pcm.subarray(0, pcm.length - (pcm.length % 2)));
  };

  return {
    // The recording so far, for showing words while the engineer is still talking.
    snapshot() {
      return live ? soFar() : null;
    },
    async stop() {
      finished = true;
      clearTimeout(notLiveTimer);
      clearTimeout(limitTimer);
      if (child && child.exitCode === null) child.kill();
      if (closed) await closed;
      if (!live) return null;
      return soFar();
    },
  };
}

module.exports = { startRecording, firstSound, wavFromPcm, RATE };

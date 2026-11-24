// The voice: starts the local voice server when needed, turns a sentence into
// audio, and plays audio through the system audio player.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PORT = 47811;
const SERVER_SCRIPT = path.join(__dirname, '..', 'voice', 'server.py');
const GPU_SCRIPT = path.join(__dirname, '..', 'voice', 'gpu.py'); // server.py with the GPU libraries
const PLAYERS = [
  ['paplay', (f) => [f]],
  ['pw-play', (f) => [f]],
  ['afplay', (f) => [f]],
  ['ffplay', (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f]],
];

let starting = null;
let playerIndex = 0;
let log = () => {};

function setLogger(fn) { log = fn; }

function request(method, urlPath, body, timeoutMs) {
  const raw = Buffer.isBuffer(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: urlPath, method, timeout: timeoutMs, headers: { 'Content-Type': raw ? 'audio/wav' : 'application/json' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode === 200) resolve(buf);
          else reject(new Error(`voice server answered ${res.statusCode}: ${buf.toString().slice(0, 200)}`));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('voice server timed out')));
    req.on('error', reject);
    req.end(raw ? body : body ? JSON.stringify(body) : undefined);
  });
}

async function healthy() {
  try { await request('GET', '/health', null, 1500); return true; } catch { return false; }
}

// Start the voice server if it is not already running. The first start downloads
// the voice model (about 350 MB), so it can take a few minutes.
function ensureServer() {
  if (starting) return starting;
  starting = (async () => {
    if (await healthy()) return;
    // Inside a Flatpak the engine has to run on the host, where uv and the GPU live.
    const onHost = (c, a) => (process.env.FLATPAK_ID ? ['flatpak-spawn', ['--host', '--watch-bus', c, ...a]] : [c, a]);
    // The GPU libraries are a large download, so only fetch them when there is an
    // NVIDIA GPU. gpu.py lists them itself, because it also has to keep the CPU
    // build of onnxruntime out, which `--with` cannot do.
    const [smi, smiArgs] = onHost('nvidia-smi', ['-L']);
    const gpu = spawnSync(smi, smiArgs, { timeout: 5000 }).status === 0;
    const packages = ['kokoro-onnx', 'soundfile', 'faster-whisper'];
    const uvArgs = gpu
      ? ['run', '--quiet', GPU_SCRIPT, String(PORT)]
      : ['run', '--quiet', '--python', '3.12', ...packages.flatMap((p) => ['--with', p]), SERVER_SCRIPT, String(PORT)];
    const [cmd, args] = onHost('uv', uvArgs);
    log(`starting voice server: ${cmd} ${args.join(' ')}`);
    let failure = null;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log(`voice: ${String(d).trim()}`));
    child.stderr.on('data', (d) => log(`voice: ${String(d).trim()}`));
    child.on('error', (e) => { failure = e.code === 'ENOENT' ? new Error(`"${cmd}" was not found. The voice needs uv (https://docs.astral.sh/uv/) installed.`) : e; });
    child.on('exit', (code) => { if (code) failure = failure || new Error(`voice server exited with code ${code}; see the Coding Tutor output channel`); });
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (await healthy()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    child.kill();
    throw new Error('voice server did not become ready within 10 minutes');
  })();
  starting.catch(() => { starting = null; });
  return starting;
}

// Calls the voice server. If it has died since it was started, start it again
// once before giving up.
async function withServer(call) {
  await ensureServer();
  try {
    return await call();
  } catch (e) {
    if (!/ECONNREFUSED|ECONNRESET|socket hang up/.test(e.message)) throw e;
    log(`voice server unreachable (${e.message}); restarting it`);
    starting = null;
    await ensureServer();
    return call();
  }
}

// Turn one sentence into audio.
function synth(text, cfg) {
  return withServer(() => request('POST', '/speak', { text, voice: cfg.voice, speed: cfg.speed }, 60000));
}

// Turn a recording (WAV) into text with the local speech recognition.
async function transcribe(wav) {
  const reply = await withServer(() => request('POST', '/transcribe', wav, 120000));
  return JSON.parse(reply.toString()).text || '';
}

function playFile(file, handle) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (handle.stopped) return resolve();
      if (playerIndex >= PLAYERS.length) return reject(new Error('no audio player found (tried paplay, pw-play, afplay, ffplay)'));
      const [cmd, argsFor] = PLAYERS[playerIndex];
      const child = spawn(cmd, argsFor(file), { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      handle.child = child;
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => {
        if (e.code === 'ENOENT') { playerIndex += 1; attempt(); } else reject(e);
      });
      child.on('close', (code, signal) => {
        handle.child = null;
        if (code === 0 || signal || handle.stopped) resolve();
        else reject(new Error(`${cmd} failed: ${stderr.trim() || 'exit ' + code}`));
      });
    };
    attempt();
  });
}

// Play one clip of audio. Returns {done, stop}: `done` resolves when it has
// finished or was stopped.
function play(wav) {
  const handle = { child: null, stopped: false };
  const file = path.join(os.tmpdir(), `coding-tutor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  fs.writeFileSync(file, wav);
  const done = playFile(file, handle).finally(() => fs.rm(file, () => {}));
  return {
    done,
    stop() {
      handle.stopped = true;
      if (handle.child) handle.child.kill();
    },
  };
}

module.exports = { synth, play, transcribe, ensureServer, setLogger, PORT };

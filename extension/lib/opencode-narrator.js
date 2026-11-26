// The narrator for a coder working in OpenCode, through the engineer's own
// OpenCode: its login, providers and default model, local ones included.
//
// One `opencode serve` per session, on 127.0.0.1 with a password of its own,
// holding one narrator session, so the narrator's context stays cached between
// narrations. It runs as an agent defined only for it (passed in
// OPENCODE_CONFIG_CONTENT): its prompt is the session script in place of
// OpenCode's coding prompt, and every tool is off and every permission denied,
// except StructuredOutput, the tool OpenCode answers a JSON schema through. It
// knows only what it is told, which is only what the coder's own tools returned.
//
// Same interface as the Claude Code narrator (narrator.js): ask(), costUsd,
// turns, close(); ask() never rejects.
const { spawn: nodeSpawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const { ANSWER_SCHEMA } = require('./narrator');

const AGENT = 'coding-tutor-narrator';
const START_TIMEOUT_MS = 60 * 1000;
const TURN_TIMEOUT_MS = 90 * 1000;

// The narrator's agent, added to any config the engineer already passes in
// OPENCODE_CONFIG_CONTENT (which may hold their providers).
function narratorConfig(systemPrompt, existing) {
  let base = {};
  try { base = existing ? JSON.parse(existing) : {}; } catch { base = {}; }
  if (!base || typeof base !== 'object' || Array.isArray(base)) base = {};
  return {
    ...base,
    agent: {
      ...(base.agent || {}),
      [AGENT]: {
        mode: 'primary',
        description: "Coding Tutor's narrator: explains the coder's work aloud. No tools.",
        prompt: systemPrompt,
        tools: { '*': false, StructuredOutput: true },
        permission: { '*': 'deny' },
      },
    },
  };
}

// narratorModel for OpenCode is its own "provider/model" (as in `opencode
// models`); empty means OpenCode's default model.
function parseModel(model) {
  if (!model) return null;
  const at = model.indexOf('/');
  if (at <= 0 || at === model.length - 1) {
    throw new Error(`narratorModel "${model}" is not an OpenCode model: write it as provider/model, as \`opencode models\` lists it, under "opencode" (for example {"opencode": "local/qwen3.6-35b"})`);
  }
  return { providerID: model.slice(0, at), modelID: model.slice(at + 1) };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function errorText(err) {
  if (!err) return null;
  return String((err.data && err.data.message) || err.name || 'the narrator failed');
}

function createOpencodeNarrator({
  cli, model, systemPrompt, cwd, env = process.env,
  spawn = nodeSpawn, fetch = globalThis.fetch, getPort = freePort, log = () => {},
  startTimeoutMs = START_TIMEOUT_MS, turnTimeoutMs = TURN_TIMEOUT_MS,
}) {
  const command = cli || 'opencode';
  let server = null; // a promise of the running server
  let live = null; // the running server: {proc, url, auth, id}
  let chain = Promise.resolve();
  let closed = false;
  let cost = 0;
  const state = { turns: 0 };

  async function start() {
    const password = crypto.randomBytes(24).toString('hex');
    const port = await getPort();
    log(`starting the narrator: ${command} serve --hostname 127.0.0.1 --port ${port}`);
    const proc = spawn(command, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd,
      env: { ...env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify(narratorConfig(systemPrompt, env.OPENCODE_CONFIG_CONTENT)), CODING_TUTOR_NARRATOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      return await connect(proc, password);
    } catch (e) {
      proc.kill();
      throw e;
    }
  }

  async function connect(proc, password) {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('the narrator\'s OpenCode server did not start')), startTimeoutMs);
      const fail = (e) => { clearTimeout(timer); reject(e); };
      proc.stdout.on('data', (d) => {
        out += d;
        const m = /listening on (http:\/\/\S+)/.exec(out);
        if (m) { clearTimeout(timer); resolve(m[1].replace(/\/$/, '')); }
      });
      proc.stderr.on('data', (d) => log(`narrator: ${String(d).trim()}`));
      proc.on('error', (e) => fail(new Error(e.code === 'ENOENT' ? `"${command}" was not found` : e.message)));
      proc.on('exit', (code, signal) => fail(new Error(`the narrator's OpenCode server exited (${signal || code})`)));
    });
    proc.on('exit', (code, signal) => {
      if (!closed) log(`narrator exited (${signal || code})`);
      if (live && live.proc === proc) forget();
    });
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    const res = await fetch(`${url}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ title: 'Coding Tutor narrator' }),
      signal: AbortSignal.timeout(startTimeoutMs),
    });
    if (!res.ok) throw new Error(`the narrator's OpenCode server refused a session (${res.status})`);
    const { id } = await res.json();
    live = { proc, url, auth, id };
    return live;
  }

  function forget() {
    live = null;
    server = null;
  }

  function stopServer(s) {
    if (!s) return;
    // Its session goes too, so narrations do not pile up in OpenCode's list.
    fetch(`${s.url}/session/${s.id}`, { method: 'DELETE', headers: { Authorization: s.auth }, signal: AbortSignal.timeout(2000) })
      .catch(() => {})
      .finally(() => s.proc.kill());
  }

  async function turn(text) {
    if (closed) return { answer: null, error: 'the narrator was closed' };
    state.turns += 1;
    let chosen;
    let s;
    try {
      chosen = parseModel(model);
      if (!server) server = start();
      s = await server;
    } catch (e) {
      forget(); // it did not start: try again next time
      return { answer: null, error: e.message || String(e) };
    }
    try {
      const body = { agent: AGENT, format: { type: 'json_schema', schema: ANSWER_SCHEMA }, parts: [{ type: 'text', text }] };
      if (chosen) body.model = chosen;
      const res = await fetch(`${s.url}/session/${s.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: s.auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(turnTimeoutMs),
      });
      if (!res.ok) return { answer: null, error: `the narrator's OpenCode server answered ${res.status}` };
      const { info } = await res.json();
      if (info && typeof info.cost === 'number') cost += info.cost;
      if (!info || info.error || !info.structured) return { answer: null, error: errorText(info && info.error) || 'the narrator gave no answer' };
      return { answer: info.structured, error: null };
    } catch (e) {
      if (e && e.name === 'TimeoutError') {
        log('narrator took too long; restarting it');
        if (s && live === s) forget();
        stopServer(s);
        return { answer: null, error: 'the narrator took too long to answer' };
      }
      return { answer: null, error: e.message || String(e) };
    }
  }

  return {
    ask(text) {
      const result = chain.then(() => turn(text));
      chain = result.then(() => {});
      return result;
    },
    get costUsd() { return cost; },
    get turns() { return state.turns; },
    close() {
      closed = true;
      const s = server;
      server = null;
      if (s) s.then(stopServer, () => {});
    },
  };
}

module.exports = { createOpencodeNarrator, narratorConfig, parseModel, AGENT };

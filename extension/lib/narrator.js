// The narrator: the separate model that watches the coder's work and says the
// narration. It runs through the engineer's own agent CLI, with their login, as
// one long-running headless process per session, so its context stays cached
// between narrations. It has no tools and no MCP servers: it knows only what it
// is told, which is only what the coder's own tools returned.
const { spawn: nodeSpawn } = require('child_process');

// What the narrator answers each time it is told something: what to say, in
// parts said one after the other, each with the pointer on its own code (so
// "show me" can walk through several places), and anything to pass to the coder.
const PART_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'One to three short sentences, to be spoken.' },
    edit: { type: ['integer', 'null'], description: 'The number of the edit this part is about, to point at it.' },
    file: { type: ['string', 'null'], description: 'A file the coder read, to point at lines in it, when the part is not about an edit.' },
    startLine: { type: ['integer', 'null'] },
    endLine: { type: ['integer', 'null'] },
  },
  required: ['say', 'edit', 'file', 'startLine', 'endLine'],
  additionalProperties: false,
};
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    parts: { type: 'array', items: PART_SCHEMA, description: 'What to say now, in order. Empty to stay quiet.' },
    toCoder: { type: ['string', 'null'], description: 'What to pass to the coder from the engineer, or null when you answered it yourself.' },
  },
  required: ['parts', 'toCoder'],
  additionalProperties: false,
};

const TURN_TIMEOUT_MS = 90 * 1000;

// How to start the narrator through each agent's CLI. `cli` is the path of the
// coder's own CLI, as its adapter reported it. An empty model means the agent's
// default model, the one the engineer codes with.
const LAUNCHERS = {
  'claude-code': ({ cli, model, systemPrompt }) => ({
    command: cli || 'claude',
    args: [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--tools', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--system-prompt', systemPrompt,
      '--json-schema', JSON.stringify(ANSWER_SCHEMA),
      ...(model ? ['--model', model] : []),
    ],
  }),
};

function launchFor(agent, options) {
  const launcher = LAUNCHERS[agent];
  if (!launcher) throw new Error(`no narrator launcher for the agent "${agent}"`);
  return launcher(options);
}

// One message to the narrator process, in the CLI's stream-json input format.
function userMessage(text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
}

// createNarrator({command, args, cwd}) -> { ask(text), costUsd, turns, close() }.
// ask() resolves {answer, error}; it never rejects, so a broken narrator leaves
// the session running without narration rather than stopping the coder.
function createNarrator({ command, args, cwd, env, spawn = nodeSpawn, log = () => {}, turnTimeoutMs = TURN_TIMEOUT_MS }) {
  let child = null;
  let buffer = '';
  let pending = null; // {resolve, timer}
  let chain = Promise.resolve();
  let closed = false;
  // The CLI reports the session's cost so far; a restarted process starts again
  // from zero, so earlier processes' costs are kept apart.
  let costBefore = 0;
  let costNow = 0;
  const state = { turns: 0 };

  const settle = (result) => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { resolve } = pending;
    pending = null;
    resolve(result);
  };

  function onLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== 'result') return;
    if (typeof msg.total_cost_usd === 'number') costNow = msg.total_cost_usd;
    if (msg.is_error || !msg.structured_output) {
      settle({ answer: null, error: String(msg.result || msg.subtype || 'the narrator gave no answer') });
    } else {
      settle({ answer: msg.structured_output, error: null });
    }
  }

  function start() {
    costBefore += costNow;
    costNow = 0;
    buffer = '';
    log(`starting the narrator: ${command} ${args.filter((a) => a.length < 80).join(' ')}`);
    const proc = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    proc.stdout.on('data', (d) => {
      buffer += d;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        onLine(line);
      }
    });
    proc.stderr.on('data', (d) => log(`narrator: ${String(d).trim()}`));
    proc.stdin.on('error', () => {}); // a dead process: reported through 'exit'
    // Only the current process's end matters: one that was given up on and
    // killed must not answer for its replacement.
    proc.on('error', (e) => {
      const why = e.code === 'ENOENT' ? `"${command}" was not found` : e.message;
      log(`narrator failed to start: ${why}`);
      if (child !== proc) return;
      child = null;
      settle({ answer: null, error: why });
    });
    proc.on('exit', (code, signal) => {
      if (child !== proc) return;
      child = null;
      if (!closed) log(`narrator exited (${signal || code})`);
      settle({ answer: null, error: `the narrator exited (${signal || code})` });
    });
  }

  function turn(text) {
    if (closed) return Promise.resolve({ answer: null, error: 'the narrator was closed' });
    if (!child) start();
    state.turns += 1;
    return new Promise((resolve) => {
      pending = {
        resolve,
        timer: setTimeout(() => {
          log('narrator took too long; restarting it');
          const stuck = child;
          child = null;
          if (stuck) stuck.kill();
          settle({ answer: null, error: 'the narrator took too long to answer' });
        }, turnTimeoutMs),
      };
      child.stdin.write(userMessage(text));
    });
  }

  return {
    // Tell the narrator something; resolves with its answer. Calls are answered
    // one at a time, in order.
    ask(text) {
      const result = chain.then(() => turn(text));
      chain = result.then(() => {});
      return result;
    },
    get costUsd() { return costBefore + costNow; },
    get turns() { return state.turns; },
    close() {
      closed = true;
      if (child) child.kill();
      child = null;
      settle({ answer: null, error: 'the narrator was closed' });
    },
  };
}

module.exports = { createNarrator, launchFor, ANSWER_SCHEMA, LAUNCHERS };

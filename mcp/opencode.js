// Coding Tutor's adapter for OpenCode: a plugin, OpenCode's counterpart of the
// Claude Code hooks in claude_code.py.
//
// OpenCode loads it from a plugins folder (.opencode/plugins/ in a project, or
// ~/.config/opencode/plugins/). It turns OpenCode's plugin hooks into Coding
// Tutor's agent-neutral events, posts them to the extension, and turns the
// answer back into what OpenCode expects:
//
//   tool.execute.before         -> step     held while the narrator speaks; refused with a reason
//   tool.execute.after          -> read, search, command, edit or tool: what a step that ran returned
//   experimental.text.complete  -> text     what the coder wrote (its why-line)
//   session.idle                -> end      the recap; a reason for the coder comes back as a message to it
//   session.error (aborted)     -> stopped  the engineer pressed Esc
//
// Only tool.execute.after results are passed on, never what a step was about to
// do. OpenCode checks its permissions inside the tool, so a step they deny never
// reaches tool.execute.after, and its file never reaches the narrator.
//
// OpenCode does not cancel a plugin when the engineer presses Esc: a step held
// here would still run once the hold ended. So an aborted turn refuses its held
// step, and drops the connection, which tells the extension the engineer
// stopped the coder.
//
// It must never get in the coder's way by failing: any error is logged and the
// step goes through. Node built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = path.join(os.homedir(), '.coding-tutor');
const HOLD_TIMEOUT_MS = 15 * 60 * 1000; // OpenCode has no limit on a hook; the extension answers within 9 minutes
const QUICK_TIMEOUT_MS = 10 * 1000;
const OWN_TOOLS = 'coding-tutor_';
const STOPPED = 'Stopped by the engineer: they pressed Esc while Coding Tutor held this step. It did not run.';

// A refusal meant for the coder, as opposed to an error of ours.
class Refusal extends Error {}

function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function isWithin(child, parent) {
  const c = real(child);
  const p = real(parent);
  return c === p || c.startsWith(p.replace(/\/+$/, '') + path.sep);
}

// Windows running a narrated session whose folder contains `cwd` (or the
// reverse), best match first. The same rule as link.py.
function narratingWindows(windowsDir, cwd) {
  let names;
  try { names = fs.readdirSync(windowsDir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const found = [];
  for (const name of names) {
    const file = path.join(windowsDir, name);
    let w;
    let mtime;
    try { w = JSON.parse(fs.readFileSync(file, 'utf8')); mtime = fs.statSync(file).mtimeMs; } catch { continue; }
    if (!w || !w.narrating) continue;
    const scores = (w.folders || []).filter((d) => isWithin(cwd, d) || isWithin(d, cwd)).map((d) => real(d).length);
    if (scores.length) found.push({ score: Math.max(...scores), mtime, w });
  }
  return found.sort((a, b) => b.score - a.score || b.mtime - a.mtime).map((f) => f.w);
}

// The hunks of a unified diff, in the shape Claude Code reports them.
function hunksFromDiff(diff) {
  const hunks = [];
  let h = null;
  for (const line of String(diff || '').split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      h = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] };
      hunks.push(h);
    } else if (h && /^[ +-]/.test(line)) {
      h.lines.push(line);
    }
  }
  return hunks;
}

// The agent-neutral event for a step that ran.
function after(tool, args, output) {
  if (tool.startsWith(OWN_TOOLS)) return { kind: 'bind' };
  args = args || {};
  output = output || {};
  const meta = output.metadata || {};
  switch (tool) {
    case 'read': {
      const d = meta.display;
      if (!d || d.type !== 'file' || typeof d.text !== 'string') return { kind: 'tool', name: tool };
      return { kind: 'read', file: d.path || args.filePath, startLine: d.lineStart || 1, text: d.text, totalLines: d.totalLines || null };
    }
    case 'edit':
      return { kind: 'edit', file: args.filePath, oldText: args.oldString ?? '', newText: args.newString ?? '', hunks: hunksFromDiff(meta.diff), created: false };
    case 'write':
      return { kind: 'edit', file: meta.filepath || args.filePath, oldText: null, newText: args.content ?? '', hunks: [], created: meta.exists === false };
    case 'bash':
      return { kind: 'command', command: args.command || '', output: output.output ?? meta.output ?? '' };
    case 'grep': {
      const glob = args.include ? ` (files ${args.include})` : '';
      return { kind: 'search', what: `"${args.pattern || ''}" in ${args.path || 'the project'}${glob}`, result: output.output || 'no matches' };
    }
    case 'glob':
      return { kind: 'search', what: `files named ${args.pattern || ''}${args.path ? ` in ${args.path}` : ''}`, result: output.output || 'no files' };
    default:
      return { kind: 'tool', name: tool };
  }
}

// The adapter itself, with what it talks to passed in so tests can stand in for it.
function adapter({ directory, client, cli, windowsDir = path.join(STATE_DIR, 'windows'), logFile = path.join(STATE_DIR, 'hook.log'), fetch = globalThis.fetch }) {
  const held = new Map(); // session -> the held steps' controllers
  const stopped = new Set(); // sessions the engineer stopped, until their idle
  const ending = new Set();
  const lastText = new Map();

  const log = (what) => {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `${new Date().toISOString()} opencode: ${what && what.stack ? what.stack : what}\n`);
    } catch { /* nowhere to log */ }
  };
  const narrating = () => narratingWindows(windowsDir, directory).length > 0;

  // Posts one event to the best window. Resolves the extension's answer, or
  // null when no window took it. Rejects only when `signal` aborted it.
  async function send(event, { timeout, signal } = {}) {
    const body = JSON.stringify({ ...event, agent: 'opencode', cli });
    for (const w of narratingWindows(windowsDir, directory)) {
      const signals = [AbortSignal.timeout(timeout || QUICK_TIMEOUT_MS)];
      if (signal) signals.push(signal);
      let res;
      try {
        res = await fetch(`http://127.0.0.1:${w.port}/coder/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Coding-Tutor-Token': w.token },
          body,
          signal: AbortSignal.any(signals),
        });
      } catch (e) {
        if (signal && signal.aborted) throw e;
        if (e && e.name === 'TimeoutError') throw e;
        continue; // a window that has closed and left its file behind
      }
      const reply = await res.json();
      if (!res.ok || reply.ok === false) throw new Error(reply.error || `the extension refused the event (${res.status})`);
      return reply;
    }
    return null;
  }

  async function step(session) {
    const ctl = new AbortController();
    if (!held.has(session)) held.set(session, new Set());
    held.get(session).add(ctl);
    try {
      for (;;) {
        const reply = await send({ kind: 'step', session }, { timeout: HOLD_TIMEOUT_MS, signal: ctl.signal });
        if (!reply || reply.decision !== 'deny') return;
        if (reply.paused) continue; // no limit on this hook: hold again, the coder need not know
        throw new Refusal(reply.reason || 'Held by Coding Tutor.');
      }
    } catch (e) {
      if (ctl.signal.aborted) throw new Refusal(STOPPED);
      if (e instanceof Refusal) throw e;
      log(e); // never block the coder because of us
    } finally {
      held.get(session).delete(ctl);
    }
  }

  // The engineer pressed Esc: refuse the held steps, which drops their
  // connections, or say so when nothing was held. The turn's idle then asks
  // for no recap.
  async function stop(session) {
    const steps = held.get(session);
    if (steps && steps.size) {
      stopped.add(session);
      for (const ctl of steps) ctl.abort();
    } else if (narrating()) {
      stopped.add(session);
      await send({ kind: 'stopped', session });
    }
  }

  async function end(session) {
    if (ending.has(session)) return;
    ending.add(session);
    try {
      let reply;
      do {
        reply = await send({ kind: 'end', session, lastMessage: lastText.get(session) || '' }, { timeout: HOLD_TIMEOUT_MS });
      } while (reply && reply.paused);
      // The end of an OpenCode turn cannot be blocked: what the engineer said
      // during the recap starts the coder's next turn instead.
      if (reply && reply.decision === 'block' && reply.reason) {
        await client.session.promptAsync({ path: { id: session }, body: { parts: [{ type: 'text', text: reply.reason }] } });
      }
    } finally {
      ending.delete(session);
    }
  }

  const quietly = (fn) => async (...a) => {
    try {
      if (narrating()) await fn(...a);
    } catch (e) {
      log(e);
    }
  };

  return {
    'tool.execute.before': async (input) => {
      if (!narrating()) return;
      await step(input.sessionID);
    },
    'tool.execute.after': quietly(async (input, output) => {
      await send({ ...after(input.tool, input.args, output), session: input.sessionID });
    }),
    'experimental.text.complete': quietly(async (input, output) => {
      const text = output && output.text;
      if (!text || !text.trim()) return;
      lastText.set(input.sessionID, text);
      await send({ kind: 'text', session: input.sessionID, messageId: input.partID || input.messageID, text, final: true });
    }),
    event: async ({ event }) => {
      try {
        const props = event.properties || {};
        const session = props.sessionID;
        if (!session) return;
        if (event.type === 'session.error' && props.error && props.error.name === 'MessageAbortedError') {
          await stop(session);
        } else if (event.type === 'session.idle') {
          if (stopped.delete(session) || !narrating()) return;
          // Not awaited: the recap takes as long as it takes to say, and
          // OpenCode need not wait for it to handle its next events.
          end(session).catch(log);
        }
      } catch (e) {
        log(e);
      }
    },
  };
}

export const CodingTutor = async ({ directory, client }) => {
  // The narrator's own OpenCode server (extension/lib/opencode-narrator.js)
  // loads plugins too; it is not a coder.
  if (process.env.CODING_TUTOR_NARRATOR) return {};
  return adapter({ directory, client, cli: process.execPath });
};

// For the tests only. A property rather than an export: OpenCode calls every
// function the module exports as a plugin.
CodingTutor.forTests = { adapter, after, hunksFromDiff, narratingWindows, STOPPED };

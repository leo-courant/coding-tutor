// A narrated session, coordinated through the coder's hooks (decision 0007).
//
// The coder's agent reports what it does through a thin adapter (for Claude Code,
// mcp/claude_code.py), as agent-neutral events:
//
//   step   the coder is about to take its next step; answered when it may go
//   read, search, command, edit, tool   a step that ran, with what it returned
//   text   text the coder wrote (its why-line before an edit)
//   end    the coder is ending its turn; answered when it may
//
// Each step's result goes to the narrator, which decides what to say; the voice
// says it while the coder's next step is held. What the engineer says goes to the
// narrator too, which answers it or passes it to the coder as the reason the
// coder's next step (or the end of its turn) was held.
//
// Nothing here knows VS Code or a particular agent: the speaker, the pointer,
// the captions and the narrator process are passed in.
const { Regions } = require('./regions');

const MAX_READ_LINES = 400;
const MAX_OUTPUT_CHARS = 3000;
const MAX_TEXT_CHARS = 6000;
const SPEAK_HOLD_MS = 12 * 60 * 60 * 1000; // the voice waits as long as the engineer pauses

const clip = (text, max) => {
  const s = String(text == null ? '' : text);
  return s.length > max ? `${s.slice(0, max)}\n[… ${s.length - max} more characters not shown]` : s;
};

function numbered(text, startLine) {
  const lines = String(text || '').replace(/\n$/, '').split('\n');
  const shown = lines.slice(0, MAX_READ_LINES).map((l, i) => `${startLine + i}\t${l}`);
  if (lines.length > MAX_READ_LINES) shown.push(`[… ${lines.length - MAX_READ_LINES} more lines not shown]`);
  return shown.join('\n');
}

// One event, written for the narrator.
function describe(item) {
  switch (item.kind) {
    case 'read': {
      const start = item.startLine || 1;
      const count = String(item.text || '').replace(/\n$/, '').split('\n').length;
      const of = item.totalLines ? ` of ${item.totalLines}` : '';
      return `The coder read ${item.file}, lines ${start} to ${start + count - 1}${of}:\n${numbered(item.text, start)}`;
    }
    case 'search':
      return `The coder searched: ${item.what}\nResult:\n${clip(item.result, MAX_OUTPUT_CHARS)}`;
    case 'command':
      return `The coder ran a command:\n${item.command}\nOutput:\n${clip(item.output, MAX_OUTPUT_CHARS) || '(none)'}`;
    case 'edit': {
      const where = item.lines.startLine ? `; the changed code is now at lines ${item.lines.startLine} to ${item.lines.endLine}` : '';
      if (item.created) return `Edit ${item.n}: the coder created ${item.file}${where}:\n${clip(item.newText, MAX_TEXT_CHARS)}`;
      if (item.oldText == null) return `Edit ${item.n}: the coder rewrote ${item.file}${where}. It now reads:\n${clip(item.newText, MAX_TEXT_CHARS)}`;
      return `Edit ${item.n}: the coder edited ${item.file}${where}.\nIt replaced:\n${clip(item.oldText, MAX_TEXT_CHARS)}\nwith:\n${clip(item.newText, MAX_TEXT_CHARS)}`;
    }
    case 'tool':
      return `The coder used its ${item.name} tool.`;
    case 'text':
      return `The coder wrote: "${clip(item.text, MAX_TEXT_CHARS)}"`;
    case 'skipped':
      return 'The engineer skipped the rest of what you were saying: they had heard enough. Be briefer on this part.';
    case 'end':
      return `The coder has ended its turn. Its last message:\n${clip(item.lastMessage, MAX_TEXT_CHARS) || '(none)'}\n\nGive the recap now. If the coder ended by asking the engineer something instead, say the question; the engineer will answer in the chat.`;
    case 'engineer': {
      let cut = '';
      if (item.cut && item.cut.said) cut = `\nYou were cut off while saying: "${item.cut.text}"`;
      else if (item.cut) cut = `\nWhat you were about to say was not said: "${item.cut.text}"`;
      return `The engineer interrupted and said: "${item.text}"${cut}`;
    }
    default:
      return `(${item.kind})`;
  }
}

// What the coder is told when the engineer's words are passed to it.
function forCoderReason(messages) {
  return `Held by Coding Tutor. The engineer, through the narrator: ${messages.join(' Also: ')} Deal with this first, then carry on (make this call again if it still applies).`;
}
const STILL_PAUSED = 'Held by Coding Tutor: the engineer has paused the session to think. Make the same call again; it will go through when they resume.';

function createSession({ control, speaker, startNarrator, point, caption, config, log = () => {}, onChange = () => {}, holdLimitMs = 9 * 60 * 1000 }) {
  let s = null;
  let waiters = new Set(); // re-checked whenever something changes

  const changed = () => {
    for (const w of [...waiters]) w();
    onChange();
  };
  control.onChange(changed);

  // A tool result or an engineer's words need the narrator; text alone waits
  // for the step it explains, unless the coder is answering something the
  // engineer asked.
  const needsNarrator = () => s && (control.message || s.items.some((i) => i.kind !== 'text' && i.kind !== 'skipped') || (s.awaitingCoder && s.items.length));
  const idle = () => s && !s.working && !control.paused && !needsNarrator();

  function begin(task, request = '') {
    if (s && s.active) finish('replaced by a new session');
    control.reset();
    s = {
      task,
      request,
      active: true,
      coder: null, // the coder's session id, taken from its first event
      agent: null,
      cli: null,
      narrator: null,
      regions: new Regions(),
      seen: new Set(), // files the coder's own tools showed
      items: [],
      texts: new Map(), // text being streamed, by message id
      forCoder: [],
      awaitingCoder: false,
      working: false,
      thinking: false,
      answering: false, // thinking about what the engineer said
      first: true,
      recap: null,
      lastError: null,
    };
    changed();
  }

  function narrator() {
    if (!s.narrator) s.narrator = startNarrator({ agent: s.agent, cli: s.cli });
    return s.narrator;
  }

  function prompt(items) {
    const asked = s.request && s.request !== s.task ? `\nThe engineer's request, in their words: ${s.request}` : '';
    const head = s.first ? `Task given to the coder: ${s.task}${asked}\n\n` : '';
    s.first = false;
    if (items.length === 1) return head + describe(items[0]);
    return `${head}New events, in order:\n\n${items.map((it, i) => `${i + 1}. ${describe(it)}`).join('\n\n')}`;
  }

  // Where a part points: an edit by its number, wherever it is now, or lines
  // of a file the coder's tools showed. Anything else is not pointed at.
  function pointerFor(answer) {
    if (answer.edit) {
      const r = s.regions.get(answer.edit);
      if (r && r.startLine) return r;
    }
    if (answer.file && s.seen.has(answer.file)) {
      return { file: answer.file, startLine: answer.startLine || null, endLine: answer.endLine || answer.startLine || null };
    }
    return null;
  }

  // Says the narrator's answer, part by part, each with its pointer. Returns
  // what the narrator needs to be told if the engineer cut it short.
  async function say(parts, isRecap) {
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const rest = parts.slice(i).map((p) => p.say).join(' ');
      const where = pointerFor(part);
      if (where) await point(where.file, where.startLine, where.endLine);
      else await point(null);
      if (control.message) return { text: rest, said: false };
      caption({ text: part.say, file: where ? where.file : null, startLine: where ? where.startLine : null, endLine: where ? where.endLine : null, recap: Boolean(isRecap) });
      const result = await speaker.speak(part.say, config(), SPEAK_HOLD_MS);
      if (result.voiceError) log(`voice failed: ${result.voiceError}`);
      if (result.outcome === 'interrupted') return { text: rest, said: true };
      if (result.outcome === 'skipped') {
        s.items.push({ kind: 'skipped' });
        return null;
      }
    }
    return null;
  }

  // Works through what needs the narrator, one turn at a time.
  async function work() {
    if (!s || s.working) return;
    const mine = s;
    s.working = true;
    changed();
    let cut = null;
    try {
      while (s === mine && s.active && needsNarrator()) {
        let items;
        if (control.message) {
          const text = control.takeMessage();
          items = [...s.items, { kind: 'engineer', text, cut }];
          cut = null;
        } else {
          items = s.items;
        }
        s.items = [];
        if (items.some((i) => i.kind === 'text')) s.awaitingCoder = false;
        const isRecap = items.some((i) => i.kind === 'end');
        s.answering = items.some((i) => i.kind === 'engineer');
        s.thinking = true;
        changed();
        const { answer, error } = await narrator().ask(prompt(items));
        if (s !== mine) return;
        s.thinking = false;
        s.answering = false;
        changed();
        if (error) {
          log(`narrator: ${error}`);
          if (error !== s.lastError) caption({ text: `The narrator could not answer: ${error}`, notice: true });
          s.lastError = error;
          continue;
        }
        s.lastError = null;
        if (answer.toCoder && answer.toCoder.trim()) s.forCoder.push(answer.toCoder.trim());
        const parts = (answer.parts || []).filter((p) => p && typeof p.say === 'string' && p.say.trim());
        if (parts.length) {
          if (isRecap) s.recap = parts.map((p) => p.say.trim()).join(' ');
          cut = await say(parts, isRecap);
        }
      }
    } finally {
      if (s === mine) {
        s.working = false;
        s.thinking = false;
        changed();
      }
    }
  }

  // Holds the coder until the narration has caught up and the engineer is not
  // paused, or until there is something to pass to it. Resolves 'go',
  // 'forCoder', 'paused' (held for too long while paused), or 'gone' (the
  // session ended, or the engineer stopped the coder).
  function hold(signal) {
    return new Promise((resolve) => {
      const mine = s;
      let timer = null;
      const done = (r) => {
        waiters.delete(check);
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(r);
      };
      const check = () => {
        if (s !== mine || !s.active) return done('gone');
        if (!idle()) return null;
        return done(s.forCoder.length ? 'forCoder' : 'go');
      };
      const onAbort = () => done('aborted');
      if (signal) {
        if (signal.aborted) return done('aborted');
        signal.addEventListener('abort', onAbort);
      }
      waiters.add(check);
      timer = setTimeout(() => {
        if (control.paused) return done('paused');
        // The narrator or the voice is stuck: never hold the coder for good.
        log('a held step outlasted the hold limit; letting it through');
        done(s && s.forCoder.length ? 'forCoder' : 'go');
      }, holdLimitMs);
      check();
    });
  }

  function takeForCoder() {
    const reason = forCoderReason(s.forCoder);
    s.forCoder = [];
    s.awaitingCoder = true;
    return reason;
  }

  // The engineer pressed Esc in the agent while a step was held: the turn is
  // theirs now, so stop narrating it.
  function stoppedByEngineer() {
    log('the engineer stopped the coder; ending the session');
    control.skip();
    finish('stopped by the engineer');
  }

  function record(ev) {
    const item = { ...ev };
    if (ev.kind === 'read' && ev.file) s.seen.add(ev.file);
    if (ev.kind === 'edit') {
      s.seen.add(ev.file);
      const lineCount = String(ev.newText || '').replace(/\n$/, '').split('\n').length;
      item.n = s.regions.add(ev.file, ev.created ? null : ev.hunks, lineCount);
      item.lines = s.regions.get(item.n);
    }
    s.items.push(item);
  }

  // One event from the coder's adapter. Resolves the answer for the adapter:
  // {decision: 'allow'} or {decision: 'deny' | 'block', reason}.
  async function event(ev, { signal } = {}) {
    const allow = { decision: 'allow' };
    if (!s || !s.active) return allow;
    if (!s.coder) {
      s.coder = ev.session || null;
      s.agent = ev.agent || null;
      s.cli = ev.cli || null;
      log(`narrated session bound to ${s.agent} session ${s.coder}`);
    } else if (ev.session && ev.session !== s.coder) {
      return allow; // another session in the same folder
    }

    switch (ev.kind) {
      case 'step': {
        const r = await hold(signal);
        if (r === 'aborted') { stoppedByEngineer(); return allow; }
        if (r === 'forCoder') return { decision: 'deny', reason: takeForCoder() };
        if (r === 'paused') return { decision: 'deny', reason: STILL_PAUSED };
        return allow;
      }
      case 'end': {
        s.items.push({ kind: 'end', lastMessage: ev.lastMessage || '' });
        work();
        const r = await hold(signal);
        if (r === 'aborted') { stoppedByEngineer(); return allow; }
        if (r === 'forCoder') return { decision: 'block', reason: takeForCoder() };
        if (r === 'paused') return { decision: 'block', reason: STILL_PAUSED };
        if (r === 'go') finish(null);
        return allow;
      }
      case 'text': {
        // Text may arrive in pieces; it counts once the message is complete.
        const id = ev.messageId || 'text';
        const sofar = (s.texts.get(id) || '') + (ev.text || '');
        if (ev.final === false) { s.texts.set(id, sofar); return allow; }
        s.texts.delete(id);
        if (sofar.trim()) s.items.push({ kind: 'text', text: sofar.trim() });
        if (s.awaitingCoder) work();
        return allow;
      }
      case 'read': case 'search': case 'command': case 'edit': case 'tool':
        record(ev);
        work();
        return allow;
      default:
        return allow;
    }
  }

  // The engineer said something, typed or spoken.
  function engineer(text) {
    const said = (text || '').trim();
    if (!said || !s || !s.active) return false;
    caption({ text: said, engineer: true });
    control.interrupt(said);
    work();
    return true;
  }

  let finished = () => {};
  function finish(endedBy) {
    if (!s) return;
    const done = s;
    done.active = false;
    const narratorUsed = done.narrator;
    const summary = {
      task: done.task,
      recap: done.recap,
      endedBy,
      costUsd: narratorUsed ? narratorUsed.costUsd : 0,
      turns: narratorUsed ? narratorUsed.turns : 0,
    };
    if (narratorUsed) narratorUsed.close();
    changed();
    finished(summary);
  }

  return {
    begin,
    event,
    engineer,
    end: (why) => finish(why || 'ended'),
    onFinish(fn) { finished = fn; },
    get active() { return Boolean(s && s.active); },
    get thinking() { return Boolean(s && s.active && s.thinking); },
    get answering() { return Boolean(s && s.active && (s.answering || (control.message && s.working))); },
  };
}

module.exports = { createSession, describe, forCoderReason, STILL_PAUSED };

// SPIKE - throwaway. Replays the recorded session (replay-events.json, made by
// replay_prep.py) through the product: lib/session.js with the real narrator
// process, a silent speaker, and a pointer that checks every line range against
// the file as it was at that moment.
//
//   node spike/narrator/replay.js <claude-cli> [model]   -> spike/narrator/product-results.json
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Control } = require('../../extension/lib/speaker');
const { createNarrator, launchFor } = require('../../extension/lib/narrator');
const { createSession } = require('../../extension/lib/session');

const [cli, model = ''] = process.argv.slice(2);
const HERE = __dirname;
const { task, events, coder } = JSON.parse(fs.readFileSync(path.join(HERE, 'replay-events.json'), 'utf8'));
const script = fs.readFileSync(path.join(HERE, '..', '..', 'extension', 'session-script.md'), 'utf8').replace(/\{\{defaultDepth\}\}/g, 'outline');

const control = new Control();
const files = {}; // each file as it is now in the replay
const turns = [];
let current = null; // the event being narrated
let narrator = null;

const session = createSession({
  control,
  speaker: { speak: async () => ({ outcome: 'spoken' }) },
  startNarrator: ({ agent }) => {
    const { command, args } = launchFor(agent, { cli, model, systemPrompt: script });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrator-'));
    narrator = createNarrator({ command, args, cwd: dir, log: (l) => process.stderr.write(`${l}\n`) });
    return {
      async ask(prompt) {
        const t = Date.now();
        const r = await narrator.ask(prompt);
        turns.push({ at: current, prompt, answer: r.answer, error: r.error, seconds: (Date.now() - t) / 1000, pointers: [] });
        return r;
      },
      get costUsd() { return narrator.costUsd; },
      get turns() { return narrator.turns; },
      close: () => narrator.close(),
    };
  },
  point: async (file, startLine, endLine) => {
    const turn = turns[turns.length - 1];
    if (!turn) return;
    if (!file) { turn.pointers.push(null); return; }
    const body = files[file];
    const shown = body ? body.split('\n').slice(startLine - 1, endLine).join('\n') : null;
    turn.pointers.push({ file, startLine, endLine, shown });
  },
  caption: () => {},
  config: () => ({}),
});

(async () => {
  const finished = new Promise((resolve) => session.onFinish(resolve));
  session.begin(task, task);
  const ev = (e) => session.event({ session: 'replay', agent: 'claude-code', cli, ...e });
  for (const e of events) {
    current = e.at;
    if (e.kind === 'engineer') {
      session.engineer(e.text);
      if (e.at === 27) continue; // said while the recap is due: the end below waits for it
      await ev({ kind: 'step' });
      continue;
    }
    if (e.kind === 'end') { await ev({ kind: 'end', lastMessage: e.lastMessage }); continue; }
    if (e.kind === 'edit') files[e.file] = e.fileAfter;
    const { at, fileAfter, ...neutral } = e;
    await ev(neutral);
    await ev({ kind: 'step' });
  }
  const summary = await finished;
  const out = { model: model || "the agent's default", costUsd: summary.costUsd, turns, coder, recap: summary.recap };
  fs.writeFileSync(path.join(HERE, 'product-results.json'), JSON.stringify(out, null, 1));
  for (const t of turns) {
    console.log(`#${t.at} (${t.seconds.toFixed(1)} s)${t.error ? ` ERROR ${t.error}` : ''}${t.answer && !t.answer.parts.length ? ' (quiet)' : ''}`);
    (t.answer ? t.answer.parts : []).forEach((part, i) => {
      const ptr = t.pointers[i];
      const where = ptr ? `${path.basename(ptr.file)}:${ptr.startLine}-${ptr.endLine}  [${ptr.shown.split('\n')[0].trim().slice(0, 70)}]` : '-';
      console.log(`   SAY: ${part.say}\n     -> ${where}`);
    });
    if (t.answer && t.answer.toCoder) console.log(`   TO CODER: ${t.answer.toCoder}`);
  }
  console.log(`\nNarrator cost for the session: $${summary.costUsd.toFixed(4)} over ${summary.turns} turns`);
})();

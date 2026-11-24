// Coding Tutor: the engineer's side of a narrated session.
// Owns the voice, the captions, the pointer and the engineer's controls. The
// agent reaches it through a token-protected server on 127.0.0.1 (see
// mcp/server.py for the other end).
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const voice = require('./lib/voice');
const transcript = require('./lib/transcript');
const mic = require('./lib/mic');
const { Control, createNarrator } = require('./lib/narrator');
const { panelHtml, voicesHtml } = require('./lib/views');

const WINDOWS_DIR = path.join(os.homedir(), '.coding-tutor', 'windows');
const SAMPLE_SENTENCE = 'Here is the loop. It tries the call, and if it fails, it remembers the error and waits a little longer each time.';
// Claude Code moves a tool call to the background after about two minutes, so a
// pause never holds a call longer than this; the agent calls `wait` instead.
const HOLD_LIMIT_MS = 90 * 1000;

const NOTES = {
  interrupted: 'The engineer interrupted. Whatever you were saying was cut off or not said. Respond to what they said before doing anything else.',
  paused: 'The engineer paused the session to think. Call wait, and keep calling it until it returns something other than paused. Do nothing else meanwhile.',
  skipped: 'The engineer skipped the rest of this narration. Carry on, a little more briefly.',
};

let out;
let pointerType;
let pointerEditor = null;
let panelView = null;
let queue = Promise.resolve(); // agent requests are handled one at a time, in order
const control = new Control();
const narrator = createNarrator({ control, synth: voice.synth, play: voice.play, isMuted: () => config.load().muted });
const session = { active: false, task: '', captions: [], transcriptFile: null, startedAt: null, busy: false, ending: null };
// The mic: 'off' -> 'starting' (the headset is switching on) -> 'listening' -> 'transcribing' -> 'off'.
const micState = { state: 'off', recording: null, error: null, heard: null, partial: '', previewTimer: null };
const PREVIEW_EVERY_MS = 1000;

function workspaceFolder() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : null;
}

function pushState() {
  if (!panelView) return;
  panelView.webview.postMessage({
    type: 'state',
    active: session.active,
    task: session.task,
    captions: session.captions,
    muted: config.load().muted,
    paused: control.paused,
    speaking: session.busy,
    waitingForAgent: Boolean(control.message),
    mic: micState.state,
    micError: micState.error,
    partial: micState.partial,
  });
  // What the mic heard goes into the text box, for the engineer to check and send.
  if (micState.heard !== null) {
    panelView.webview.postMessage({ type: 'heard', text: micState.heard });
    micState.heard = null;
  }
}
control.onChange(pushState);

function addCaption(caption) {
  session.captions.push(caption);
  if (session.transcriptFile) transcript.append(session.transcriptFile, caption, workspaceFolder());
  pushState();
}

// ---- pointer ---------------------------------------------------------------

function clearPointer() {
  if (pointerEditor) pointerEditor.setDecorations(pointerType, []);
  pointerEditor = null;
}

// Puts the pointer on a range of a file. Returns a note for the agent when the
// range had to be adjusted or the file could not be shown.
async function point(file, startLine, endLine) {
  clearPointer();
  if (!file) return null;
  let doc;
  try {
    doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  } catch {
    return `could not open ${file}; nothing was pointed at`;
  }
  const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
  const last = doc.lineCount;
  const from = Math.min(Math.max(startLine || 1, 1), last);
  const to = Math.min(Math.max(endLine || from, from), last);
  const range = new vscode.Range(from - 1, 0, to - 1, doc.lineAt(to - 1).text.length);
  editor.setDecorations(pointerType, startLine ? [range] : []);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  pointerEditor = editor;
  if (startLine && (startLine > last || (endLine || startLine) > last)) {
    return `the file has ${last} lines; the pointer was put on ${from}-${to}`;
  }
  return null;
}

// ---- what the agent is told ------------------------------------------------

function forAgent(result, extra = {}) {
  const reply = { ok: true, outcome: result.outcome, ...extra };
  if (result.outcome === 'interrupted') reply.engineerSaid = control.takeMessage();
  if (NOTES[result.outcome]) reply.note = NOTES[result.outcome];
  if (result.muted) reply.muted = true;
  if (result.voiceError) {
    reply.voiceError = result.voiceError;
    out.appendLine(`voice failed: ${result.voiceError}`);
  }
  return reply;
}

async function speak(run) {
  session.busy = true;
  pushState();
  try {
    return await run();
  } finally {
    session.busy = false;
    pushState();
  }
}

// ---- agent requests ----------------------------------------------------------

async function beginSession(m) {
  const task = (m.task || 'Narrated session').trim();
  control.reset();
  session.active = true;
  session.task = task;
  session.captions = [];
  session.ending = null;
  session.startedAt = new Date();
  session.transcriptFile = transcript.start(task, workspaceFolder());
  clearPointer();
  await vscode.commands.executeCommand('codingTutor.panel.focus', { preserveFocus: true }).then(undefined, () => {});
  pushState();
  const cfg = config.load();
  let voiceState = 'ready';
  if (cfg.muted) {
    voiceState = 'muted: captions only';
    vscode.window.showWarningMessage('Coding Tutor: the voice is muted, so this session will be captions only.', 'Unmute').then((choice) => {
      if (choice === 'Unmute') toggleMute();
    });
  } else {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Coding Tutor: starting the voice (the first start downloads the voice model)…' },
        () => voice.ensureServer(),
      );
    } catch (e) {
      voiceState = `unavailable: ${e.message}`;
      vscode.window.showWarningMessage(`Coding Tutor: the voice is unavailable, captions only. ${e.message}`);
    }
  }
  return { ok: true, defaultDepth: cfg.defaultDepth, voice: voiceState, transcript: session.transcriptFile };
}

async function narrate(m) {
  if (!m.text || typeof m.text !== 'string' || !m.text.trim()) return { ok: false, error: 'text is required' };
  // The engineer spoke while the agent was busy: they come first, and this
  // narration is not said.
  if (control.message) return forAgent({ outcome: 'interrupted' }, { spoken: false });
  const note = await point(m.file, m.startLine, m.endLine);
  addCaption({ text: m.text, file: m.file || null, startLine: m.startLine || null, endLine: m.endLine || m.startLine || null });
  const result = await speak(() => narrator.narrate(m.text, config.load(), HOLD_LIMIT_MS));
  return forAgent(result, note ? { pointerNote: note } : {});
}

async function wait() {
  if (control.message) return forAgent({ outcome: 'interrupted' });
  const result = await speak(() => narrator.resumeHeld(HOLD_LIMIT_MS));
  if (session.ending && result.outcome !== 'paused' && result.outcome !== 'interrupted') return finishSession();
  return forAgent(result);
}

function finishSession() {
  if (session.transcriptFile && session.active) transcript.finish(session.transcriptFile, session.ending, session.startedAt);
  if (micState.recording) stopMic();
  session.ending = null;
  session.active = false;
  clearPointer();
  pushState();
  return { ok: true, outcome: 'ended', transcript: session.transcriptFile };
}

async function endSession(m) {
  if (control.message) return forAgent({ outcome: 'interrupted' }, { ended: false });
  const recap = (m.recap || '').trim();
  if (!recap) return finishSession();
  clearPointer();
  session.ending = recap;
  session.captions.push({ text: recap, file: null, startLine: null, endLine: null, recap: true });
  const result = await speak(() => narrator.narrate(recap, config.load(), HOLD_LIMIT_MS));
  if (result.outcome === 'paused' || result.outcome === 'interrupted') return forAgent(result, { ended: false });
  return { ...forAgent(result), ...finishSession() };
}

const ROUTES = { '/session/begin': beginSession, '/narrate': narrate, '/wait': wait, '/session/end': endSession };

// ---- the engineer's controls -------------------------------------------------

function toggleMute() {
  config.update({ muted: !config.load().muted });
  control.stop(); // the narrator says the cut-off sentence again in the new mode
  pushState();
}

function togglePause() {
  control.togglePause();
}

function setMic(state, error = null) {
  if (state === 'off' || state === 'starting') micState.partial = '';
  micState.state = state;
  micState.error = error;
  pushState();
}

async function toggleMic() {
  if (micState.state === 'transcribing') return;
  if (micState.recording) return stopMic();
  if (!session.active) {
    vscode.window.showInformationMessage('Coding Tutor: the microphone works during a narrated session.');
    return;
  }
  await vscode.commands.executeCommand('codingTutor.panel.focus', { preserveFocus: true }).then(undefined, () => {});
  control.pause(); // talking pauses the narration, as typing does
  setMic('starting');
  micState.recording = mic.startRecording({
    onLive: () => {
      setMic('listening');
      previewWhileTalking();
    },
    onLimit: () => stopMic(),
    onError: async (message) => {
      const recording = micState.recording;
      micState.recording = null;
      if (recording) await recording.stop();
      setMic('off', `Microphone: ${message}.`);
    },
  });
}

// While the engineer talks, transcribe what they have said so far about once a
// second, so they see their words build up. Each pass waits for the previous
// one, so a slow machine simply updates less often.
function previewWhileTalking() {
  const tick = async () => {
    const recording = micState.recording;
    if (!recording || micState.state !== 'listening') return;
    const wav = recording.snapshot();
    if (wav) {
      try {
        const text = await voice.transcribe(wav);
        if (micState.recording === recording && micState.state === 'listening') {
          micState.partial = text;
          pushState();
        }
      } catch (e) {
        out.appendLine(`live preview failed: ${e.message}`);
      }
    }
    if (micState.recording === recording) micState.previewTimer = setTimeout(tick, PREVIEW_EVERY_MS);
  };
  micState.previewTimer = setTimeout(tick, PREVIEW_EVERY_MS);
}

async function stopMic() {
  const recording = micState.recording;
  micState.recording = null;
  clearTimeout(micState.previewTimer);
  if (!recording) return;
  setMic('transcribing');
  const wav = await recording.stop();
  if (!wav) return setMic('off', 'The microphone had not started yet, so nothing was recorded. Wait for "Listening" before you speak.');
  try {
    const text = await voice.transcribe(wav);
    if (!text) return setMic('off', 'Nothing was heard. Try again, a little closer to the mic.');
    micState.heard = text;
    setMic('off');
  } catch (e) {
    out.appendLine(`speech recognition failed: ${e.message}`);
    setMic('off', `Speech recognition failed: ${e.message}`);
  }
}

function interrupt(text) {
  const said = (text || '').trim();
  if (!said) return;
  addCaption({ text: said, engineer: true });
  control.interrupt(said);
}

async function openSettings() {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(config.ensureExists()));
  await vscode.window.showTextDocument(doc);
}

async function openTranscript() {
  if (!session.transcriptFile) return vscode.window.showInformationMessage('Coding Tutor: no narrated session has run in this window yet.');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(session.transcriptFile));
  await vscode.window.showTextDocument(doc);
}

function sampleVoices() {
  const panel = vscode.window.createWebviewPanel('codingTutor.voices', 'Coding Tutor voices', vscode.ViewColumn.Active, { enableScripts: true });
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'config.schema.json'), 'utf8'));
  const voices = schema.properties.voice.enum;
  // The sampler has its own controls so it never touches a running session.
  const sampleControl = new Control();
  const sampler = createNarrator({ control: sampleControl, synth: voice.synth, play: voice.play, isMuted: () => false });
  let playing = null;
  panel.webview.html = voicesHtml(panel.webview.cspSource);
  const send = (extra) => panel.webview.postMessage({ type: 'voices', voices, current: config.load().voice, sentence: SAMPLE_SENTENCE, playing, ...extra });
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'ready') send({});
    if (msg.type === 'use') { config.update({ voice: msg.voice }); send({}); }
    if (msg.type === 'stop') sampleControl.skip();
    if (msg.type === 'play') {
      if (playing) sampleControl.skip();
      const mine = msg.voice;
      playing = mine;
      send({});
      const r = await sampler.narrate(SAMPLE_SENTENCE, { ...config.load(), voice: mine }, HOLD_LIMIT_MS);
      if (r.voiceError) vscode.window.showWarningMessage(`Coding Tutor: could not play the sample. ${r.voiceError}`);
      if (playing === mine) { playing = null; send({}); }
    }
  });
  panel.onDidDispose(() => sampleControl.skip());
}

// ---- activation ------------------------------------------------------------

function activate(ctx) {
  out = vscode.window.createOutputChannel('Coding Tutor');
  voice.setLogger((line) => out.appendLine(line));
  pointerType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 200, 0, 0.18)',
    overviewRulerColor: 'rgba(255, 200, 0, 0.9)',
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });

  ctx.subscriptions.push(
    out,
    pointerType,
    vscode.commands.registerCommand('codingTutor.togglePause', togglePause),
    vscode.commands.registerCommand('codingTutor.toggleMute', toggleMute),
    vscode.commands.registerCommand('codingTutor.toggleMic', toggleMic),
    vscode.commands.registerCommand('codingTutor.skip', () => control.skip()),
    vscode.commands.registerCommand('codingTutor.interrupt', async () => {
      control.pause();
      const said = await vscode.window.showInputBox({ prompt: 'Coding Tutor: say something to the agent', placeHolder: 'Ask, correct, or change the depth…', ignoreFocusOut: true });
      if (said && said.trim()) interrupt(said);
    }),
    vscode.commands.registerCommand('codingTutor.sampleVoices', sampleVoices),
    vscode.commands.registerCommand('codingTutor.openSettings', openSettings),
    vscode.commands.registerCommand('codingTutor.openTranscript', openTranscript),
    vscode.window.registerWebviewViewProvider('codingTutor.panel', {
      resolveWebviewView(view) {
        panelView = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = panelHtml(view.webview.cspSource);
        view.webview.onDidReceiveMessage((msg) => {
          if (msg.type === 'ready') pushState();
          if (msg.type === 'pause') togglePause();
          if (msg.type === 'hold') control.pause();
          if (msg.type === 'interrupt') interrupt(msg.text);
          if (msg.type === 'mic') toggleMic();
          if (msg.type === 'mute') toggleMute();
          if (msg.type === 'skip') control.skip();
          if (msg.type === 'voices') sampleVoices();
          if (msg.type === 'settings') openSettings();
          if (msg.type === 'transcript') openTranscript();
          if (msg.type === 'point') {
            const c = session.captions[msg.index];
            if (c && c.file) point(c.file, c.startLine, c.endLine);
          }
        });
        view.onDidDispose(() => { panelView = null; });
      },
    }),
  );

  // The agent's door in: localhost only, and every request must carry the token.
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-coding-tutor-token'] !== token) return reply(403, { ok: false, error: 'bad token' });
    const handler = ROUTES[req.url];
    if (req.method !== 'POST' || !handler) return reply(404, { ok: false, error: 'unknown route' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      queue = queue.then(async () => {
        try { reply(200, await handler(JSON.parse(body || '{}'))); } catch (e) { out.appendLine(String(e.stack || e)); reply(200, { ok: false, error: String(e.message || e) }); }
      });
    });
  });
  const windowFile = path.join(WINDOWS_DIR, `${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  server.listen(0, '127.0.0.1', () => {
    fs.mkdirSync(WINDOWS_DIR, { recursive: true, mode: 0o700 });
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    fs.writeFileSync(windowFile, JSON.stringify({ port: server.address().port, token, folders, pid: process.pid }), { mode: 0o600 });
    out.appendLine(`listening on 127.0.0.1:${server.address().port} for ${folders.join(', ') || '(no folder)'}`);
  });
  ctx.subscriptions.push({
    dispose() {
      control.skip();
      server.close();
      try { fs.unlinkSync(windowFile); } catch { /* already gone */ }
    },
  });
}

module.exports = { activate, deactivate() {} };

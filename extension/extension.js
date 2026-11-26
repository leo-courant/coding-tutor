// Coding Tutor: the engineer's side of a narrated session.
// Owns the voice, the captions, the pointer, the engineer's controls and the
// narrator. The coder's agent reaches it through a token-protected server on
// 127.0.0.1: its `begin_session` tool (mcp/server.py) starts a session, and its
// hooks (mcp/claude_code.py for Claude Code) report each step and wait to be let
// through. lib/session.js coordinates the two.
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
const { Control, createSpeaker } = require('./lib/speaker');
const { createNarrator, launchFor } = require('./lib/narrator');
const { createSession } = require('./lib/session');
const { panelHtml, voicesHtml } = require('./lib/views');

const STATE_DIR = path.join(os.homedir(), '.coding-tutor');
const WINDOWS_DIR = path.join(STATE_DIR, 'windows');
// The narrator runs in a folder of its own, so its CLI picks up nothing from
// the project: it knows only what the coder's tools returned.
const NARRATOR_DIR = path.join(STATE_DIR, 'narrator');
const USER_SCRIPT = path.join(os.homedir(), '.config', 'coding-tutor', 'session-script.md');
const DEFAULT_SCRIPT = path.join(__dirname, 'session-script.md');
const SAMPLE_SENTENCE = 'Here is the loop. It tries the call, and if it fails, it remembers the error and waits a little longer each time.';
const SAMPLE_HOLD_MS = 90 * 1000;

let out;
let pointerType;
let pointerEditor = null;
let panelView = null;
let queue = Promise.resolve(); // begin_session requests are handled one at a time, in order
let writeWindowFile = () => {};
const control = new Control();
const speaker = createSpeaker({ control, synth: voice.synth, play: voice.play, isMuted: () => config.load().muted });
// What the panel and the transcript show of the current (or last) session.
const ui = { task: '', captions: [], transcriptFile: null, startedAt: null, speaking: false };
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
    active: tutor.active,
    task: ui.task,
    captions: ui.captions,
    muted: config.load().muted,
    paused: control.paused,
    speaking: ui.speaking,
    waitingForAgent: tutor.answering,
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
  ui.captions.push(caption);
  // The recap goes into the transcript under its own heading when the session ends.
  if (ui.transcriptFile && !caption.recap) transcript.append(ui.transcriptFile, caption, workspaceFolder());
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

// ---- the narrator and the session ------------------------------------------

function sessionScript(defaultDepth) {
  const file = fs.existsSync(USER_SCRIPT) ? USER_SCRIPT : DEFAULT_SCRIPT;
  return fs.readFileSync(file, 'utf8').replace(/\{\{defaultDepth\}\}/g, defaultDepth);
}

// The coder's CLI, when its adapter did not report one: the agent on the PATH,
// or the one the Claude Code extension ships (inside a Flatpak there is often
// no other).
function fallbackCli(agent) {
  if (agent !== 'claude-code') return null;
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  const bundled = ext && path.join(ext.extensionPath, 'resources', 'native-binary', 'claude');
  return bundled && fs.existsSync(bundled) ? bundled : 'claude';
}

let narratorModel = '';
function startNarrator({ agent, cli }) {
  const cfg = config.load();
  const kind = agent || 'claude-code';
  narratorModel = cfg.narratorModel;
  const { command, args } = launchFor(kind, { cli: cli || fallbackCli(kind), model: cfg.narratorModel, systemPrompt: sessionScript(cfg.defaultDepth) });
  fs.mkdirSync(NARRATOR_DIR, { recursive: true, mode: 0o700 });
  return createNarrator({ command, args, cwd: NARRATOR_DIR, log: (line) => out.appendLine(line) });
}

// The speaker, with the panel told while it speaks.
const shownSpeaker = {
  async speak(text, cfg, holdMs) {
    ui.speaking = true;
    pushState();
    try {
      return await speaker.speak(text, cfg, holdMs);
    } finally {
      ui.speaking = false;
      pushState();
    }
  },
};

const tutor = createSession({
  control,
  speaker: shownSpeaker,
  startNarrator,
  point,
  caption: addCaption,
  config: config.load,
  log: (line) => out.appendLine(line),
  onChange: () => pushState(),
});

tutor.onFinish((summary) => {
  const cost = `$${summary.costUsd.toFixed(3)}`;
  const model = narratorModel || "the agent's default model";
  const note = summary.turns ? `Narrator: ${model}, ${summary.turns} turns, ${cost}.` : null;
  out.appendLine(`session ended (${summary.endedBy || 'the coder finished'}); ${note || 'the narrator was not used'}`);
  if (ui.transcriptFile) transcript.finish(ui.transcriptFile, summary.recap, ui.startedAt, new Date(), note);
  if (micState.recording) stopMic();
  clearPointer();
  writeWindowFile(false);
  pushState();
});

// ---- agent requests ----------------------------------------------------------

async function beginSession(m) {
  const task = (m.task || 'Narrated session').trim();
  tutor.begin(task, typeof m.request === 'string' ? m.request.trim() : '');
  ui.task = task;
  ui.captions = [];
  ui.startedAt = new Date();
  ui.transcriptFile = transcript.start(task, workspaceFolder());
  clearPointer();
  writeWindowFile(true);
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
  return { ok: true, voice: voiceState, transcript: ui.transcriptFile };
}

const ROUTES = { '/session/begin': beginSession };

// ---- the engineer's controls -------------------------------------------------

function toggleMute() {
  config.update({ muted: !config.load().muted });
  control.stop(); // the speaker says the cut-off sentence again in the new mode
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
  if (!tutor.active) {
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
  if (!tutor.engineer(text) && (text || '').trim()) {
    vscode.window.showInformationMessage('Coding Tutor: there is no narrated session to send that to.');
  }
}

async function openSettings() {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(config.ensureExists()));
  await vscode.window.showTextDocument(doc);
}

async function openTranscript() {
  if (!ui.transcriptFile) return vscode.window.showInformationMessage('Coding Tutor: no narrated session has run in this window yet.');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ui.transcriptFile));
  await vscode.window.showTextDocument(doc);
}

function sampleVoices() {
  const panel = vscode.window.createWebviewPanel('codingTutor.voices', 'Coding Tutor voices', vscode.ViewColumn.Active, { enableScripts: true });
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'config.schema.json'), 'utf8'));
  const voices = schema.properties.voice.enum;
  // The sampler has its own controls so it never touches a running session.
  const sampleControl = new Control();
  const sampler = createSpeaker({ control: sampleControl, synth: voice.synth, play: voice.play, isMuted: () => false });
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
      const r = await sampler.speak(SAMPLE_SENTENCE, { ...config.load(), voice: mine }, SAMPLE_HOLD_MS);
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
      const said = await vscode.window.showInputBox({ prompt: 'Coding Tutor: say something to the narrator', placeHolder: 'Ask, correct, or change the depth…', ignoreFocusOut: true });
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
            const c = ui.captions[msg.index];
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
    let replied = false;
    const reply = (code, obj) => { replied = true; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-coding-tutor-token'] !== token) return reply(403, { ok: false, error: 'bad token' });
    const isEvent = req.url === '/coder/event';
    const handler = ROUTES[req.url];
    if (req.method !== 'POST' || (!handler && !isEvent)) return reply(404, { ok: false, error: 'unknown route' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const fail = (e) => { out.appendLine(String(e.stack || e)); if (!replied) reply(200, { ok: false, error: String(e.message || e) }); };
      if (isEvent) {
        // The coder's hooks. These are not queued: a held step waits while the
        // next events arrive. When the agent kills a held hook (the engineer
        // pressed Esc), the connection drops before the answer.
        const stopped = new AbortController();
        res.on('close', () => { if (!replied) stopped.abort(); });
        try {
          const answer = await tutor.event(JSON.parse(body || '{}'), { signal: stopped.signal });
          if (!res.destroyed) reply(200, { ok: true, ...answer });
        } catch (e) { fail(e); }
        return;
      }
      queue = queue.then(async () => {
        try { reply(200, await handler(JSON.parse(body || '{}'))); } catch (e) { fail(e); }
      });
    });
  });
  const windowFile = path.join(WINDOWS_DIR, `${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  // `narrating` lets the hooks do nothing, quickly, when no session is running.
  writeWindowFile = (narrating) => {
    if (!server.listening) return;
    fs.mkdirSync(WINDOWS_DIR, { recursive: true, mode: 0o700 });
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    fs.writeFileSync(windowFile, JSON.stringify({ port: server.address().port, token, folders, pid: process.pid, narrating }), { mode: 0o600 });
  };
  server.listen(0, '127.0.0.1', () => {
    writeWindowFile(false);
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    out.appendLine(`listening on 127.0.0.1:${server.address().port} for ${folders.join(', ') || '(no folder)'}`);
  });
  ctx.subscriptions.push({
    dispose() {
      if (tutor.active) tutor.end('the window closed');
      control.skip();
      server.close();
      try { fs.unlinkSync(windowFile); } catch { /* already gone */ }
    },
  });
}

module.exports = { activate, deactivate() {} };

// The two pages the extension shows: the narration panel and the voice sampler.
const crypto = require('crypto');

function page(cspSource, style, body, script) {
  const nonce = crypto.randomBytes(16).toString('base64');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 12px 12px; }
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 3px; padding: 4px 10px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:disabled { opacity: .5; cursor: default; }
.dim { color: var(--vscode-descriptionForeground); }
${style}
</style>
</head>
<body>
${body}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const send = (type, extra) => vscode.postMessage({ type, ...extra });
${script}
send('ready');
</script>
</body>
</html>`;
}

const ICONS = {
  cap: '<svg viewBox="0 0 24 24"><path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.8v4c1.5 1.6 3.4 2.4 5.5 2.4s4-.8 5.5-2.4v-4"/><path d="M21.5 9.5v5"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24" class="solid"><path d="M7 4.5v15l13-7.5z"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5 5l9 7-9 7zM19 5v14"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3" class="solid"/><circle cx="12" cy="12" r="1.3" class="solid"/><circle cx="19" cy="12" r="1.3" class="solid"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// The narration panel, in the "conversation" design: a chat with the tutor.
function panelHtml(cspSource) {
  return page(
    cspSource,
    `
/* State colours mean the same everywhere: amber pause, green resume, red mic and mute, blue speaking. */
:root { --amber: #f0a020; --green: #3fb950; --red: #e5484d; --blue: #3b8eea; --you: #1f5f9e;
  --bubble: var(--vscode-editorWidget-background, #222228); --line: var(--vscode-panel-border, #2a2a30); }
html, body { height: 100%; }
body { padding: 0; margin: 0; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
svg .solid, svg.solid, svg .solid path, svg.solid path { fill: currentColor; stroke: none; }
button { padding: 0; background: transparent; color: inherit; }
button:disabled { opacity: .4; cursor: default; }

#head { display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 10px; border-bottom: 1px solid var(--line); position: relative; }
.avatar { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; position: relative;
  background: linear-gradient(135deg, var(--vscode-button-secondaryBackground, #3b3b46), var(--bubble)); }
.avatar svg { width: 17px; height: 17px; stroke-width: 1.7; }
.avatar .dot { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--vscode-sideBar-background); background: #777; }
.avatar .dot.speaking { background: var(--blue); } .avatar .dot.paused { background: var(--amber); }
.avatar .dot.listening { background: var(--red); } .avatar .dot.working { background: var(--green); }
#who { flex: 1; min-width: 0; }
#who b { display: block; font-size: 13px; }
#status { font-size: 11.5px; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eq { display: inline-flex; gap: 2px; align-items: flex-end; height: 10px; flex: none; }
.eq i { width: 2px; background: var(--blue); border-radius: 1px; animation: eq .9s ease-in-out infinite; }
.eq i:nth-child(2) { animation-delay: .15s; } .eq i:nth-child(3) { animation-delay: .3s; }
.tb { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--vscode-icon-foreground, #b6b6bd); }
.tb:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, #ffffff14); }
.tb.pause { background: var(--amber); color: #1d1300; }
.tb.resume { background: var(--green); color: #04140a; }
.tb.muted { background: var(--red); color: #fff; }
#menu { position: absolute; right: 8px; top: 44px; z-index: 5; min-width: 170px; padding: 4px; border-radius: 10px;
  background: var(--vscode-menu-background, #1e1e23); color: var(--vscode-menu-foreground, inherit); border: 1px solid var(--vscode-menu-border, var(--line)); box-shadow: 0 8px 24px #0006; }
#menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border-radius: 6px; text-align: left; font-size: 12.5px; }
#menu button:hover { background: var(--vscode-menu-selectionBackground, #ffffff14); color: var(--vscode-menu-selectionForeground, inherit); }

.banner { margin: 8px 10px 0; padding: 7px 8px 7px 10px; border-radius: 10px; font-size: 12px; display: flex; align-items: center; gap: 8px; }
.banner[hidden] { display: none; }
.banner span { flex: 1; }
.banner button { padding: 3px 10px; border-radius: 99px; font-weight: 600; font-size: 12px; }
#mutedBanner { background: rgba(229, 72, 77, .14); border: 1px solid rgba(229, 72, 77, .5); }
#mutedBanner button { background: var(--red); color: #fff; }
#pausedBanner { background: rgba(240, 160, 32, .13); border: 1px solid rgba(240, 160, 32, .5); }
#pausedBanner button { background: var(--green); color: #04140a; }

#msgs { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 10px; }
#empty { margin: auto; text-align: center; color: var(--vscode-descriptionForeground); max-width: 220px; }
#empty .avatar { margin: 0 auto 10px; width: 44px; height: 44px; }
#empty .avatar svg { width: 22px; height: 22px; }
.divider { align-self: center; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 10px; border-radius: 99px; border: 1px solid var(--line); max-width: 100%; text-align: center; }
.bubble { max-width: 90%; padding: 8px 11px; border-radius: 14px; border-top-left-radius: 4px; background: var(--bubble); line-height: 1.5; opacity: .82; }
.bubble.now { opacity: 1; box-shadow: inset 0 0 0 1px rgba(240, 160, 32, .6); }
.bubble.recap { opacity: 1; box-shadow: inset 0 0 0 1px rgba(63, 185, 80, .55); }
.bubble.you { align-self: flex-end; background: var(--you); color: #eef5ff; border-radius: 14px; border-top-right-radius: 4px; opacity: 1; }
.chip { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 11px; padding: 1px 7px; border-radius: 6px; cursor: pointer;
  font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); }
.chip svg { width: 12px; height: 12px; }
.bubble.now .chip { color: #e2b25c; background: rgba(240, 160, 32, .08); }
.chip:hover { color: var(--vscode-foreground); }

#composer { margin: 0 10px; display: flex; align-items: flex-end; gap: 6px; padding: 5px 5px 5px 12px; border-radius: 20px;
  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--line)); }
#composer:focus-within { border-color: var(--vscode-focusBorder); }
#say { flex: 1; min-height: 22px; max-height: 120px; resize: none; border: 0; outline: 0; background: transparent; color: var(--vscode-input-foreground); font: inherit; padding: 5px 0; line-height: 1.45; }
#live { flex: 1; padding: 5px 0; line-height: 1.45; color: var(--vscode-input-foreground); font-style: italic; }
#live[hidden] { display: none; }
#live::after { content: "▍"; color: var(--red); font-style: normal; animation: blink 1s infinite; }
.ci { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--vscode-icon-foreground, #b6b6bd); }
.ci:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, #ffffff14); }
.ci.send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.ci.starting { background: var(--amber); color: #1d1300; }
.ci.listening { background: var(--red); color: #fff; animation: ring 1.2s infinite; }
#hint { min-height: 18px; margin: 4px 16px 8px; font-size: 11.5px; color: var(--vscode-descriptionForeground); }
#hint.error { color: var(--vscode-errorForeground); }
@keyframes eq { 0%, 100% { height: 30%; } 50% { height: 100%; } }
@keyframes ring { 0% { box-shadow: 0 0 0 0 rgba(229, 72, 77, .55); } 100% { box-shadow: 0 0 0 9px rgba(229, 72, 77, 0); } }
@keyframes blink { 50% { opacity: 0; } }
`,
    `
<div id="head">
  <span class="avatar">${ICONS.cap}<span class="dot" id="dot"></span></span>
  <span id="who"><b>Tutor</b><span id="status">Idle</span></span>
  <button id="pause" class="tb" title="Pause (Ctrl+Alt+P)"></button>
  <button id="skip" class="tb" title="Skip what is being said">${ICONS.skip}</button>
  <button id="mute" class="tb" title="Mute or unmute the voice"></button>
  <button id="more" class="tb" title="More">${ICONS.more}</button>
  <div id="menu" hidden>
    <button id="voices">${ICONS.wave}Sample voices</button>
    <button id="settings">${ICONS.gear}Settings</button>
    <button id="transcript">${ICONS.doc}Latest transcript</button>
  </div>
</div>
<div id="mutedBanner" class="banner" hidden><span>The voice is muted. Captions only.</span><button id="unmute">Unmute</button></div>
<div id="msgs"></div>
<div id="pausedBanner" class="banner" hidden><span>Paused. Take your time, then resume or say something.</span><button id="resume">Resume</button></div>
<div style="height:8px"></div>
<div id="composer">
  <div id="live" hidden></div>
  <textarea id="say" rows="1" placeholder="Message the tutor…"></textarea>
  <button id="mic" class="ci" title="Talk (Ctrl+Alt+M)">${ICONS.mic}</button>
  <button id="send" class="ci send" title="Send (Enter)">${ICONS.send}</button>
</div>
<div id="hint"></div>
`,
    `
const ICONS = ${JSON.stringify(ICONS)};
const $ = (id) => document.getElementById(id);
const say = $('say');
let state = {};
let reviewing = false;
let shown = -1;

for (const id of ['skip', 'voices', 'settings', 'transcript']) $(id).addEventListener('click', () => { $('menu').hidden = true; send(id); });
$('pause').addEventListener('click', () => send('pause'));
$('resume').addEventListener('click', () => send('pause'));
$('mute').addEventListener('click', () => send('mute'));
$('unmute').addEventListener('click', () => send('mute'));
$('mic').addEventListener('click', () => send('mic'));
$('more').addEventListener('click', (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; });
document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) $('menu').hidden = true; });

const grow = () => { say.style.height = 'auto'; say.style.height = Math.min(say.scrollHeight, 120) + 'px'; };
say.addEventListener('input', () => {
  grow();
  if (say.value.trim() && state.active && !state.paused) send('hold');
  if (!say.value.trim()) reviewing = false;
  renderHint();
});
const submit = () => {
  const text = say.value.trim();
  if (!text || !state.active) return;
  send('interrupt', { text });
  say.value = '';
  reviewing = false;
  grow();
};
$('send').addEventListener('click', submit);
say.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });

const where = (c) => {
  const name = c.file.split('/').pop();
  return name + (c.startLine ? ' ' + c.startLine + (c.endLine && c.endLine !== c.startLine ? '–' + c.endLine : '') : '');
};

function renderHint() {
  const d = state;
  const hint = $('hint');
  hint.className = d.micError ? 'error' : '';
  hint.textContent = d.micError ? d.micError
    : !d.active ? ''
    : d.mic === 'starting' ? 'Starting the mic. Speak when it turns red.'
    : d.mic === 'listening' ? 'Listening. Click the mic again when you are done.'
    : d.mic === 'transcribing' ? 'Turning what you said into text…'
    : d.waitingForAgent ? 'Sent. The tutor answers as soon as it finishes what it is doing.'
    : reviewing ? 'Check what was heard, fix it if needed, then press Enter.'
    : say.value.trim() ? 'Enter to send, Shift+Enter for a new line.'
    : 'Typing or talking pauses the tutor.';
}

function renderHead(d) {
  let dot = '', status = 'Idle';
  if (d.active) {
    if (d.mic === 'listening' || d.mic === 'starting') { dot = 'listening'; status = 'Listening to you…'; }
    else if (d.mic === 'transcribing') { dot = 'listening'; status = 'Transcribing what you said…'; }
    else if (d.paused) { dot = 'paused'; status = 'Paused · waiting for you'; }
    else if (d.waitingForAgent) { dot = 'working'; status = 'Reading your message…'; }
    else if (d.speaking) { dot = 'speaking'; status = '<span class="eq"><i style="height:40%"></i><i style="height:80%"></i><i style="height:55%"></i></span>Speaking'; }
    else { dot = 'working'; status = 'Working on the code…'; }
  }
  $('dot').className = 'dot ' + dot;
  $('status').innerHTML = status;
  const pause = $('pause');
  pause.innerHTML = d.paused ? ICONS.play : ICONS.pause;
  pause.className = 'tb ' + (d.active ? (d.paused ? 'resume' : 'pause') : '');
  pause.title = d.paused ? 'Resume (Ctrl+Alt+P)' : 'Pause (Ctrl+Alt+P)';
  pause.disabled = !d.active;
  $('skip').disabled = !d.speaking || d.paused;
  const mute = $('mute');
  mute.innerHTML = d.muted ? ICONS.muted : ICONS.vol;
  mute.className = 'tb' + (d.muted ? ' muted' : '');
  mute.title = d.muted ? 'Unmute the voice' : 'Mute the voice';
  $('mutedBanner').hidden = !d.muted;
  $('pausedBanner').hidden = !(d.active && d.paused && d.mic === 'off');
}

function renderMessages(d) {
  const msgs = $('msgs');
  msgs.textContent = '';
  if (!d.captions.length) {
    msgs.innerHTML = '<div id="empty"><span class="avatar">' + ICONS.cap + '</span>' + (d.active
      ? 'The tutor is reading your project. It will start explaining in a moment.'
      : 'No session yet. Ask your agent to <b>/tutor</b> a task, and the tutor will talk you through it here.') + '</div>';
    return;
  }
  if (d.task) {
    const div = document.createElement('div');
    div.className = 'divider';
    div.textContent = d.task;
    msgs.appendChild(div);
  }
  const lastTutor = d.captions.map((c) => !c.engineer).lastIndexOf(true);
  d.captions.forEach((c, i) => {
    const b = document.createElement('div');
    b.className = 'bubble' + (c.engineer ? ' you' : '') + (c.recap ? ' recap' : '') + (i === lastTutor && d.active && !c.recap ? ' now' : '');
    b.appendChild(document.createTextNode(c.text));
    if (c.file) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = ICONS.code;
      chip.appendChild(document.createTextNode(where(c)));
      chip.title = 'Show this code again';
      chip.addEventListener('click', () => send('point', { index: i }));
      b.appendChild(document.createElement('br'));
      b.appendChild(chip);
    }
    msgs.appendChild(b);
  });
  if (d.captions.length !== shown) {
    shown = d.captions.length;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function renderComposer(d) {
  const talking = d.mic === 'listening' || d.mic === 'transcribing';
  $('live').hidden = !talking;
  say.hidden = talking;
  $('live').textContent = d.partial || (d.mic === 'listening' ? 'Listening…' : '');
  say.disabled = !d.active;
  say.placeholder = d.active ? 'Message the tutor…' : 'Start a session with /tutor';
  const mic = $('mic');
  mic.className = 'ci' + (d.mic === 'starting' ? ' starting' : d.mic === 'listening' ? ' listening' : '');
  mic.disabled = !d.active || d.mic === 'transcribing';
  $('send').disabled = !d.active;
}

window.addEventListener('message', ({ data }) => {
  if (data.type === 'heard') {
    say.value = say.value.trim() ? say.value.trim() + ' ' + data.text : data.text;
    reviewing = true;
    say.hidden = false;
    grow();
    say.focus();
    renderHint();
    return;
  }
  if (data.type !== 'state') return;
  state = data;
  if (data.mic !== 'off') reviewing = false;
  renderHead(data);
  renderMessages(data);
  renderComposer(data);
  renderHint();
});
`,
  );
}

function voicesHtml(cspSource) {
  return page(
    cspSource,
    `
body { max-width: 640px; margin: 0 auto; padding: 16px; }
h2 { font-size: 1em; margin: 20px 0 6px; color: var(--vscode-descriptionForeground); font-weight: 600; }
.voice { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; }
.voice.current { background: var(--vscode-list-inactiveSelectionBackground); }
.voice .name { width: 8em; font-weight: 600; text-transform: capitalize; }
.voice .tag { flex: 1; }
`,
    `
<h1>Voices</h1>
<p>Every voice says the same sentence: <i id="sentence"></i></p>
<p class="dim">Play a few, then choose one. Your choice is saved to the settings file and used from the next narration on.</p>
<div id="list"></div>
`,
    `
const GROUPS = { af: 'American, female', am: 'American, male', bf: 'British, female', bm: 'British, male' };
window.addEventListener('message', ({ data }) => {
  if (data.type !== 'voices') return;
  document.getElementById('sentence').textContent = data.sentence;
  const list = document.getElementById('list');
  list.textContent = '';
  for (const [prefix, title] of Object.entries(GROUPS)) {
    const h = document.createElement('h2');
    h.textContent = title;
    list.appendChild(h);
    for (const v of data.voices.filter((x) => x.startsWith(prefix + '_'))) {
      const row = document.createElement('div');
      row.className = 'voice' + (v === data.current ? ' current' : '');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = v.slice(3);
      const tag = document.createElement('span');
      tag.className = 'tag dim';
      tag.textContent = v === data.current ? 'in use' : '';
      const play = document.createElement('button');
      play.textContent = data.playing === v ? 'Stop' : 'Play';
      play.addEventListener('click', () => send(data.playing === v ? 'stop' : 'play', { voice: v }));
      const use = document.createElement('button');
      use.className = 'primary';
      use.textContent = 'Use this voice';
      use.disabled = v === data.current;
      use.addEventListener('click', () => send('use', { voice: v }));
      row.append(name, tag, play, use);
      list.appendChild(row);
    }
  }
});
`,
  );
}

module.exports = { panelHtml, voicesHtml };

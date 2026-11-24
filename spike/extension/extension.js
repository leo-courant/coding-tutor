// SPIKE - throwaway. Proves: agent tool call -> this extension -> pointer on code + local voice.
// Listens on 127.0.0.1 (random port, token in ~/.coding-tutor/spike.json).
// POST /narrate {text, file?, startLine?, endLine?}  -> responds when the voice has finished.
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TTS = { host: '127.0.0.1', port: 47811, path: '/speak' };
const pointer = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(255, 200, 0, 0.18)',
  overviewRulerColor: 'rgba(255, 200, 0, 0.9)',
});

function synth(text) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...TTS, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject); req.end(JSON.stringify({ text }));
  });
}
function play(wav) {
  return new Promise((resolve) => {
    const f = path.join(os.tmpdir(), 'coding-tutor-spike-' + Date.now() + '.wav');
    fs.writeFileSync(f, wav);
    const p = spawn('paplay', [f]);
    let err = ''; p.stderr.on('data', (d) => (err += d));
    const done = (r) => { fs.rm(f, () => {}); resolve(r); };
    p.on('close', (code) => done({ code, err })); p.on('error', (e) => done({ code: -1, err: String(e) }));
  });
}

async function narrate(m, status, out) {
  const t = {}; const t0 = Date.now();
  let editor;
  if (m.file) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file));
    editor = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
    const range = new vscode.Range((m.startLine || 1) - 1, 0, (m.endLine || m.startLine || 1) - 1, 0);
    editor.setDecorations(pointer, [range]);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    t.pointerMs = Date.now() - t0;
  }
  status.text = '$(unmute) ' + m.text; status.show(); out.appendLine(m.text);
  let wav;
  try { wav = await synth(m.text); } catch (e) { return { ok: false, error: 'voice server unreachable: ' + e.message, ...t }; }
  t.synthMs = Date.now() - t0;
  const r = await play(wav);
  t.totalMs = Date.now() - t0;
  status.text = '$(mute) Coding Tutor spike';
  return { ok: r.code === 0, playerExit: r.code, playerErr: r.err, wavBytes: wav.length, ...t };
}

function activate(ctx) {
  const token = crypto.randomBytes(16).toString('hex');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  const out = vscode.window.createOutputChannel('Coding Tutor spike');
  status.text = '$(mute) Coding Tutor spike'; status.show();
  const server = http.createServer((req, res) => {
    if (req.headers['x-token'] !== token) { res.writeHead(403); return res.end(); }
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let result;
      try { result = await narrate(JSON.parse(body), status, out); } catch (e) { result = { ok: false, error: String(e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const dir = path.join(os.homedir(), '.coding-tutor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spike.json'), JSON.stringify({ port: server.address().port, token }), { mode: 0o600 });
    out.appendLine('listening on ' + server.address().port);
  });
  ctx.subscriptions.push({ dispose: () => server.close() }, status, out, pointer);
}
module.exports = { activate, deactivate() {} };

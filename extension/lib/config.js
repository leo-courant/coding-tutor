// The engineer's settings: one JSON file, readable by every part of Coding Tutor.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEPTHS = ['skim', 'outline', 'walk', 'line-by-line'];
const DEFAULTS = { voice: 'am_adam', defaultDepth: 'outline', language: 'en', muted: false, speed: 1.0 };

function configPath() {
  // Deliberately not XDG_CONFIG_HOME: inside a Flatpak that points into the sandbox,
  // and the agent's tools must find the same file.
  return path.join(os.homedir(), '.config', 'coding-tutor', 'config.json');
}

function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { /* missing or invalid: defaults */ }
  const cfg = { ...DEFAULTS, ...raw };
  if (!DEPTHS.includes(cfg.defaultDepth)) cfg.defaultDepth = DEFAULTS.defaultDepth;
  return cfg;
}

function update(patch) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { /* start fresh */ }
  const next = { ...DEFAULTS, ...raw, ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

function ensureExists() {
  if (!fs.existsSync(configPath())) update({});
  return configPath();
}

module.exports = { DEPTHS, DEFAULTS, configPath, load, update, ensureExists };

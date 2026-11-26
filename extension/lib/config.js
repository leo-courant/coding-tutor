// The engineer's settings: one JSON file, readable by every part of Coding Tutor.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEPTHS = ['skim', 'outline', 'walk', 'line-by-line'];
// narratorModel: the model the narrator runs on, for every agent ("sonnet") or
// per agent ({"claude-code": "sonnet", "opencode": "local/qwen3.6-35b"}). Empty,
// or an agent left out, means that agent's default model, the one the engineer
// codes with. Anything else goes to the agent as is (Claude Code's --model,
// OpenCode's provider/model).
const DEFAULTS = { voice: 'am_adam', defaultDepth: 'outline', language: 'en', muted: false, speed: 1.0, narratorModel: '' };

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
  cfg.narratorModel = normalModel(cfg.narratorModel);
  return cfg;
}

// narratorModel as a trimmed string, or an object of trimmed strings by agent.
function normalModel(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const byAgent = {};
  for (const [agent, model] of Object.entries(value)) {
    if (typeof model === 'string' && model.trim()) byAgent[agent] = model.trim();
  }
  return byAgent;
}

// The narrator's model for `agent` (an adapter's id, such as "claude-code" or
// "opencode"): '' means that agent's default model.
function narratorModelFor(cfg, agent) {
  const m = normalModel(cfg && cfg.narratorModel);
  return typeof m === 'string' ? m : m[agent] || '';
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

module.exports = { DEPTHS, DEFAULTS, configPath, load, update, ensureExists, normalModel, narratorModelFor };

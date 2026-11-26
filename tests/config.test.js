const test = require('node:test');
const assert = require('node:assert');
const { normalModel, narratorModelFor } = require('../extension/lib/config');

test('one narrator model for every agent', () => {
  assert.strictEqual(narratorModelFor({ narratorModel: ' sonnet ' }, 'claude-code'), 'sonnet');
  assert.strictEqual(narratorModelFor({ narratorModel: 'sonnet' }, 'opencode'), 'sonnet');
  assert.strictEqual(narratorModelFor({ narratorModel: '' }, 'opencode'), '');
});

test('a narrator model per agent; an agent left out gets its default model', () => {
  const cfg = { narratorModel: { 'claude-code': 'sonnet', opencode: ' local/qwen3.6-35b ' } };
  assert.strictEqual(narratorModelFor(cfg, 'claude-code'), 'sonnet');
  assert.strictEqual(narratorModelFor(cfg, 'opencode'), 'local/qwen3.6-35b');
  assert.strictEqual(narratorModelFor({ narratorModel: { 'claude-code': 'sonnet' } }, 'opencode'), '');
});

test('anything else in the setting means the default model', () => {
  assert.strictEqual(normalModel(undefined), '');
  assert.strictEqual(normalModel(42), '');
  assert.strictEqual(normalModel(['sonnet']), '');
  assert.deepStrictEqual(normalModel({ 'claude-code': 7, opencode: '  ', x: 'm' }), { x: 'm' });
  assert.strictEqual(narratorModelFor({}, 'claude-code'), '');
});

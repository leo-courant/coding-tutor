const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finish, formatDuration } = require('../extension/lib/transcript');

test('formatDuration says the length the way a person would', () => {
  assert.strictEqual(formatDuration(20 * 1000), 'under a minute');
  assert.strictEqual(formatDuration(60 * 1000), '1 minute');
  assert.strictEqual(formatDuration(12 * 60 * 1000), '12 minutes');
  assert.strictEqual(formatDuration(60 * 60 * 1000), '1 hour');
  assert.strictEqual(formatDuration(125 * 60 * 1000), '2 hours 5 minutes');
});

test('finish writes the recap, then when the session ended and how long it took', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-')), 't.md');
  fs.writeFileSync(file, '# Task\n\n');
  finish(file, 'All done.', new Date(2026, 10, 24, 16, 0), new Date(2026, 10, 24, 16, 12));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '# Task\n\n## Recap\n\nAll done.\n\nSession ended 16:12, after 12 minutes.\n');
});

test('finish without a recap still records the ending', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-')), 't.md');
  fs.writeFileSync(file, '');
  finish(file, null, new Date(2026, 10, 24, 9, 0), new Date(2026, 10, 24, 10, 5));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'Session ended 10:05, after 1 hour 5 minutes.\n');
});

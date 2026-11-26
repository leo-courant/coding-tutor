const test = require('node:test');
const assert = require('node:assert');
const { Regions, changedLines } = require('../extension/lib/regions');

// The hunk Claude Code reported for a real edit: a one-line docstring on line 5
// replaced by a thirteen-line one.
const DOCSTRING = [{
  oldStart: 2, oldLines: 7, newStart: 2, newLines: 19,
  lines: [' ', ' ', ' def f():', '-    """One."""', ...Array.from({ length: 13 }, (_, i) => `+    line ${i}`), '     a', '     b', '     c'],
}];

test('an edit points at its added lines, not the context around them', () => {
  assert.deepStrictEqual(changedLines(DOCSTRING), { startLine: 5, endLine: 17 });
});

test('an edit that only removes lines points at where they were', () => {
  const hunks = [{ oldStart: 9, oldLines: 5, newStart: 9, newLines: 3, lines: [' a', '-b', '-c', ' d', ' e'] }];
  assert.deepStrictEqual(changedLines(hunks), { startLine: 10, endLine: 10 });
});

test('a later edit above an earlier one moves the earlier one down', () => {
  const r = new Regions();
  const later = [{ oldStart: 40, oldLines: 3, newStart: 40, newLines: 4, lines: [' x', '+new', ' y', ' z'] }];
  const first = r.add('/p/a.py', later, null);
  assert.deepStrictEqual(r.get(first), { file: '/p/a.py', startLine: 41, endLine: 41 });
  r.add('/p/a.py', DOCSTRING, null); // twelve more lines, above line 41
  assert.deepStrictEqual(r.get(first), { file: '/p/a.py', startLine: 53, endLine: 53 });
});

test('an edit below, or in another file, leaves a region where it was', () => {
  const r = new Regions();
  const n = r.add('/p/a.py', DOCSTRING, null);
  r.add('/p/a.py', [{ oldStart: 30, oldLines: 2, newStart: 30, newLines: 5, lines: [' a', '+b', '+c', '+d', ' e'] }], null);
  r.add('/p/b.py', DOCSTRING, null);
  assert.deepStrictEqual(r.get(n), { file: '/p/a.py', startLine: 5, endLine: 17 });
});

test('a file written whole points at all of it, and so do older edits of that file', () => {
  const r = new Regions();
  const old = r.add('/p/a.py', DOCSTRING, null);
  const whole = r.add('/p/a.py', null, 7);
  assert.deepStrictEqual(r.get(whole), { file: '/p/a.py', startLine: 1, endLine: 7 });
  assert.deepStrictEqual(r.get(old), { file: '/p/a.py', startLine: 1, endLine: 7 });
});

test('an unknown edit number gives nothing', () => {
  assert.strictEqual(new Regions().get(3), null);
});

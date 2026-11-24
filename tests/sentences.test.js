const test = require('node:test');
const assert = require('node:assert');
const { splitSentences, readingTimeMs } = require('../extension/lib/sentences');

test('splits on sentence ends', () => {
  assert.deepStrictEqual(splitSentences('Here is the loop. It tries the call! Does it wait? Yes.'), ['Here is the loop.', 'It tries the call!', 'Does it wait?', 'Yes.']);
});
test('keeps a single sentence whole and collapses whitespace', () => {
  assert.deepStrictEqual(splitSentences('  One  sentence\n only '), ['One sentence only']);
});
test('does not split after an abbreviation', () => {
  assert.deepStrictEqual(splitSentences('It reads config, e.g. The port. Then it starts.'), ['It reads config, e.g. The port.', 'Then it starts.']);
});
test('does not split inside a version number or file name', () => {
  assert.deepStrictEqual(splitSentences('We need version 3.12 of values.yaml here.'), ['We need version 3.12 of values.yaml here.']);
});
test('empty text gives no sentences', () => {
  assert.deepStrictEqual(splitSentences('   '), []);
});
test('reading time grows with length and has a floor', () => {
  assert.strictEqual(readingTimeMs('Hi.'), 1200);
  assert.ok(readingTimeMs('word '.repeat(32)) >= 9000);
});

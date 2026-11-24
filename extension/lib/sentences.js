// Splits narration into sentences so the voice can start on the first one
// while the next is still being synthesised.
const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Dr)\.)$/i;

function splitSentences(text) {
  const out = [];
  let current = '';
  for (const piece of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/)) {
    current = current ? current + ' ' + piece : piece;
    if (ABBREVIATIONS.test(current)) continue;
    out.push(current);
    current = '';
  }
  if (current) out.push(current);
  return out.filter(Boolean);
}

// Rough time a silent reader needs, used to pace the agent when the voice is muted.
function readingTimeMs(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1200, Math.round((words / 3.2) * 1000));
}

module.exports = { splitSentences, readingTimeMs };

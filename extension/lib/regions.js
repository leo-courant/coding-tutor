// Where each edit of a narrated session is now. The coder's agent reports each
// edit as hunks of a unified diff (old and new line numbers, and the lines with
// ' ', '-' or '+'). The changed lines become a numbered region, and later edits
// to the same file move the regions after them, so "show me edit 2" still points
// at the right lines after edit 5 added a function above it.

// The lines an edit changed, in the new file: from the first to the last added
// line, or the line where something was only removed.
function changedLines(hunks) {
  let from = null;
  let to = null;
  for (const h of hunks) {
    let line = h.newStart;
    for (const l of h.lines || []) {
      const mark = l[0];
      if (mark === '+') {
        from = from === null ? line : Math.min(from, line);
        to = to === null ? line : Math.max(to, line);
        line += 1;
      } else if (mark === '-') {
        const at = Math.max(line, 1);
        from = from === null ? at : Math.min(from, at);
        to = to === null ? at : Math.max(to, at);
      } else {
        line += 1;
      }
    }
  }
  return from === null ? null : { startLine: from, endLine: to };
}

// Where an old line number lands after the hunks are applied. A removed line
// lands where the removal was.
function mapLine(old, hunks) {
  let shift = 0;
  for (const h of hunks) {
    const oldEnd = h.oldStart + h.oldLines - 1;
    if (old < h.oldStart) break;
    if (old > oldEnd) {
      shift = h.newStart + h.newLines - (h.oldStart + h.oldLines);
      continue;
    }
    let o = h.oldStart;
    let n = h.newStart;
    for (const l of h.lines || []) {
      const mark = l[0];
      if (mark === '+') { n += 1; continue; }
      if (o === old) return mark === '-' ? Math.max(n, 1) : n;
      o += 1;
      if (mark !== '-') n += 1;
    }
    return n;
  }
  return old + shift;
}

class Regions {
  constructor() {
    this.list = []; // index + 1 is the edit number
  }

  // Records an edit and returns its number. `hunks` are the edit's diff, or
  // null when the file was written whole (`lineCount` lines).
  add(file, hunks, lineCount) {
    let lines;
    if (hunks && hunks.length) {
      for (const r of this.list) {
        if (r.file !== file || !r.startLine) continue;
        r.startLine = mapLine(r.startLine, hunks);
        r.endLine = Math.max(mapLine(r.endLine, hunks), r.startLine);
      }
      lines = changedLines(hunks);
    } else {
      // Written whole: what was there before is gone, so older pointers into the
      // file show the whole new file.
      const whole = { startLine: 1, endLine: Math.max(lineCount || 1, 1) };
      for (const r of this.list) if (r.file === file) Object.assign(r, whole);
      lines = whole;
    }
    this.list.push({ file, ...(lines || { startLine: null, endLine: null }) });
    return this.list.length;
  }

  // The file and lines of edit `n` as they are now, or null.
  get(n) {
    const r = this.list[n - 1];
    return r ? { ...r } : null;
  }
}

module.exports = { Regions, changedLines, mapLine };

// csv-reader-speed-01-run-20261121: a fast drop-in for make.fun's own csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error codes, same order:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and a line left
// with no characters is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field that opens with a quote runs to the next quote that is not
// doubled, "" inside it one quote and each CRLF or lone CR inside it read as LF; what
// follows its closing quote, up to the next comma or line break, is appended as it
// stands (quote_junk, when the field ends); a quote that never closes is a literal
// character and the text after it is read again as unquoted (unterminated_quote); a
// quote inside an unquoted field is a literal character; fields stay strings, never
// trimmed or converted; columns is the first record when header is true, else null;
// rows holds the records after it, each padded (short_row) or cut (long_row) to the
// first record's width. Each error is {code, line, row}: line the 1-based line its
// record starts on, row its record's index in rows (null for the header).
//
// Speed: the reference reads one character at a time and builds every field a
// character at a time. This one never does that on the common paths:
//   - a record line with no quote in it is split natively (String split on one slice)
//     after a single trailing-CR check; that covers most records, CRLF included;
//   - an unquoted field is found with two bounded indexOf scans (comma, LF) plus one
//     indexOf on the field's own slice for a stray CR, so no scan ever runs past the
//     field's end;
//   - a quoted field finds its closing quote with indexOf, skipping doubled quotes,
//     and when its body holds no quote, LF or CR the slice is the value as it stands;
//     only bodies with newlines, lone CRs or doubled quotes take the slow build;
//   - line numbers are tracked with a single counter, advanced only by real line
//     breaks; a failed quoted scan never moves it (the reference resets it on an
//     unterminated quote, and so does this one).
// No cache is kept from one case to the next; run() is pure.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Finishes a record: sets the width from the first one, takes the header as it
  // stands, pads a short row or cuts a long one, and stores it.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR
  // not followed by LF is dropped (stray_cr). Returns the field and how it ended;
  // `added` counts the characters kept after `value` as passed in. Every scan stays
  // inside the field: the slice runs to the next comma (or the end of the text), and
  // the line break and CR are found inside that slice, never by a scan to the end
  // of the line.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const iC = text.indexOf(',', pos);
      const seg = text.slice(pos, iC === -1 ? len : iC);
      const iN = seg.indexOf('\n');
      const r = seg.indexOf('\r');
      if (iN === -1 && r === -1) {
        value += seg;
        added += seg.length;
        if (iC === -1) {
          pos = len;
          return { value, ended: END, added };
        }
        pos = iC + 1;
        return { value, ended: COMMA, added };
      }
      if (iN !== -1 && (r === -1 || iN < r)) {
        // The LF comes first: the field ends at the line break.
        value += seg.slice(0, iN);
        added += iN;
        pos = pos + iN + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // The CR comes first (or there is no LF): a CR followed by LF is the CRLF
      // line break, anything else is a stray CR, dropped with its error, and the
      // field goes on from just past it.
      if (seg[r + 1] === '\n') {
        value += seg.slice(0, r);
        added += r;
        pos = pos + r + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      error('stray_cr');
      value += seg.slice(0, r);
      added += r;
      pos = pos + r + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // The closing quote: the first quote that is not doubled.
    let search = pos + 1;
    let close = -1;
    for (;;) {
      const j = text.indexOf('"', search);
      if (j === -1) break;
      if (text[j + 1] === '"') {
        search = j + 2;
        continue;
      }
      close = j;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted. The line goes back to the opening quote's line.
      error('unterminated_quote');
      pos = open + 1;
      line = openLine;
      return readUnquoted('"');
    }
    const seg = text.slice(pos + 1, close);
    let value;
    let delta = 0;
    if (seg.indexOf('"') === -1 && seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
      // No doubled quote, no line break, no CR: the slice is the value as it stands.
      value = seg;
    } else {
      // Slow build: "" is one quote, CRLF and a lone CR are each one LF, and every
      // LF, CRLF and lone CR inside counts one line.
      let v = '';
      let s = 0;
      const n = seg.length;
      while (s < n) {
        const c = seg.charCodeAt(s);
        if (c === 34) {
          v += '"';
          s += seg.charCodeAt(s + 1) === 34 ? 2 : 1;
        } else if (c === 13) {
          v += '\n';
          delta += 1;
          s += seg.charCodeAt(s + 1) === 10 ? 2 : 1;
        } else if (c === 10) {
          v += '\n';
          delta += 1;
          s += 1;
        } else {
          let e = s + 1;
          while (e < n) {
            const d = seg.charCodeAt(e);
            if (d === 34 || d === 13 || d === 10) break;
            e += 1;
          }
          v += seg.slice(s, e);
          s = e;
        }
      }
      value = v;
    }
    pos = close + 1;
    line += delta;
    if (pos >= len) return { value, ended: END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next comma
    // or line break. Its stray CRs are reported first, then the junk itself.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record ends at the next LF and holds no quote, so no field in
    // it can span a line and no quote can open. A trailing CR is the CRLF break.
    const lf = text.indexOf('\n', pos);
    if (lf !== -1) {
      const lineStr = text.slice(pos, lf);
      if (lineStr.indexOf('"') === -1) {
        const cr = lineStr.indexOf('\r');
        if (cr === -1 || cr === lineStr.length - 1) {
          const body = cr === -1 ? lineStr : lineStr.slice(0, -1);
          pos = lf + 1;
          line += 1;
          if (body.length !== 0) finishRecord(body.split(','));
          continue;
        }
      }
    }

    // General path: field by field, for quoted fields, stray CRs, junk after a
    // closing quote, unterminated quotes, and the tail with no line break left.
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text[pos] === '"';
      const field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
      ended = field.ended;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

/**
 * A minimal RFC 4180 CSV reader, for the attachment preview table.
 *
 * `text.split("\n").map(line => line.split(","))` is the version everyone
 * writes first, and it is wrong for the files people actually attach: an
 * address field holds a comma, an exported description holds a newline, and
 * a quoted field holds a doubled quote. Any of those turn a naive split into
 * a table that is silently misaligned — which is worse than no preview,
 * because it looks like data.
 *
 * Deliberately NOT a dependency. This is ~40 lines used in exactly one place,
 * and a parser is easier to read than an API surface. Deliberately not a
 * dialect sniffer either: no semicolon or tab detection, no type coercion,
 * no header inference beyond "the first row is probably headers", which the
 * caller decides. It reads comma-delimited text into strings.
 */

/**
 * Rows of raw cell strings. Never fewer cells than the row contained, and
 * never more — the preview pads for display, so ragged input stays visible
 * here rather than being quietly squared off.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Tracks whether the current field has begun, so a trailing newline at the
  // end of the file does not append a phantom `[""]` row.
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // A doubled quote inside a quoted field is one literal quote.
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"' && field === "") {
      // Only opens a quoted field at the START of one. A stray quote
      // mid-field (`12" pipe`) is data, not syntax.
      quoted = true;
      started = true;
      continue;
    }
    if (char === ",") {
      endField();
      continue;
    }
    if (char === "\r") {
      // CRLF: swallow the CR and let the LF end the row. A lone CR (classic
      // Mac) ends it here.
      if (text[i + 1] === "\n") continue;
      endRow();
      continue;
    }
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
    started = true;
  }

  // A final row with no trailing newline still counts; a trailing newline
  // does not invent an empty one.
  if (started || row.length > 0) endRow();

  return rows;
}

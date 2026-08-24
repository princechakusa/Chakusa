export interface ParsedCustomerRow {
  name: string;
  phone?: string;
  email?: string;
}

export interface ParseCustomerImportResult {
  rows: ParsedCustomerRow[];
  skippedLines: number;
}

/**
 * Parses pasted text into import rows — one customer per line, fields
 * separated by a comma or tab (matching what a business owner would get
 * copying a list out of Notes, WhatsApp, or a spreadsheet). Deliberately
 * text-only, not a file picker: no new native dependency, and it works the
 * same on every platform. A line with no name is skipped rather than
 * failing the whole paste — the business owner sees the skipped count and
 * can fix their input, but one malformed line never blocks the rest.
 */
export function parseCustomerImportText(text: string): ParseCustomerImportResult {
  const rows: ParsedCustomerRow[] = [];
  let skippedLines = 0;

  for (const [lineIndex, rawLine] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const fields = line.includes('\t') ? line.split('\t').map(field => field.trim()) : parseCsvLine(line);
    if (lineIndex === 0 && fields.some(field => ['name', 'customer name'].includes(field.toLowerCase()))) continue;
    const name = fields[0] ?? "";
    if (!name) {
      skippedLines += 1;
      continue;
    }

    const rest = fields.slice(1).filter(Boolean);
    const phone = rest.find((field) => /\d/.test(field) && !field.includes("@"));
    const email = rest.find((field) => field.includes("@"));
    rows.push({ name, phone, email });
  }

  return { rows, skippedLines };
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(value.trim()); value = ''; }
    else value += char;
  }
  fields.push(value.trim()); return fields;
}

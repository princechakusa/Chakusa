import { bulkImportCustomersSchema, type BulkImportCustomersInput } from "./customers.schemas.js";

/** Small RFC4180-compatible parser for the owner-import preview. It never writes data. */
export function parseCustomerCsv(csv: string): { rows: unknown[]; errors: string[] } {
  const source = csv.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[i + 1] === "\n") i += 1; row.push(field.trim()); if (row.some(Boolean)) records.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) return { rows: [], errors: ["CSV contains an unterminated quoted field"] };
  if (field.length || row.length) { row.push(field.trim()); if (row.some(Boolean)) records.push(row); }
  if (records.length < 2) return { rows: [], errors: ["CSV must include a header and at least one row"] };
  const headers = records[0]!.map(value => value.toLowerCase().replace(/\s+/g, ""));
  const required = headers.indexOf("name");
  if (required < 0) return { rows: [], errors: ["CSV must include a name column"] };
  const unknownHeaders = headers.filter(header => !["name", "phone", "email", "notes"].includes(header));
  if (unknownHeaders.length) return { rows: [], errors: [`Unsupported column(s): ${unknownHeaders.join(", ")}`] };
  const rows = records.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { rows, errors: [] };
}

export function validateCustomerCsvRows(rows: unknown[]): { input?: BulkImportCustomersInput; errors: string[] } {
  const parsed = bulkImportCustomersSchema.safeParse({ customers: rows });
  if (parsed.success) return { input: parsed.data, errors: [] };
  return { errors: parsed.error.issues.slice(0, 25).map(issue => `${issue.path.join(".") || "rows"}: ${issue.message}`) };
}

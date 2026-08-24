import { parseCsvLine } from './customersImport';
export interface AppointmentImportRow { customerName: string; customerPhone?: string; customerEmail?: string; serviceName: string; startsAt: string; endsAt: string; price?: number; notes?: string; }
export function parseAppointmentImportText(text: string) {
  const rows: AppointmentImportRow[] = []; let skippedLines = 0;
  for (const [index, rawLine] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = rawLine.trim(); if (!line) continue;
    const fields = line.includes('\t') ? line.split('\t').map(value => value.trim()) : parseCsvLine(line);
    if (index === 0 && fields[0]?.toLowerCase().includes('customer')) continue;
    const [customerName, customerPhone, customerEmail, serviceName, startsAt, endsAt, price, notes] = fields;
    if (!customerName || !serviceName || !startsAt || !endsAt || Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt)) || new Date(endsAt) <= new Date(startsAt)) { skippedLines += 1; continue; }
    rows.push({ customerName, customerPhone: customerPhone || undefined, customerEmail: customerEmail || undefined, serviceName, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), price: price ? Number(price) : undefined, notes: notes || undefined });
  }
  return { rows, skippedLines };
}

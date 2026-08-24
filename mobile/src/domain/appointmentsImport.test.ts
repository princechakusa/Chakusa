import { describe, expect, it } from 'vitest';
import { parseAppointmentImportText } from './appointmentsImport';
describe('appointment import parser', () => {
  it('parses a header and valid appointment row', () => { const result = parseAppointmentImportText('customer name,phone,email,service,start,end,price,notes\nJane,+263771234567,jane@example.com,Haircut,2026-09-01T09:00:00Z,2026-09-01T10:00:00Z,35,Regular'); expect(result.rows[0]).toMatchObject({ customerName: 'Jane', serviceName: 'Haircut', price: 35 }); expect(result.skippedLines).toBe(0); });
  it('skips invalid dates and reversed ranges', () => { expect(parseAppointmentImportText('Jane,,,Haircut,bad,bad').skippedLines).toBe(1); expect(parseAppointmentImportText('Jane,,,Haircut,2026-09-01T10:00:00Z,2026-09-01T09:00:00Z').skippedLines).toBe(1); });
});

import { describe, expect, it } from 'vitest';
import { parseCustomerImportText } from './customersImport';

describe('parseCustomerImportText', () => {
  it('parses comma-separated name, phone, and email', () => {
    const result = parseCustomerImportText('Jane Doe, +263771234567, jane@example.com');
    expect(result.rows).toEqual([{ name: 'Jane Doe', phone: '+263771234567', email: 'jane@example.com' }]);
    expect(result.skippedLines).toBe(0);
  });

  it('parses tab-separated rows', () => {
    const result = parseCustomerImportText('John Smith\t+263779999999');
    expect(result.rows).toEqual([{ name: 'John Smith', phone: '+263779999999', email: undefined }]);
  });

  it('handles a name-only line', () => {
    const result = parseCustomerImportText('Just A Name');
    expect(result.rows).toEqual([{ name: 'Just A Name', phone: undefined, email: undefined }]);
  });

  it('skips blank lines without counting them as errors', () => {
    const result = parseCustomerImportText('Jane Doe\n\n\nJohn Smith');
    expect(result.rows).toHaveLength(2);
    expect(result.skippedLines).toBe(0);
  });

  it('skips a line with no name and counts it', () => {
    const result = parseCustomerImportText(', +263771234567\nJane Doe');
    expect(result.rows).toEqual([{ name: 'Jane Doe', phone: undefined, email: undefined }]);
    expect(result.skippedLines).toBe(1);
  });

  it('distinguishes phone and email regardless of column order', () => {
    const result = parseCustomerImportText('Jane Doe, jane@example.com, +263771234567');
    expect(result.rows).toEqual([{ name: 'Jane Doe', phone: '+263771234567', email: 'jane@example.com' }]);
  });

  it('parses multiple rows from a full paste', () => {
    const result = parseCustomerImportText('Jane Doe, +263771111111\nJohn Smith, +263772222222\nNo Contact Info');
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]).toEqual({ name: 'No Contact Info', phone: undefined, email: undefined });
  });
});

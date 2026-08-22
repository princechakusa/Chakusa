import { describe, expect, it } from 'vitest';
import { generateQrMatrix } from './qrCode';

describe('generateQrMatrix', () => {
  it('produces a square matrix', () => {
    const matrix = generateQrMatrix('https://chakusa.com/b/janes-plumbing');
    expect(matrix.length).toBeGreaterThan(0);
    for (const row of matrix) {
      expect(row.length).toBe(matrix.length);
    }
  });

  it('produces only boolean cells', () => {
    const matrix = generateQrMatrix('https://chakusa.com/b/janes-plumbing');
    for (const row of matrix) {
      for (const cell of row) {
        expect(typeof cell).toBe('boolean');
      }
    }
  });

  it('produces a larger matrix for a longer value', () => {
    const short = generateQrMatrix('https://chakusa.com/b/a');
    const long = generateQrMatrix(`https://chakusa.com/b/${'a'.repeat(200)}`);
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('is deterministic for the same input', () => {
    const first = generateQrMatrix('https://chakusa.com/b/janes-plumbing');
    const second = generateQrMatrix('https://chakusa.com/b/janes-plumbing');
    expect(first).toEqual(second);
  });

  it('produces different matrices for different input', () => {
    const a = generateQrMatrix('https://chakusa.com/b/janes-plumbing');
    const b = generateQrMatrix('https://chakusa.com/b/bobs-salon');
    expect(a).not.toEqual(b);
  });
});

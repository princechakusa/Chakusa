import QRCode from 'qrcode';

/**
 * Pure QR-matrix generation, kept separate from any rendering concern.
 * `qrcode`'s `create()` is synchronous and dependency-free at runtime (no
 * Canvas/DOM) — it only computes the module grid, which is exactly what a
 * plain View-based renderer needs. Deliberately not using `toDataURL`/
 * `toCanvas` (both require a Canvas implementation React Native doesn't
 * have) or a native SVG library (would require a new native dependency and
 * a rebuild, for a feature that a grid of Views renders just as well).
 */
export function generateQrMatrix(value: string): boolean[][] {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const rows: boolean[][] = [];
  for (let row = 0; row < modules.size; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < modules.size; col += 1) {
      cells.push(modules.get(row, col) === 1);
    }
    rows.push(cells);
  }
  return rows;
}

import { useMemo } from 'react';
import { View } from 'react-native';
import { generateQrMatrix } from '../domain/qrCode';
import { colors } from '../theme';

/**
 * Renders a QR code as a plain grid of Views — no react-native-svg, no
 * Canvas, no native dependency. See domain/qrCode.ts for why: this is a
 * static, share-and-screenshot use case (print it, put it on a flyer), not
 * a scanning/decoding feature, so a flexbox grid is all the fidelity it
 * needs.
 */
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const matrix = useMemo(() => generateQrMatrix(value), [value]);
  const cell = size / matrix.length;

  return (
    <View accessibilityLabel="QR code linking to this business's public page" style={{ width: size, height: size, backgroundColor: '#ffffff' }}>
      {matrix.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row' }}>
          {row.map((dark, colIndex) => (
            <View key={colIndex} style={{ width: cell, height: cell, backgroundColor: dark ? colors.text : '#ffffff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

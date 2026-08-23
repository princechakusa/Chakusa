import { Image, StyleSheet } from 'react-native';
import chakusaAppIcon from '../../assets/chakusa-app-icon.png';

export function BrandMark({ size }: { size: number }) {
  return <Image accessibilityIgnoresInvertColors accessibilityLabel="CHAKUSA logo" source={chakusaAppIcon} style={[styles.image, { width: size, height: size, borderRadius: size * 0.24 }]} />;
}

const styles = StyleSheet.create({ image: { resizeMode: 'cover' } });

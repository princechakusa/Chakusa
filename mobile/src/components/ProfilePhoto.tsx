import { Image, StyleSheet, Text, View } from 'react-native';

import { API_URL } from '../config';
import { colors } from '../theme';

// A round profile picture - a customer's own photo or a business's photo -
// falling back to initials. `uri` may be a data URI, an https link, or an
// API-relative path such as a business's versioned /public/business/<slug>/photo.

export function photoSource(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith('/')) return API_URL ? `${API_URL}${uri}` : null;
  return uri;
}

export function initials(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || '?';
}

export function ProfilePhoto({ uri, name, size = 48, testID }: { uri?: string | null; name?: string | null; size?: number; testID?: string }) {
  const source = photoSource(uri);
  const round = { width: size, height: size, borderRadius: size / 2 };
  return source ? (
    <Image testID={testID} accessibilityLabel={name ? `${name} photo` : 'Profile photo'} source={{ uri: source }} style={[styles.image, round]} resizeMode="cover" />
  ) : (
    <View testID={testID} accessibilityLabel={name ? `${name} initials` : 'No photo'} style={[styles.fallback, round]}>
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.36) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.border },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFE7DC' },
  initials: { fontWeight: '700', color: colors.primary },
});
